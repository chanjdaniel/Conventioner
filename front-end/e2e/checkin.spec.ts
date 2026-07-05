import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { CheckinPage } from './pages/CheckinPage';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';

test.describe('Public vendor check-in', () => {
  test('vendor looks up assignment, checks in, confirmation pill appears, and attendance shows timestamp', async ({
    page,
    authenticatedPage: ownerPage,
    request,
  }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );

    const checkinPage = new CheckinPage(page);
    await checkinPage.goto(seed.marketSlug);

    await checkinPage.fillEmail('alice@example.com');
    await checkinPage.clickLookup();

    await expect(checkinPage.checkinButtons.first()).toBeVisible({ timeout: 10000 });

    await checkinPage.clickCheckIn();

    await expect(checkinPage.confirmationPills.first()).toBeVisible({ timeout: 10000 });

    const attendancePage = new AttendanceStatusPage(ownerPage);
    await attendancePage.goto(seed.marketId);

    const vendorCells = attendancePage.getVendorRowCells('alice@example.com');
    await expect(vendorCells.first()).toBeVisible({ timeout: 10000 });

    const allCellTexts = await vendorCells.allTextContents();
    const timestampCells = allCellTexts.filter(
      (t) => t.trim() !== '\u2014' && t.trim() !== 'alice@example.com',
    );
    expect(timestampCells.length).toBeGreaterThan(0);
  });
});
