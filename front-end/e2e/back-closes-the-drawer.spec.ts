import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { SEED_MARKET_DATE, seedPublishedMarketWithAssignments } from './helpers/seeds';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';
import { TablesPage } from './pages/TablesPage';
import { VendorsPage } from './pages/VendorsPage';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * Back closes the vendor drawer (E38/F13/S01).
 *
 * The drawer opened and closed by replacing the address, so a phone's back gesture with it open left
 * the page: from Vendors, it went to the dashboard. Opening it is a step of the browser's history
 * now, and closing it takes that step back, so Back closes the drawer and leaves the page as it was,
 * its search and scroll included. A drawer reached by a link or a reload has no step to take back,
 * and closing it stays on the page.
 */
const ON_THE_DAY = '2099-05-02';

/** A door long enough to scroll on a phone. */
const VENDORS = Array.from(
  { length: 24 },
  (_, i) => `door${String(i + 1).padStart(2, '0')}@example.com`,
);
const LAST = VENDORS[VENDORS.length - 1];

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

/** The page is where it was: no drawer, the same search, the same scroll. */
async function expectThePageAsItWas(
  page: Page,
  path: string,
  search: Locator,
  scrolled: number,
): Promise<void> {
  await expect(page.getByTestId('vendors-detail-close')).toBeHidden();
  await expect(page).toHaveURL((url) => url.pathname === path && !url.searchParams.has('vendor'));
  await expect(search).toHaveValue('door');
  expect(await scrollY(page)).toBe(scrolled);
}

test.describe('on a phone', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('Back closes the drawer on Attendance and on Vendors, and a second Back leaves the page', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { marketDate: ON_THE_DAY, vendors: VENDORS },
    );

    // Attendance: search, scroll to the last vendor, open their drawer, and Back.
    await page.goto('/dashboard');
    const attendance = new AttendanceStatusPage(page);
    await attendance.goto(seed.marketId);
    const attendancePath = new URL(page.url()).pathname;
    await attendance.search.fill('door');
    await expect(attendance.rows).toHaveCount(VENDORS.length);
    const name = attendance.vendor(LAST);
    await name.scrollIntoViewIfNeeded();
    const atTheDoor = await scrollY(page);
    expect(atTheDoor).toBeGreaterThan(0);

    await name.tap();
    await expect(page.getByTestId('vendors-detail-email')).toHaveText(LAST);
    await page.goBack();
    await expectThePageAsItWas(page, attendancePath, attendance.search, atTheDoor);
    await expect(attendance.status(LAST)).toHaveText('Not yet');

    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);

    // Vendors: the same, from its own list.
    await page.goto('/dashboard');
    const vendors = new VendorsPage(page);
    await vendors.goto(seed.marketId);
    const vendorsPath = new URL(page.url()).pathname;
    await vendors.search('door');
    await expect(vendors.vendorListItems).toHaveCount(VENDORS.length);
    const row = vendors.vendorListItems.last();
    await row.scrollIntoViewIfNeeded();
    const inTheList = await scrollY(page);
    expect(inTheList).toBeGreaterThan(0);

    await row.tap();
    await expect(vendors.detailCloseButton).toBeVisible();
    await page.goBack();
    await expectThePageAsItWas(page, vendorsPath, vendors.searchInput, inTheList);

    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('one Back closes the drawer whatever tab it is on, and closing it leaves no step behind', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const vendors = new VendorsPage(page);
    const vendorsPath = marketScreenPath(seed.marketId, 'vendors');

    // Two tab changes are no steps of their own.
    await page.goto('/dashboard');
    await vendors.goto(seed.marketId);
    await vendors.clickVendor(0);
    await vendors.openTab('assignments');
    await vendors.openTab('history');
    await expect(page).toHaveURL(/vendorTab=history/);
    await page.goBack();
    await expect(vendors.detailCloseButton).toBeHidden();
    await expect(page).toHaveURL((url) => url.pathname === vendorsPath && url.search === '');

    // The close button, Escape and a tap outside each take the step back: Back after them leaves
    // the page, rather than opening the drawer again.
    const closes: Record<string, () => Promise<void>> = {
      'the close button': () => vendors.closeDetail(),
      Escape: () => page.keyboard.press('Escape'),
      'a tap outside': () => vendors.detailOverlay.tap({ position: { x: 10, y: 400 } }),
    };
    for (const [how, close] of Object.entries(closes)) {
      await page.goto('/dashboard');
      await vendors.goto(seed.marketId);
      await vendors.clickVendor(0);
      await vendors.openTab('history');
      await close();
      await expect(vendors.detailCloseButton, how).toBeHidden();
      await expect(page, how).toHaveURL((url) => url.pathname === vendorsPath && url.search === '');

      await page.goBack();
      await expect(page, how).toHaveURL(/\/dashboard$/);
      await expect(vendors.detailCloseButton, how).toBeHidden();
    }
  });

  test('a drawer reached by a link or a reload opens, and closing it stays on the page', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const vendorsPath = marketScreenPath(seed.marketId, 'vendors');

    // A link to the drawer, opened in a tab of its own.
    const linked = await page.context().newPage();
    await linked.goto(`${vendorsPath}?vendor=alice@example.com&vendorTab=assignments`);
    const fromTheLink = new VendorsPage(linked);
    await expect(linked.getByTestId('vendors-detail-email')).toHaveText('alice@example.com');
    await fromTheLink.closeDetail();
    await expect(fromTheLink.detailCloseButton).toBeHidden();
    await expect(linked).toHaveURL((url) => url.pathname === vendorsPath && url.search === '');
    await expect(fromTheLink.vendorListItems).toHaveCount(2);
    await linked.close();

    // A reload with the drawer open.
    const vendors = new VendorsPage(page);
    await page.goto('/dashboard');
    await vendors.goto(seed.marketId);
    await vendors.clickVendor(0);
    await expect(vendors.detailCloseButton).toBeVisible();
    await page.reload();
    await expect(vendors.detailCloseButton).toBeVisible();
    await vendors.closeDetail();
    await expect(vendors.detailCloseButton).toBeHidden();
    await expect(page).toHaveURL((url) => url.pathname === vendorsPath && url.search === '');
    await expect(vendors.vendorListItems).toHaveCount(2);
  });
});

test('on a desktop, Back closes a drawer opened from a seat and keeps the Assignments filter', async ({
  authenticatedPage: page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const tables = new TablesPage(page);
  await page.goto('/dashboard');
  await tables.goto(seed.marketId);
  await tables.setFilter('date', SEED_MARKET_DATE);
  await expect(page).toHaveURL(/date=/);
  const filtered = page.url();

  const seat = page.getByTestId('tables-seat-occupied').first();
  await tables.openVendor(seat);
  await expect(page.getByTestId('vendors-detail-close')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('vendors-detail-close')).toBeHidden();
  await expect(page).toHaveURL(filtered);
  await expect(seat).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
});
