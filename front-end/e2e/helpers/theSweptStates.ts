import type {
  Page,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  TestType,
} from '@playwright/test';
import { expect, TEST_USER, NO_ORG_USER, BACKEND_URL, LoginPage } from '../fixtures';
import { marketScreenPath, marketSetupPath } from './marketScreens';
import { ensureTestOrg, seedPublishedMarketWithAssignments } from './seeds';
import { seedApplicantMarket } from './seedApplicantMarket';
import { seedApplication } from './seedApplication';

/** What a sweep asserts of the page as it stands, named for the state it is in. */
export type Check = (state: string) => Promise<void>;

/** A test whose `check` fixture is the sweep's own: contrast, or what axe can see. */
export type SweepTest = TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & { authenticatedPage: Page; check: Check },
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;

/**
 * Every screen and deliberate state the sweeps walk, with `check` run at each.
 *
 * **A sweep is only worth the states it walks.** A twenty-screen pass missed the invisible
 * archive-confirmation button entirely, because nobody opened that dialog. So the dialogs, menus,
 * disabled controls and empty states below are named deliberately, and the list is part of the
 * deliverable (`docs/design-system.md`, "What keeps this true").
 *
 * One list for every sweep, so a state added for one is walked by all: the contrast sweep
 * (`contrast-sweep.spec.ts`) and the accessibility sweep (`accessibility-sweep.spec.ts`) each pass
 * their own `check` and nothing else.
 */
