import type { APIRequestContext, Page, Request, Route } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath, marketSetupPath, oneByOnePath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { LoginPage } from './pages/LoginPage';
import { MarketsPage } from './pages/MarketsPage';
import { MarketSetupPage } from './pages/MarketSetupPage';

/**
 * A failure says what happened and what to do, and signing in keeps the place (E38/F11/S01).
 *
 * Each kind of failure reads one way on every screen: no connection, a fault on the server (the
 * back end's generic 500 body never reaches the organizer), or a session that ended; a refusal
 * keeps its own sentence, which the refusal specs pin. A screen whose own read failed offers Try
 * again. A session that ends mid-work, and a link opened signed out, sign in and return to the
 * page they were on.
 */

const SERVER_FAULT = 'Something went wrong on our side. Try again in a moment.';
const OFFLINE = 'You seem to be offline. Check the connection and try again.';
const SESSION_ENDED = 'Your session has ended. Sign in again.';

type Kind = 'server' | 'offline';
const KINDS: { kind: Kind; says: string }[] = [
  { kind: 'server', says: SERVER_FAULT },
  { kind: 'offline', says: OFFLINE },
];

/** A request of the app's own, not the page of the same address. */
const isApiCall = (request: Request, method: string) =>
  request.method() === method && ['xhr', 'fetch'].includes(request.resourceType());

/** A request of `kind` fails as the back end's generic 500 body, or with no answer at all. */
function failAs(route: Route, kind: Kind) {
  if (kind === 'offline') return route.abort('internetdisconnected');
  return route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Internal server error' }),
  });
}

/**
 * The next `method` request to `url` fails as `kind` does, and every one after it reaches the
 * server.
 */
async function failOnce(page: Page, url: RegExp, kind: Kind, method = 'GET'): Promise<void> {
  let failed = false;
  await page.route(url, async (route) => {
    if (failed || !isApiCall(route.request(), method)) return route.continue();
    failed = true;
    return failAs(route, kind);
  });
}

/**
 * Every `GET` to `url` fails as `kind` does until the test unroutes it. A read the page before the
 * `goto` started can still be unsent when the route goes in, since axios reads the XSRF cookie from
 * the Cookie Store before it sends: failing only the first would fail that read and let the
 * screen's own through.
 */
async function failUntilCleared(page: Page, url: RegExp, kind: Kind): Promise<void> {
  await page.route(url, async (route) => {
    if (!isApiCall(route.request(), 'GET')) return route.continue();
    return failAs(route, kind);
  });
}

/** A form market in review, holding three applications, open unless `status` says otherwise. */
async function reviewingMarket(request: APIRequestContext, status = 'open') {
  const { marketId, orgId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  for (const email of ['nadia@ember.test', 'theo@thistle.test', 'ines@loom.test']) {
    seedApplicationWithStatus(marketId, status, email);
  }
  return { marketId, orgId };
}

/** The review's All view, filtered to what is still open: the address a reviewer shares. */
const openApplications = (marketId: string) =>
  `${marketScreenPath(marketId, 'applications')}?view=all&status=undecided`;

/** Each screen's own read: where it is, what it reads, and the name its Try again goes by. */
function reads(reviewing: string, published: string) {
  const list = /\/markets\/[^/]+\/applications(\?.*)?$/;
  return [
    { screen: 'Markets', at: '/markets', url: /\/markets(\?.*)?$/, name: 'markets' },
    {
      screen: 'Organizations',
      at: '/organizations',
      url: /\/organizations(\?.*)?$/,
      name: 'organizations',
    },
    {
      screen: 'Applications, All',
      at: `${marketScreenPath(reviewing, 'applications')}?view=all`,
      url: list,
      name: 'applications',
    },
    {
      screen: 'Applications, One by one',
      at: oneByOnePath(reviewing),
      url: list,
      name: 'applications',
    },
    {
      screen: 'Assignments',
      at: marketScreenPath(published, 'assignments'),
      url: /\/markets\/[^/]+\/tables$/,
      name: 'tables',
    },
    {
      screen: 'Attendance',
      at: marketScreenPath(published, 'attendance'),
      url: /\/markets\/[^/]+\/attendance$/,
      name: 'attendance',
    },
  ];
}

test.describe('a failed read', () => {
  test('says which kind of failure it was, and Try again reads it again', async ({
    authenticatedPage: page,
    request,
  }) => {
    test.setTimeout(180_000);
    const { marketId: reviewing } = await reviewingMarket(request);
    const { marketId: published } = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );

    for (const { screen, at, url, name } of reads(reviewing, published)) {
      for (const { kind, says } of KINDS) {
        await test.step(`${screen}, ${kind}`, async () => {
          await failUntilCleared(page, url, kind);
          await page.goto(at);

          const failed = page.getByTestId(`${name}-read-failed`);
          await expect(failed).toContainText(says);
          await expect(page.getByText('Internal server error')).toHaveCount(0);

          await page.unroute(url);
          await page.getByTestId(`${name}-retry`).click();
          await expect(failed).toHaveCount(0);
        });
      }
    }
  });

  test("Attendance's Try again is a thumb's target on a phone", async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await failOnce(page, /\/markets\/[^/]+\/attendance$/, 'offline');
    await page.goto(marketScreenPath(marketId, 'attendance'));

    const retry = page.getByTestId('attendance-retry');
    await expect(page.getByTestId('attendance-read-failed')).toContainText(OFFLINE);
    const box = await retry.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await retry.click();
    await expect(page.getByTestId('attendance-read-failed')).toHaveCount(0);
    await expect(page.getByTestId('attendance-summary')).toBeVisible();
  });
});

