import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { SEED_MARKET_DATE } from './helpers/seeds';
import { marketScreenPath } from './helpers/marketScreens';
import { TablesPage } from './pages/TablesPage';
import { VendorsPage } from './pages/VendorsPage';

/**
 * Change placement shows the vendor's table (E35/F02/S02).
 *
 * Change placement, on a placement in the vendor drawer, opened the results scoped to the date
 * alone, so the organizer still hunted the day's tables for the one to change. It sets the search
 * to the vendor as well, so their table on that date is the one shown, ready to change.
 */
const DAY_TWO = '2099-05-02';

test("from a vendor's placement on day 2, the results show only their day-2 table", async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    dates: [SEED_MARKET_DATE, DAY_TWO],
  });
  const vendors = new VendorsPage(page);
  await page.goto(marketScreenPath(seed.marketId, 'vendors'));
  await vendors.vendorListItems.filter({ hasText: 'alice@example.com' }).click();
  await vendors.openTab('assignments');

  const dayTwo = vendors.detailAssignmentItems.filter({ hasText: /May 2, 2099/ });
  await dayTwo.getByTestId('vendor-date-card-place-link').click();

  await page.waitForURL(/\/result\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get('date')).toBe(DAY_TWO);
  expect(url.searchParams.get('search')).toBe('alice@example.com');
  // The results, not the drawer over them.
  await expect(page.getByTestId('vendors-detail-panel')).not.toBeInViewport();

  const tables = new TablesPage(page);
  await expect(tables.tableRows).toHaveCount(1);
  const seat = tables.tableRows.first().getByTestId('tables-seat-occupied');
  await expect(seat).toHaveAttribute('data-vendor-email', 'alice@example.com');
  // Ready to change at once.
  await tables.change(seat);
  await expect(tables.dialog).toBeVisible();
  await page.keyboard.press('Escape');

  // Clearing the filters shows the whole result: both dates, everyone.
  await tables.clearAllFilters();
  await expect(tables.tableRows).toHaveCount(10);
});
