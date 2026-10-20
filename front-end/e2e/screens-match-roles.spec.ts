import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';

/**
 * A market's screens offer each person only what their role lets them do (bug 37, E26/F08/S01).
 *
 * A Viewer was shown every editing control - the calendar, every "+", Open Applications, More… -
 * and an edit appeared to work until its save failed with a 403 in the server's words, the edit
 * still on screen. The server was right; the screens did not know who was looking.
 */
const VIEWER = { email: 'e2e-role-viewer@example.com', password: 'e2epassword123' };
const EDITOR = { email: 'e2e-role-editor@example.com', password: 'e2epassword123' };

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
  await withUser(browser, VIEWER.email, VIEWER.password, async (page) => {
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

// A verdict is EDITOR's since E34/F01/S01: a reviewing team needs no role that moves the phase.
test('an Editor changes the seats and decides, but moves no phase', async ({ browser }) => {
  await withUser(browser, EDITOR.email, EDITOR.password, async (page) => {
    await page.goto(marketSetupPath(marketId, 'setup'));
    await expect(page.getByTestId('plan-card-dates')).toBeVisible({ timeout: 15000 });
    // Past draft nobody changes the setup (E31/F01/S03): the reason is the market's, not the role's.
    await expect(page.getByTestId('market-read-only')).toContainText('The setup is settled');
    await expect(page.getByTestId('market-read-only')).not.toContainText('editing access');
    await expect(page.locator('.rail-button--forward')).toHaveCount(0);
    await expect(page.getByTestId('phase-rail-menu-button')).toHaveCount(0);

    await page.goto(marketScreenPath(marketId, 'result'));
    await expect(page.locator('button.seat-button').first()).toBeVisible({ timeout: 15000 });

    await page.goto(marketSetupPath(marketId, 'applications'));
    await page.getByTestId('app-monitor-decided-toggle').click();
    await expect(page.getByTestId('app-monitor-decided-row').first()).toBeVisible();
    await expect(page.getByTestId('app-monitor-decided-reject-button').first()).toBeVisible();
    // Publishing the verdicts stays an admin's.
    await expect(page.getByTestId('app-monitor-publish-button')).toHaveCount(0);
  });
});

test('an Editor of a market importing is shown the import, and told only an admin imports', async ({
  browser,
  request,
}) => {
  // Importing is offered only while the market imports (E32/F02/S03), and is an admin's (bug 37).
  const importing = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject(), intakeMode: 'csv' },
  );
  const res = await request.post(`${BACKEND_URL}/markets/${importing.marketId}/roles`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: { user_email: EDITOR.email, role: 'editor' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  await withUser(browser, EDITOR.email, EDITOR.password, async (page) => {
    await page.goto(marketSetupPath(importing.marketId, 'applications'));
    await expect(page.getByTestId('market-setup-import-button')).toBeDisabled({ timeout: 15000 });
    await expect(page.getByTestId('market-setup-import-blocked-reason')).toBeVisible();
  });
});