test.describe('a failed write', () => {
  test('a verdict and a selection say which kind of failure it was', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await reviewingMarket(request);
    const all = new ApplicationsAllPage(page);
    const verdict = /\/markets\/[^/]+\/applications\/[^/]+\/review$/;
    const selection = /\/markets\/[^/]+\/applications\/verdicts$/;
    await all.goto(marketId);
    await expect(all.rows).toHaveCount(3);

    for (const { kind, says } of KINDS) {
      await test.step(`a verdict, ${kind}`, async () => {
        await failOnce(page, verdict, kind, 'PUT');
        await all.open('nadia@ember.test');
        await all.drawerButton('approve').click();
        await expect(page.getByTestId('applications-all-verdict-message')).toHaveText(says);
        await page.keyboard.press('Escape');
        await page.unroute(verdict);
      });

      await test.step(`a selection, ${kind}`, async () => {
        await failOnce(page, selection, kind, 'POST');
        await all.tickOf('theo@thistle.test').check();
        await all.decideSelection('approve');
        await page.getByTestId('applications-all-confirm-submit-button').click();
        await expect(page.getByTestId('applications-all-confirm-error')).toHaveText(says);
        await page.getByTestId('applications-all-confirm-cancel-button').click();
        await all.tickOf('theo@thistle.test').uncheck();
        await page.unroute(selection);
      });
    }
    await expect(page.getByText('Internal server error')).toHaveCount(0);
  });

  test('a phase move says which kind of failure it was', async ({
    authenticatedPage: page,
    request,
  }) => {
    // Every application decided, so the move to Assignment is offered.
    const { marketId } = await reviewingMarket(request, 'reviewer_approved');
    const setup = new MarketSetupPage(page);
    const move = /\/markets\/[^/]+\/transition$/;
    await page.goto(`${marketScreenPath(marketId, 'applications')}?view=all`);

    for (const { kind, says } of KINDS) {
      await failOnce(page, move, kind, 'POST');
      await setup.clickTransition('assignment');
      const confirm = page.getByTestId('sweep-confirm-submit-button');
      const error = page.getByTestId('phase-rail-error');
      await confirm.or(error).first().waitFor();
      if (await confirm.isVisible()) await confirm.click();
      await expect(error).toHaveText(says);
      await page.unroute(move);
    }
  });

  test("the plan's save says which kind of failure it was", async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const save = /\/markets\/[^/]+\/plan$/;
    await page.goto(marketSetupPath(marketId));

    for (const [index, { kind, says }] of KINDS.entries()) {
      await failOnce(page, save, kind, 'PUT');
      await page.getByTestId('setup-location-add-button').click();
      await page.getByTestId(`setup-location-name-input-${index}`).fill(`Hall ${index + 1}`);
      await expect(page.getByTestId('market-setup-plan-save-error')).toHaveText(says);
      await page.unroute(save);
    }
  });

  test('Manage organization says which kind of failure it was', async ({
    authenticatedPage: page,
  }) => {
    const add = /\/organizations\/[^/]+\/admins$/;
    await page.goto('/organizations');
    await page.getByTestId('organizations-manage-button').first().click();
    await page.getByTestId('manage-org-add-admin-button').click();
    await page.getByTestId('manage-org-add-admin-input').fill('new-admin@example.com');

    // The form stays open on a failure, to be sent again as it is.
    for (const { kind, says } of KINDS) {
      await failOnce(page, add, kind, 'POST');
      await page.getByTestId('manage-org-add-admin-submit').click();
      await expect(page.getByTestId('manage-org-add-admin-error')).toHaveText(says);
      await page.unroute(add);
    }
  });
});

