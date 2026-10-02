import type { Browser, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, LoginPage } from './fixtures';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * A market's screens offer each person only what their role lets them do (bug 37, E26/F08/S01).
 *
 * A Viewer was shown every editing control - the calendar, every "+", Open Applications, More… -
 * and an edit appeared to work until its save failed with a 403 in the server's words, the edit
 * still on screen. The server was right; the screens did not know who was looking.
 */
const VIEWER = { email: 'e2e-role-viewer@example.com', password: 'e2epassword123' };
const EDITOR = { email: 'e2e-role-editor@example.com', password: 'e2epassword123' };

async function asUser(
  browser: Browser,
  user: { email: string; password: string },
  body: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const login = new LoginPage(page);
    await login.login(user.email, user.password);
    await login.waitForDashboardRedirect();
    await body(page);
  } finally {
    await context.close();
  }
}

let marketId: string;

test.beforeAll(async ({ request }) => {
  ensureVerifiedUser(VIEWER.email, VIEWER.password);
  ensureVerifiedUser(EDITOR.email, EDITOR.password);
  ({ marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  ));
  for (const [user, role] of [
    [VIEWER, 'viewer'],
    [EDITOR, 'editor'],
  ] as const) {
    const res = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { user_email: user.email, role },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
});

test('a Viewer reads every market page and is offered nothing to change', async ({ browser }) => {
  await asUser(browser, VIEWER, async (page) => {
    await page.goto(marketSetupPath(marketId, 'setup'));
    await expect(page.getByTestId('market-read-only')).toContainText('view this market', {
      timeout: 15000,
    });
    await expect(page.getByTestId('plan-card-dates').getByRole('button').first()).toBeDisabled();
    // No phase moves, on the rail or behind it.
    await expect(page.getByTestId('phase-rail')).toBeVisible();
    await expect(page.locator('.rail-button--forward')).toHaveCount(0);
    await expect(page.getByTestId('phase-rail-menu-button')).toHaveCount(0);

    await page.goto(marketScreenPath(marketId, 'result'));
    await expect(page.getByTestId('tables-seat-occupied').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('button.seat-button')).toHaveCount(0);

    await page.goto(marketSetupPath(marketId, 'applications'));
    await page.getByTestId('app-monitor-decided-toggle').click();
    await expect(page.getByTestId('app-monitor-decided-row').first()).toBeVisible();
    await expect(page.getByTestId('app-monitor-decided-reject-button')).toHaveCount(0);
  });
});

test('an Editor changes the plan and the seats, but moves no phase and decides nothing', async ({
  browser,
}) => {
  await asUser(browser, EDITOR, async (page) => {
    await page.goto(marketSetupPath(marketId, 'setup'));
    await expect(page.getByTestId('plan-card-dates')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('market-read-only')).toHaveCount(0);
    await expect(page.getByTestId('plan-card-dates').getByRole('button').first()).toBeEnabled();
    await expect(page.locator('.rail-button--forward')).toHaveCount(0);
    await expect(page.getByTestId('phase-rail-menu-button')).toHaveCount(0);

    await page.goto(marketScreenPath(marketId, 'result'));
    await expect(page.locator('button.seat-button').first()).toBeVisible({ timeout: 15000 });

    await page.goto(marketSetupPath(marketId, 'applications'));
    await page.getByTestId('app-monitor-decided-toggle').click();
    await expect(page.getByTestId('app-monitor-decided-row').first()).toBeVisible();
    await expect(page.getByTestId('app-monitor-decided-reject-button')).toHaveCount(0);
  });
});
