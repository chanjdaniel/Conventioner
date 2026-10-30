import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';
import { TablesPage } from './pages/TablesPage';
import { VendorsPage } from './pages/VendorsPage';

/**
 * The vendor drawer takes focus as it opens and gives it back as it closes, on every screen that
 * opens it (T123), as a dialog does (T45).
 *
 * It moved no focus in, and the row or name that opened it went inert behind it, so closing left
 * focus on `<body>` and a keyboard user started again from the top of the page after every vendor.
 * Each opener is reached and pressed from the keyboard, and the drawer is closed each way a user
 * closes it.
 */
const ON_THE_DAY = '2099-05-02';

/** Opens the drawer from `opener` by the keyboard, and finds focus on its close. */
async function openByKeyboard(page: Page, opener: Locator): Promise<void> {
  await opener.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('vendors-detail-close')).toBeFocused();
}

/** Closes the drawer `how`, and finds focus back on `opener`. */
async function closeAndFindFocusOn(
  page: Page,
  opener: Locator,
  how: 'Escape' | 'its close' | 'the scrim',
): Promise<void> {
  if (how === 'Escape') await page.keyboard.press('Escape');
  else if (how === 'its close') await page.keyboard.press('Enter');
  // The scrim's left edge, which the drawer never covers.
  else await page.getByTestId('vendors-detail-overlay').click({ position: { x: 5, y: 300 } });
  await expect(page.getByTestId('vendors-detail-close')).toBeHidden();
  await expect(opener).toBeFocused();
}

test('the drawer gives focus back to the row, the seat and the name that opened it', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { marketDate: ON_THE_DAY },
  );

  // The Vendors page: a row.
  const vendors = new VendorsPage(page);
  await vendors.goto(seed.marketId);
  const row = vendors.vendorListItems.first();
  await expect(row).toBeVisible({ timeout: 10000 });
  await openByKeyboard(page, row);
  await closeAndFindFocusOn(page, row, 'Escape');
  await openByKeyboard(page, row);
  await closeAndFindFocusOn(page, row, 'its close');

  // The Result page: a seat's name.
  const tables = new TablesPage(page);
  await tables.goto(seed.marketId);
  const seat = page.getByTestId('tables-seat-occupied').first();
  await expect(seat).toBeVisible({ timeout: 10000 });
  const name = seat.getByTestId('tables-seat-vendor');
  await openByKeyboard(page, name);
  await closeAndFindFocusOn(page, name, 'the scrim');

  // The door: a vendor's name.
  const attendance = new AttendanceStatusPage(page);
  await attendance.goto(seed.marketId);
  const atTheDoor = attendance.vendor('bob@example.com');
  await expect(atTheDoor).toBeVisible({ timeout: 10000 });
  await openByKeyboard(page, atTheDoor);
  await closeAndFindFocusOn(page, atTheDoor, 'Escape');
});
