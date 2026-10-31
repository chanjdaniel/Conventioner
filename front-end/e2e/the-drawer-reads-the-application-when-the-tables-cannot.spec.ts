import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath } from './helpers/marketScreens';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';

/**
 * The vendor drawer keeps a vendor's application when the market's placements cannot be read
 * (T123, from T119's review).
 *
 * The drawer reads the applications, the assignment's statistics and the tables together, and one
 * failure emptied all three: the drawer then said "This market asks no questions of its own." of a
 * market that asks one, with the failure shown nowhere, and the Vendors list said where vendors sit
 * from a read it never had. An approved application with incomplete answers no longer makes the
 * server refuse those reads (T139), so a route stands in for a read that fails.
 */
const FAILED = 'Where the vendors sit could not be read just now.';

/** The two reads of where vendors sit answer 500, with the server's reason. */
async function failThePlacementReads(page: Page): Promise<void> {
  await page.route(/\/markets\/[^/]+\/(assignment-statistics|tables)$/, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: FAILED }),
    }),
  );
}

test('a vendor drawer shows their answers and why the placements are missing', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  await failThePlacementReads(page);

  await page.goto(`${marketScreenPath(seed.marketId, 'vendors')}?vendor=bob%40example.com`);
  const panel = page.getByTestId('vendor-drawer-panel-application');
  await expect(panel).toBeVisible({ timeout: 15000 });

  // Named from the application, which the drawer did read.
  await expect(page.getByRole('heading', { name: 'Bob Example' })).toBeVisible();
  await expect(page.getByTestId('vendors-detail-answer-business_name')).toBeVisible();
  await expect(panel).not.toContainText('asks no questions');
  await expect(page.getByTestId('vendors-detail-load-error')).toContainText(FAILED);

  // Behind it the page lists both by name, and says nothing of who is placed: no count of the
  // assigned, no date count on a row, no "Unassigned only".
  await page.keyboard.press('Escape');
  const rows = page.getByTestId('vendors-list-item');
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId('vendors-summary')).toHaveText('2 vendors');
  await expect(page.getByTestId('vendor-date-count')).toHaveCount(0);
  await expect(page.getByTestId('vendors-filter-unassigned')).toHaveCount(0);
  await page.getByTestId('vendors-search-input').fill('Bob');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Bob Example');

  // An address asking for the unassigned, or for a section, asks where vendors sit: both are
  // ignored, by the list and by Export, which opens on the page's filters.
  await page.goto(`${marketScreenPath(seed.marketId, 'vendors')}?show=unassigned&section=Hall%20A`);
  await expect(rows).toHaveCount(2, { timeout: 15000 });
  await expect(page.getByTestId('vendors-summary')).toHaveText('2 vendors');
  await page.getByTestId('vendors-export-button').click();
  await expect(page.getByTestId('vendor-export-placed')).toHaveValue('');
  await expect(page.getByTestId('vendor-export-summary')).toContainText('2 vendors');
});

test('a market before any assignment, its placements unread, still says "N vendors"', async ({
  authenticatedPage: page,
  request,
}) => {
  // Stops in the assignment phase with nothing run, so nothing has been assigned yet.
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    run: false,
  });
  await failThePlacementReads(page);

  await page.goto(marketScreenPath(seed.marketId, 'vendors'));
  const rows = page.getByTestId('vendors-list-item');
  await expect(rows).toHaveCount(2, { timeout: 15000 });
  await expect(page.getByTestId('vendors-summary')).toHaveText('2 vendors');
});
