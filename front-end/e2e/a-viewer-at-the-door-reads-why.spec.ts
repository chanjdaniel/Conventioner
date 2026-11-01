import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { SEED_MARKET_DATE, seedPublishedMarketWithAssignments } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';
import { LoginPage } from './pages/LoginPage';

/**
 * A Viewer at the door reads why they cannot check vendors in (E38/F15/S04).
 *
 * Before the market is published the Attendance tab's note stands in for its page, and the
 * read-only line is left out under it, which a walk took for the line missing. In Market Days the
 * door is the page, so a Viewer reads the line there as on every other page, and is offered no
 * Check in and no Undo, on a phone at the door as at a desk.
 */
const VIEWER = { email: 'e2e-door-viewer@example.com', password: 'e2epassword123' };
const HERE = 'alice@example.com';
const NOT_YET = 'bob@example.com';

const SIZES = [
  {
    name: 'on a phone',
    use: {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    },
  },
  { name: 'at a desk', use: { viewport: { width: 1440, height: 900 } } },
] as const;

let marketId: string;

test.beforeAll(async ({ request }) => {
  ensureVerifiedUser(VIEWER.email, VIEWER.password);
  ({ marketId } = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  ));
  // The seed leaves the owner's session on `request`: they make the Viewer one, and check one
  // vendor in, so the door has a row an Undo would stand on.
  const role = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: VIEWER.email, role: 'viewer' },
  });
  expect(role.ok(), await role.text()).toBeTruthy();
  const checkIn = await request.post(`${BACKEND_URL}/markets/${marketId}/attendance`, {
    data: { vendorEmail: HERE, date: SEED_MARKET_DATE },
  });
  expect(checkIn.ok(), await checkIn.text()).toBeTruthy();
});

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use(size.use);

    // Signed in on the test's own page, so the size above is the window the door is drawn in.
    test('a Viewer reads the read-only line at the door, and is offered no check-in', async ({
      page,
    }) => {
      const login = new LoginPage(page);
      await login.login(VIEWER.email, VIEWER.password);
      await login.waitForDashboardRedirect();
      expect(await page.evaluate(() => window.innerWidth)).toBe(size.use.viewport.width);
      const door = new AttendanceStatusPage(page);
      await door.goto(marketId);
      await expect(door.row(NOT_YET)).toBeVisible({ timeout: 15000 });
      await expect(door.row(HERE)).toBeVisible();
      await expect(door.status(HERE)).not.toHaveText('Not yet');

      await expect(door.readOnly).toHaveCount(1);
      await expect(door.readOnly).toBeVisible();
      await expect(door.readOnly).toContainText('You can view this market but not change it.');
      // No tab's note stands in for the door once the market is published.
      await expect(page.getByTestId('market-tab-note')).toHaveCount(0);

      await expect(door.checkIns).toHaveCount(0);
      await expect(door.undos).toHaveCount(0);
    });
  });
}
