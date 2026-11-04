import { test, expect, TEST_USER, BACKEND_URL, LoginPage } from './fixtures';
import {
  ensureTestOrg,
  seedMarketWithVendors,
  seedPublishedMarketWithAssignments,
  publishResults,
} from './helpers/seeds';
import { seedApplicantMarket } from './helpers/seedApplicantMarket';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import type { Page } from '@playwright/test';

/**
 * Every market page has its own address, and the bar reaches every one (E22/F04/S02, from the
 * the-assignment-tab ticket 02).
 *
 * The bar carries Market Setup, Application Form, Applications, Assignment, Attendance, Tools and
 * Stats in every phase. It is rendered once, by the frame, so Tables - now the Assignments page -
 * Vendors and Attendance are reached the same way as the plan; the Back buttons those screens kept
 * because they had no tabs are gone.
 */
const at = (marketId: string, page = '') => `/markets/${marketId}${page ? `/${page}` : ''}`;

/**
 * The old addresses nothing links to, with no forward. A one-segment one falls to `/:marketSlug` and
 * answers as a market that does not exist. Each with the name a market would need to hold it.
 */
const FREED_NAMES = [
  ['/init', 'Init'],
  ['/register', 'Register'],
  ['/vendors', 'Vendors'],
  ['/market-setup', 'Market Setup'],
  ['/import-applications', 'Import Applications'],
  ['/assignment-results', 'Assignment Results'],
  ['/floorplan-editor', 'Floorplan Editor'],
] as const;

/** `/floorplan-editor` also carried a market's id, and forwarded to its floorplan. */
const REMOVED = [...FREED_NAMES.map(([path]) => path), '/floorplan-editor?marketId=m1'];

/** "Page not found", at the address asked for, offering the way onward this person has. */
async function expectNotFound(page: Page, address: string, onward: 'Markets' | 'Sign in') {
  const notFound = page.getByTestId('page-not-found');
  await expect(notFound).toBeVisible({ timeout: 15000 });
  await expect(notFound.getByRole('button', { name: onward })).toBeVisible();
  const { pathname, search } = new URL(page.url());
  expect(pathname + search).toBe(address);
}

async function activeTab(page: Page, tab: string) {
  await expect(page.getByTestId(`market-bar-tab-${tab}`)).toHaveClass(/active/, { timeout: 15000 });
}