test.describe('signing in keeps the place', () => {
  test('a session that ends mid-review signs in again and returns to the same address', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await reviewingMarket(request);
    const all = new ApplicationsAllPage(page);
    await page.goto(openApplications(marketId));
    await expect(all.rows).toHaveCount(3);
    await all.open('nadia@ember.test');
    // The address as it stands, the open drawer included.
    const opened = new URL(page.url());
    const place = opened.pathname + opened.search;

    // The session ends under the organizer: the server no longer knows the login its cookie names,
    // as after a password reset. The next sign-in gives the account a new one.
    mongoEval(`db.users.updateOne({ email: '${TEST_USER.email}' }, { $unset: { login_id: '' } })`);
    await all.drawerButton('approve').click();

    await page.waitForURL(/\/login\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get('next')).toBe(place);
    expect(url.searchParams.get('ended')).toBe('1');
    await expect(page.getByTestId('login-session-ended')).toHaveText(SESSION_ENDED);

    await new LoginPage(page).signIn(TEST_USER.email, TEST_USER.password);
    await page.waitForURL((at) => at.pathname + at.search === place);
    await expect(all.rows).toHaveCount(3);
  });

  test('a link opened signed out lands where it pointed, signed in by password', async ({
    page,
    request,
  }) => {
    const { marketId } = await reviewingMarket(request);
    const place = openApplications(marketId);
    await page.goto(place);

    await page.waitForURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get('next')).toBe(place);
    await expect(page.getByTestId('login-session-ended')).toHaveCount(0);
    await new LoginPage(page).signIn(TEST_USER.email, TEST_USER.password);

    await page.waitForURL((at) => at.pathname + at.search === place);
    await expect(new ApplicationsAllPage(page).rows).toHaveCount(3);
  });

  test('a link opened signed out lands where it pointed, signed in by code', async ({
    page,
    request,
  }) => {
    const { marketId } = await reviewingMarket(request);
    const place = openApplications(marketId);
    const login = new LoginPage(page);
    await page.goto(place);
    await page.waitForURL(/\/login\?/);

    // No email leaves the stack: the code is asked for as usual, and set where the server keeps it.
    await page.route('**/request-otp', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ msg: 'A sign-in code has been sent to your email.' }),
      }),
    );
    await login.switchToOtp();
    await login.otpEmailInput.fill(TEST_USER.email);
    await login.otpSubmitButton.click();
    await expect(login.otpCodeInput).toBeVisible();
    const expires = new Date(Date.now() + 5 * 60_000).toISOString();
    mongoEval(
      `db.users.updateOne({ email: '${TEST_USER.email}' }, ` +
        `{ $set: { otp: '246810', otp_expires: '${expires}', otp_attempts: 0 } })`,
    );
    await login.otpCodeInput.fill('246810');
    await login.otpSubmitButton.click();

    await page.waitForURL((at) => at.pathname + at.search === place);
    await expect(new ApplicationsAllPage(page).rows).toHaveCount(3);
  });

  test('a next that is not a path of this app lands on Markets', async ({ page }) => {
    await page.goto('/login?next=%2F%2Fevil.example%2Fmarkets');
    await new LoginPage(page).signIn(TEST_USER.email, TEST_USER.password);

    await new LoginPage(page).waitForMarkets();
    expect(new URL(page.url()).host).not.toBe('evil.example');
  });
});

