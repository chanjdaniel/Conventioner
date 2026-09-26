import { test, expect, TEST_USER, BACKEND_URL, TablesPage } from './fixtures';
import { ensureTestOrg, seedMarketWithVendors } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';

/**
 * The Result page is the assignment, read and changed (E22/F04/S04, from the-assignment-tab 01).
 *
 * Top to bottom: a summary strip (vendors placed, tables used, unassigned, satisfaction, Download
 * CSV), the tables grid with its seat editing - the Tables screen, moved in - and the placement
 * history. The old results page, its quick links and its Unassigned Tables list are gone: the
 * grid's "empty" filter shows those tables on the grid itself.
 */
const at = (marketId: string, page: string) => `/markets/${marketId}/${page}`;

test.describe('The Result page', () => {
  test.beforeEach(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('shows the strip, the grid and the history, and the strip follows a seat change', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.goto(at(marketId, 'result'));

    const placed = page.getByTestId('result-vendors-placed');
    await expect(placed).toHaveText(/^\d+ of \d+ vendors placed\s*$/, { timeout: 15000 });
    await expect(page.getByTestId('result-tables-used')).toHaveText(/^\d+ of \d+ tables used\s*$/);
    await expect(page.getByTestId('assignment-satisfaction-score')).toBeVisible();
    await expect(page.getByTestId('tables-count-assigned')).toBeVisible();
    await expect(page.getByTestId('placement-history')).toBeVisible();
    // Retired with the old results page.
    await expect(page.locator('.assignment-results')).toHaveCount(0);
    await expect(page.getByTestId('assignment-results-view-tables-button')).toHaveCount(0);

    const before = await placed.textContent();
    const tables = new TablesPage(page);
    const seat = page.getByTestId('tables-seat-occupied').first();
    await seat.click();
    await tables.freeSeat();
    await expect(placed).not.toHaveText(before ?? '', { timeout: 10000 });
  });

  test('Download CSV downloads the stored assignment', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.goto(at(marketId, 'result'));
    const download = page.waitForEvent('download');
    await page.getByTestId('result-download-csv-button').click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  });

  test('"unassigned" opens Vendors, filtered to the unassigned', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.goto(at(marketId, 'result'));
    await page.getByTestId('result-unassigned-link').click();

    await expect(page).toHaveURL(new RegExp(`/markets/${marketId}/vendors\\?show=unassigned$`));
    await expect(page.getByTestId('vendors-filter-unassigned')).toBeVisible();
    for (const status of await page.getByTestId('vendors-list-item').allTextContents()) {
      expect(status).not.toMatch(/\bAssigned\b/);
    }
  });

  test('before the first run it says so, and where to run it', async ({
    authenticatedPage: page,
    request,
  }) => {
    const unrun = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { run: false },
    );
    await page.goto(at(unrun.marketId, 'result'));
    const empty = page.getByTestId('result-empty');
    await expect(empty).toContainText('No assignment yet', { timeout: 15000 });
    await empty.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/markets/${unrun.marketId}/assignment$`));

    const draft = await seedMarketWithVendors(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.goto(at(draft.marketId, 'result'));
    await expect(page.getByTestId('result-empty')).toContainText('still a draft', {
      timeout: 15000,
    });
  });
});