test.describe('Every market page has its own address', () => {
  let published: string;
  let assigned: string;

  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    published = (
      await seedPublishedMarketWithAssignments(
        request,
        BACKEND_URL,
        TEST_USER.email,
        TEST_USER.password,
      )
    ).marketId;
    assigned = (await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password))
      .marketId;
  });

  test('each page opens at its address, under its tab, and a refresh keeps it', async ({
    authenticatedPage: page,
  }) => {
    for (const [where, tab] of [
      ['setup', 'setup'],
      ['form', 'form'],
      ['applications', 'applications'],
      ['settings', 'assignment'],
      ['assignments', 'assignment'],
      ['vendors', 'assignment'],
      ['attendance', 'attendance'],
      ['tools', 'tools'],
      ['stats', 'stats'],
    ] as const) {
      await page.goto(at(published, where));
      await activeTab(page, tab);
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`/markets/${published}/${where}$`));
      await activeTab(page, tab);
    }
  });

  // A blocker's fix, a bookmark or a shared link opens Review setup as `form?step=review` (T206):
  // the Application Form tab keeps its step in the query, replaced as a page's own view is.
  for (const intakeMode of ['form', 'csv'] as const) {
    test(`the form tab's steps have addresses (${intakeMode})`, async ({
      authenticatedPage: page,
      request,
    }) => {
      const draft = (
        await seedDraftMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
          intakeMode,
        })
      ).marketId;
      await page.goto(at(draft, 'setup'));
      await activeTab(page, 'setup');

      await page.goto(`${at(draft, 'form')}?step=review`);
      await activeTab(page, 'form');
      await expect(page.getByTestId('form-step-title')).toHaveText('Review setup');
      await page.reload();
      await expect(page.getByTestId('form-step-title')).toHaveText('Review setup');

      await page.getByTestId('form-step-questions').click();
      await expect(page).toHaveURL(new RegExp(`/markets/${draft}/form\\?step=questions$`));
      await expect(page.getByTestId('form-step-title')).toHaveText('Your questions');
      await page.reload();
      await expect(page.getByTestId('form-step-title')).toHaveText('Your questions');

      // Choosing a step replaced the address: Back leaves the tab rather than stepping back.
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/markets/${draft}/setup$`));
    });
  }

  test("the Assignment tab's pages by their old names land on their pages", async ({
    authenticatedPage: page,
  }) => {
    // The Assignment tab's pages took the names of what they hold (E38/F08/S01). Production's last
    // release still serves the old names, so they are what an organizer has bookmarked: a saved
    // link to Assignment or Result lands on Settings or Assignments, its query kept.
    await page.goto(`${at(published, 'result')}?date=2026-07-15&status=assigned`);
    await expect(page).toHaveURL(
      new RegExp(`/markets/${published}/assignments\\?date=2026-07-15&status=assigned$`),
    );
    await expect(page.getByTestId('market-pages-assignments')).toHaveClass(/active/);

    await page.goto(`${at(published, 'assignment')}?from=bookmark`);
    await expect(page).toHaveURL(new RegExp(`/markets/${published}/settings\\?from=bookmark$`));
    await expect(page.getByTestId('market-pages-settings')).toHaveClass(/active/);
  });

  test('the bare address and the dashboard land on Markets', async ({
    authenticatedPage: page,
  }) => {
    for (const path of ['/', '/dashboard']) {
      await page.goto(path);
      await expect.poll(() => new URL(page.url()).pathname, path).toBe('/markets');
    }
  });

  test('a page named in a `?tab=` opens the plan, with no forward', async ({
    authenticatedPage: page,
  }) => {
    for (const tab of ['form', 'assignment']) {
      await page.goto(`${at(published, 'setup')}?tab=${tab}`);
      await activeTab(page, 'setup');
      await expect(page).toHaveURL(new RegExp(`/markets/${published}/setup\\?tab=${tab}$`));
    }
  });

  test('a removed market page is "Page not found", signed in', async ({
    authenticatedPage: page,
  }) => {
    await page.goto(`${at(published, 'tables')}?date=2026-07-15`);
    await expectNotFound(page, `${at(published, 'tables')}?date=2026-07-15`, 'Markets');
  });

  test('a removed market page is "Page not found", signed out', async ({ page }) => {
    await page.goto(at(published, 'tables'));
    await expectNotFound(page, at(published, 'tables'), 'Sign in');
  });

  for (const path of REMOVED) {
    test(`${path} is "Page not found", signed in`, async ({ authenticatedPage: page }) => {
      await page.goto(path);
      await expectNotFound(page, path, 'Markets');
    });

    test(`${path} is "Page not found", signed out`, async ({ page }) => {
      await page.goto(path);
      await expectNotFound(page, path, 'Sign in');
    });
  }

  test('the Register tab on sign-in stays, without an address of its own', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.switchToRegister();
    await expect(login.registerForm).toBeVisible();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login');
  });

  // The one-segment addresses answer for a market now, so a market may be called any of them.
  for (const [path, name] of FREED_NAMES) {
    test(`a market named ${name} opens its public page at ${path}`, async ({ page, request }) => {
      const { marketId } = await seedApplicantMarket(
        request,
        BACKEND_URL,
        TEST_USER.email,
        TEST_USER.password,
        { name },
      );
      try {
        await page.goto(path);
        await expect(page.getByTestId('market-home-name')).toHaveText(name);
        await expect(page.getByTestId('page-not-found')).toHaveCount(0);
        await expect.poll(() => new URL(page.url()).pathname).toBe(path);
      } finally {
        // The addresses above answer as absent only while no market holds the name.
        const deleted = await request.delete(`${BACKEND_URL}/markets/${marketId}`, {
          headers: { 'X-Owner-Email': TEST_USER.email },
        });
        expect(deleted.ok(), await deleted.text()).toBeTruthy();
      }
    });
  }

  test('the flows carry the bar with their tab active', async ({ authenticatedPage: page }) => {
    await page.goto(at(assigned, 'import'));
    await activeTab(page, 'applications');
    await page.goto(at(assigned, 'floorplan'));
    await activeTab(page, 'setup');
  });

  test('a market opens on the page it is worked on in its phase', async ({
    authenticatedPage: page,
    request,
  }) => {
    await page.goto(at(assigned));
    await expect(page).toHaveURL(new RegExp(`/markets/${assigned}/assignments$`), {
      timeout: 15000,
    });

    await page.goto(at(published));
    await expect(page).toHaveURL(new RegExp(`/markets/${published}/attendance$`), {
      timeout: 15000,
    });

    const draft = await seedMarketWithVendors(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.goto(at(draft.marketId));
    await expect(page).toHaveURL(new RegExp(`/markets/${draft.marketId}/setup$`), {
      timeout: 15000,
    });

    // A tab opens the page carrying the dot when it holds it.
    await page.goto(at(assigned, 'setup'));
    await page.getByTestId('market-bar-tab-assignment').click();
    await expect(page).toHaveURL(new RegExp(`/markets/${assigned}/assignments$`));
  });

  test('Attendance opens the moment the market is published', async ({
    authenticatedPage: page,
    request,
  }) => {
    const market = (
      await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password)
    ).marketId;
    await publishResults(request, BACKEND_URL, TEST_USER.email, market);
    await page.goto(at(market, 'settings'));
    await activeTab(page, 'assignment');
    // The tab is there from draft (E31/F03/S02); before publishing it says when it opens.
    await page.getByTestId('market-bar-tab-attendance').click();
    await expect(page.getByTestId('market-tab-note')).toHaveText(
      'Opens when the market is published.',
    );

    await page.getByTestId('phase-transition-market_days').click();
    await page.getByTestId('sweep-confirm-submit-button').click();

    await expect(page.getByTestId('market-tab-note')).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByTestId('attendance-summary')).toBeVisible();
  });

  test('no market page keeps a Back button of its own', async ({ authenticatedPage: page }) => {
    for (const where of ['assignments', 'vendors', 'attendance']) {
      await page.goto(at(published, where));
      await expect(page.getByTestId('market-bar-title')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-testid$="-back-button"]')).toHaveCount(0);
    }
  });
});