export function walkTheSweptStates(test: SweepTest): void {
  let marketId: string;
  let marketSlug: string;

  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const seeded = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    marketId = seeded.marketId;
    marketSlug = seeded.marketSlug;
  });

  async function openTheSeededMarket(page: Page): Promise<void> {
    await page.goto('/login');
    await page.evaluate((user) => {
      localStorage.setItem('user', JSON.stringify(user));
    }, TEST_USER.email);
  }

  test('the screens', async ({ authenticatedPage: page, check }) => {
    await openTheSeededMarket(page);
    for (const [state, url, ready] of [
      ['dashboard', '/dashboard', 'dashboard-has-markets'],
      // The count, not "New market": the button is drawn before the list arrives, and on a stack
      // holding thousands of markets the sweep measured "Loading markets..." and nothing else.
      ['markets', '/markets', 'markets-result-count'],
      ['market plan', marketSetupPath(marketId, 'setup'), 'setup-dates-date-display-0'],
      // The densest authoring surface in the product, and unwalked until E17/F03/S01 - which is
      // how a field-type badge shipped at 3.73:1 on it.
      ['application form', marketSetupPath(marketId, 'form'), 'form-steps'],
      // A published market: its rules read as settled (E22/F02/S02).
      ['assignment', marketSetupPath(marketId, 'assignment'), 'assignment-rules-settled'],
      ['result', marketScreenPath(marketId, 'result'), 'result-strip'],
      ['vendors', marketScreenPath(marketId, 'vendors'), 'vendors-search-input'],
      ['attendance', marketScreenPath(marketId, 'attendance'), 'market-bar-title'],
    ] as const) {
      await page.goto(url);
      await expect(page.getByTestId(ready)).toBeVisible({ timeout: 15000 });
      await check(state);
    }

    // The form tab is steps, each its own surface (E33/F01/S01): the sweep is only worth the
    // states it opens, so it opens every one this market's form has.
    await page.goto(marketSetupPath(marketId, 'form'));
    const steps = page.getByTestId('form-steps').getByRole('button');
    await expect(steps.first()).toBeVisible({ timeout: 15000 });
    for (const step of await steps.all()) {
      const label = (await step.textContent()) ?? '';
      await step.click();
      await expect(step).toHaveAttribute('aria-current', 'step');
      await check(`application form, ${label}`);
    }
  });

  test('sign-in, and the public check-in page', async ({ page, check }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-submit-button')).toBeVisible({ timeout: 10000 });
    await check('/login');

    await page.goto(`/${marketSlug}/check-in`);
    await expect(page.getByTestId('attendance-checkin-market-name')).toBeVisible({
      timeout: 10000,
    });
    await check('/check-in');
  });

  test('the states a screenshot pass never opens', async ({ authenticatedPage: page, check }) => {
    // The invisible archive-confirmation button lived here, behind two clicks, and a twenty-screen
    // walk never found it.
    await openTheSeededMarket(page);
    await page.goto(marketScreenPath(marketId, 'result'));
    await expect(page.getByTestId('tables-count-assigned')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('phase-rail-menu-button').click();
    await expect(page.locator('.rail-menu-item').first()).toBeVisible();
    await check('the phase-rail menu');

    await page.locator('.rail-menu-item--end').click();
    await expect(page.getByTestId('archive-confirm-window')).toBeVisible({ timeout: 5000 });
    await check('the archive confirmation');

    // And the button is actually there, which is the whole of S01.
    const archive = page.getByTestId('archive-confirm-submit-button');
    const painted = await archive.evaluate((el) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, border: style.borderWidth };
    });
    expect(painted.background, 'the archive button has no fill').not.toBe('rgba(0, 0, 0, 0)');

    // Leave the market as it was found. Cancel, never confirm: archiving is permanent, so a spec
    // that went through with it would only pass once.
    await page.getByTestId('archive-confirm-cancel-button').click();
    await expect(page.getByTestId('archive-confirm-window')).toBeHidden();
  });

  test('the navigation drawer, open', async ({ authenticatedPage: page, check }) => {
    // The app's own menu, behind the banner's button on every organizer screen.
    await page.getByTestId('app-menu-button').click();
    await expect(page.getByTestId('app-nav')).toBeVisible();
    await check('the navigation drawer');
  });

  test('an organizer with no market yet', async ({ page, check }) => {
    // The empty states: the first thing a new organizer sees, and nothing on them is seeded.
    const loginPage = new LoginPage(page);
    await loginPage.login(NO_ORG_USER.email, NO_ORG_USER.password);
    await loginPage.waitForDashboardRedirect();
    await expect(page.getByTestId('dashboard-no-market-yet')).toBeVisible({ timeout: 15000 });
    await check('the dashboard, with no market');

    await page.goto('/markets');
    await expect(page.getByTestId('markets-empty')).toBeVisible({ timeout: 15000 });
    await check('the markets list, with no market');
  });

  test('the statistics, open and under the pointer', async ({ authenticatedPage: page, check }) => {
    // The ledger of bars (E35/F03/S01): a share in muted ink on white, and on a hovered row's beige.
    await openTheSeededMarket(page);
    await page.goto(`${marketScreenPath(marketId, 'result')}?stats=open`);
    const row = page.getByTestId('result-statistics-date').first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await check('the statistics');
    await row.hover();
    await check('a hovered statistics row');
  });

  test('a market tab under the pointer', async ({ authenticatedPage: page, check }) => {
    // Hover is a state too, and none was walked: the tab bar's hover set its label to the border
    // token, a 25% near-black, on the black bar - invisible under the pointer (E21/F01/S01).
    await openTheSeededMarket(page);
    await page.goto(marketSetupPath(marketId, 'setup'));
    const tab = page.getByTestId('market-bar-tab-applications');
    await expect(tab).toBeVisible({ timeout: 15000 });
    await tab.hover();
    await check('a hovered market tab');
  });

  test('a review card, and the verdicts already given', async ({
    authenticatedPage: page,
    request,
    check,
  }) => {
    // A status is a tinted chip now, on the card's own beige ground as well as on white (bug 43),
    // and no screen above opens either.
    const { marketId: reviewing } = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    for (const email of ['nadia@ember.test', 'rafi@kiln.test', 'theo@thistle.test']) {
      seedApplication(reviewing, email, { business_name: 'Ember Ceramics', product_type: 'Pots' });
    }
    await page.goto(marketSetupPath(reviewing, 'applications'));
    await expect(page.getByTestId('app-monitor-card')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('app-monitor-approve-button').click();
    await page.getByTestId('app-monitor-reject-button').click();
    await page.getByTestId('app-monitor-decided-toggle').click();
    await expect(page.getByTestId('app-monitor-decided-row')).toHaveCount(2);
    await check('a review card and its verdicts');
  });

  test('the new-market dialog, where a disabled primary lives', async ({
    authenticatedPage: page,
    check,
  }) => {
    await page.goto('/markets');
    await page.getByTestId('markets-create-button').click();
    await expect(page.getByTestId('new-market-name-input')).toBeVisible({ timeout: 5000 });
    await check('the new-market dialog');
  });
}
