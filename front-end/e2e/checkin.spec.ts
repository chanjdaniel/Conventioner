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

  test('names the market before the vendor types anything', async ({ page, request }) => {
    // The page read "Vendor Check-in" until after a lookup, so a vendor handed a QR code at a
    // door had to enter their address to find out whether they were in the right place.
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );

    const checkinPage = new CheckinPage(page);
    await checkinPage.goto(seed.marketSlug);

    await expect(checkinPage.marketName).toHaveText(seed.marketName, { timeout: 10000 });
    await expect(checkinPage.emailInput).toHaveValue('');
  });

  test('a check-in on the wrong day can be undone', async ({ page, request }) => {
    // Every date offered an identical button with nothing marking today, so on a multi-day market
    // one mis-tap recorded a vendor present on a day they were not - and there was no way back.
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

    await checkinPage.clickUndo();

    await expect(checkinPage.confirmationPills).toHaveCount(0, { timeout: 10000 });
    await expect(checkinPage.checkinButtons.first()).toBeVisible();
  });

  test('the vendor is greeted by name, with the address they matched on', async ({
    page,
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

    const vendor = page.getByTestId('attendance-checkin-vendor');
    await expect(vendor).toBeVisible({ timeout: 10000 });
    await expect(vendor).toContainText('Alice Example');
    // The address stays: it is what this lookup matched on, and how a vendor spots that they
    // typed someone else's.
    await expect(vendor).toContainText('alice@example.com');
  });

  test('the confirmation states a time a person would say aloud', async ({ page, request }) => {
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

    const pill = checkinPage.confirmationPills.first();
    await expect(pill).toBeVisible({ timeout: 10000 });

    // "9/15/2026, 7:20:18 AM" was a machine's idea of a time. No seconds, and a named month.
    await expect(pill).toHaveText(
      /Checked in .* [A-Z][a-z]{2} \d{1,2}, \d{4} at \d{1,2}:\d{2} (AM|PM)/,
    );
  });
});
