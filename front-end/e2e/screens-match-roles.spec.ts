import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import {
  ensureOrganizationAdmin,
  seedPublishedMarketWithAssignments,
  type PublishedSeedResult,
} from './helpers/seeds';
import { MarketsPage } from './pages/MarketsPage';
import { TablesPage } from './pages/TablesPage';
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
const ORG_ADMIN = { email: 'e2e-role-org-admin@example.com', password: 'e2epassword123' };

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
    // Said once, by the frame (T15); the plan says only its own lock, the settled setup.
    await expect(page.getByTestId('market-read-only')).toHaveCount(1);
    await expect(page.getByTestId('plan-setup-settled')).toContainText('The setup is settled');
    await expect(page.getByTestId('plan-card-dates').getByRole('button').first()).toBeDisabled();
    // No phase moves, on the rail or behind it.
    await expect(page.getByTestId('phase-rail')).toBeVisible();
    await expect(page.locator('.rail-button--forward')).toHaveCount(0);
    await expect(page.getByTestId('phase-rail-menu-button')).toHaveCount(0);

    await page.goto(marketScreenPath(marketId, 'result'));
    await expect(page.getByTestId('tables-seat-occupied').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('button.seat-button')).toHaveCount(0);
    // And says why, on the page whose seats are plain text: a Viewer took it for broken (T15).
    await expect(page.getByTestId('market-read-only')).toContainText('view this market');

    await page.goto(marketSetupPath(marketId, 'applications'));
    await page.getByTestId('app-monitor-decided-toggle').click();
    await expect(page.getByTestId('app-monitor-decided-row').first()).toBeVisible();
    await expect(page.getByTestId('app-monitor-decided-reject-button')).toHaveCount(0);
    await expect(page.getByTestId('market-read-only')).toHaveCount(1);
  });
});

// A verdict is EDITOR's since E34/F01/S01 (a-verdict-says-who.spec.ts), but this market is assigning,
// and the review closed on the way in (E36/F01/S01): the Editor reads the verdicts and changes seats.
test('an Editor changes the seats, but neither decides nor moves a phase once assigning', async ({
  browser,
}) => {
  await withUser(browser, EDITOR.email, EDITOR.password, async (page) => {
    await page.goto(marketSetupPath(marketId, 'setup'));
    await expect(page.getByTestId('plan-card-dates')).toBeVisible({ timeout: 15000 });
    // Past draft nobody changes the setup (E31/F01/S03): the reason is the market's, not the role's.
    await expect(page.getByTestId('plan-setup-settled')).toContainText('The setup is settled');
    await expect(page.getByTestId('market-read-only')).toHaveCount(0);
    await expect(page.locator('.rail-button--forward')).toHaveCount(0);
    await expect(page.getByTestId('phase-rail-menu-button')).toHaveCount(0);

    await page.goto(marketScreenPath(marketId, 'result'));
    await expect(page.locator('button.seat-button').first()).toBeVisible({ timeout: 15000 });

    await page.goto(marketSetupPath(marketId, 'applications'));
    await page.getByTestId('app-monitor-decided-toggle').click();
    await expect(page.getByTestId('app-monitor-decided-row').first()).toBeVisible();
    await expect(page.getByTestId('app-monitor-decided-reject-button')).toHaveCount(0);
    await expect(page.getByTestId('market-setup-applications-condition')).toContainText(
      'The review is closed',
    );
    // Publishing the verdicts stays an admin's.
    await expect(page.getByTestId('app-monitor-publish-button')).toHaveCount(0);
  });
});

test('an Editor of a Google Form market is offered no import, and told only an admin imports', async ({
  browser,
  request,
}) => {
  // Importing is an admin's (bug 37): the rail offers an Editor no Import responses, and the
  // import itself says why. A draft, so its first import is still to come (E38/F04/S01).
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
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Draft', { timeout: 15000 });
    await expect(page.getByTestId('phase-rail-fix')).toHaveCount(0);
    await page.goto(marketScreenPath(importing.marketId, 'import'));
    await expect(page.getByTestId('import-wrong-phase')).toContainText('not yours to do', {
      timeout: 15000,
    });
    await expect(page.getByTestId('import-upload')).toHaveCount(0);
  });
});

/*
 * An organization's admins run every market it holds (T15). Membership gave Viewer even to them,
 * so the admin running a market on the day met its seats as plain text and could swap none.
 */
test.describe('an organization admin with no role on the market', () => {
  let published: PublishedSeedResult;

  test.beforeAll(async ({ request }) => {
    ensureVerifiedUser(ORG_ADMIN.email, ORG_ADMIN.password);
    published = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await ensureOrganizationAdmin(request, BACKEND_URL, published.orgId, ORG_ADMIN.email);
  });

  test('swaps two seats on market day, and is offered what a market admin is', async ({
    browser,
  }) => {
    await withUser(browser, ORG_ADMIN.email, ORG_ADMIN.password, async (page) => {
      const tables = new TablesPage(page);
      await tables.goto(published.marketId);
      await expect(tables.tableRows.first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('market-read-only')).toHaveCount(0);

      const seats = page.getByTestId('tables-seat-occupied');
      await expect(seats.nth(1)).toBeVisible();
      const first = await tables.occupantOf(seats.nth(0));
      const second = await tables.occupantOf(seats.nth(1));
      const firstTable = await tables.tableCodeOf(seats.nth(0));
      const secondTable = await tables.tableCodeOf(seats.nth(1));
      // A Viewer's seats carry no Change: the seat is plain text.
      await expect(seats.nth(0).getByTestId('tables-seat-change')).toBeVisible();
      await tables.change(seats.nth(0));
      await tables.swapWith(second);
      await expect(tables.dialog).toBeHidden();
      await expect(tables.row(firstTable).locator(`[data-vendor-email="${second}"]`)).toBeVisible();
      await expect(tables.row(secondTable).locator(`[data-vendor-email="${first}"]`)).toBeVisible();

      // The phase moves are an admin's, so the rail offers them.
      await expect(page.getByTestId('phase-rail-menu-button')).toBeVisible();

      // And the market's card offers Manage, as it does a market admin.
      const markets = new MarketsPage(page);
      await markets.goto();
      await markets.searchInput.fill(published.marketName);
      await expect(
        markets.card(published.marketName).getByTestId('market-card-manage-button'),
      ).toBeVisible({ timeout: 15000 });
    });
  });
});