test.describe('a page that could not be opened', () => {
  // A screen's code is fetched the first time it is opened; with no connection the click would do
  // nothing. The shell says why, and Try again opens the page once the connection is back.
  test('says the connection, and Try again opens it', async ({ authenticatedPage: page }) => {
    // Stand on a Markets page that has finished loading its code before losing the connection:
    // taken offline mid-load, the page's own lazy import would fail too and its Try again would
    // reload Markets instead of the page the navigation named.
    await new MarketsPage(page).goto();
    await expect(page.getByTestId('markets-read-failed')).toHaveCount(0);
    const code = /\/src\/views\/OrganizationsView\.vue/;
    await page.route(code, (route) => route.abort('internetdisconnected'));
    await page.context().setOffline(true);

    await page.getByRole('link', { name: 'Organizations' }).click();

    await expect(page.getByTestId('page-read-failed')).toContainText(OFFLINE);
    await expect(page).toHaveURL(/\/markets$/);

    await page.context().setOffline(false);
    await page.unroute(code);
    await page.getByTestId('page-retry').click();
    await page.waitForURL(/\/organizations$/);
    await expect(page.getByTestId('page-read-failed')).toHaveCount(0);
  });

  test('says the page could not be opened when its code is gone, as after a deploy', async ({
    authenticatedPage: page,
  }) => {
    await new MarketsPage(page).goto();
    await expect(page.getByTestId('markets-read-failed')).toHaveCount(0);
    const code = /\/src\/views\/OrganizationsView\.vue/;
    await page.route(code, (route) => route.fulfill({ status: 404, body: '' }));

    await page.getByRole('link', { name: 'Organizations' }).click();

    await expect(page.getByTestId('page-read-failed')).toContainText(
      'The page could not be opened. Try again to load it.',
    );
    await page.unroute(code);
    await page.getByTestId('page-retry').click();
    await page.waitForURL(/\/organizations$/);
    await expect(page.getByTestId('page-read-failed')).toHaveCount(0);
  });
});

test.describe("the shell's session probe", () => {
  // The probe at load asks whether the session still holds. No answer, or a fault on the server,
  // says nothing about the session, so the organizer stays where they were, and the screen's own
  // read says what went wrong.
  for (const { kind } of KINDS) {
    test(`keeps the organizer on the page when it fails as ${kind}`, async ({
      authenticatedPage: page,
    }) => {
      await failOnce(page, /\/check-session$/, kind);
      await page.goto('/markets');
      // The bar stands from the stored user, so nothing on screen waits for the probe; this does. An
      // ended session would have left for the sign-in page, which has no account menu.
      await page.waitForLoadState('networkidle');

      await expect(page.getByTestId('app-bar-account-button')).toHaveText(TEST_USER.email);
      await expect(page).toHaveURL(/\/markets$/);
      expect(await page.evaluate(() => localStorage.getItem('user'))).toContain(TEST_USER.email);
    });
  }
});

test.describe('a session is its cookie', () => {
  // The organizer's session is the cookie and nothing else: once the browser holds none, the back
  // end no longer knows who asks, through the front end's proxy and from a page alike. The probe
  // runs on a page of the app's origin that runs none of its code, since a read still in flight
  // when the cookies are cleared answers with the session's cookie again, which the server
  // refreshes on every request.
  test('a request without the cookie is not signed in', async ({ authenticatedPage: page }) => {
    await page.goto('/api/check-session');
    const context = page.context();
    expect((await page.request.get('/api/check-session')).status()).toBe(200);

    await context.clearCookies();
    expect(await context.cookies()).toEqual([]);

    expect((await page.request.get('/api/check-session')).status()).toBe(401);
    const fromThePage = await page.evaluate(async () => {
      const answer = await fetch('/api/check-session', { credentials: 'include' });
      return answer.status;
    });
    expect(fromThePage).toBe(401);
  });
});
