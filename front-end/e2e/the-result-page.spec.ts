import { readFileSync } from 'node:fs';
import { test, expect, TEST_USER, BACKEND_URL, TablesPage } from './fixtures';
import { ensureTestOrg, seedMarketWithVendors } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';

/**
 * The Result page is the assignment, read and changed (E22/F04/S04, from the-assignment-tab 01).
 *
 * Top to bottom: a summary strip (approved applicants assigned, tables used, unassigned, satisfaction, Download
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

    const assigned = page.getByTestId('result-approved-assigned');
    await expect(assigned).toHaveText(/^\d+ of \d+ approved applicants assigned\s*$/, {
      timeout: 15000,
    });
    // A table counted once per date is a table-day; "tables" read as 177 tables in a room of 59
    // (known gap 7, 2026-10-18 dry run).
    await expect(page.getByTestId('result-tables-used')).toHaveText(
      /^\d+ of \d+ table-days used\s*$/,
    );
    await expect(page.getByTestId('result-definition')).toContainText(
      'A table-day is one table on one market date.',
    );
    await expect(page.getByTestId('assignment-satisfaction-score')).toBeVisible();
    await expect(page.getByTestId('tables-count-assigned')).toBeVisible();
    // The trail is behind its own button now, not under every table (E35/F03/S03).
    await expect(page.getByTestId('placement-history')).toHaveCount(0);
    await expect(page.getByTestId('result-history-button')).toBeVisible();
    // Retired with the old results page.
    await expect(page.locator('.assignment-results')).toHaveCount(0);
    await expect(page.getByTestId('assignment-results-view-tables-button')).toHaveCount(0);

    const before = await assigned.textContent();
    const tables = new TablesPage(page);
    const seat = page.getByTestId('tables-seat-occupied').first();
    await tables.change(seat);
    await tables.freeSeat();
    await expect(assigned).not.toHaveText(before ?? '', { timeout: 10000 });
  });

  /**
   * The statistics open under the strip (E22/F04/S05): an inline panel, closed by default, holding
   * the per date, section, tier and table choice counts. Not a dialog, because this is reading.
   */
  test('the statistics open under the strip, survive a refresh, and filter the grid', async ({
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
    const panel = page.getByTestId('result-statistics');
    await expect(page.getByTestId('result-strip')).toBeVisible({ timeout: 15000 });
    await expect(panel).toHaveCount(0);

    await page.getByTestId('result-statistics-button').click();
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/stats=open/);
    for (const heading of ['Per date', 'Per section', 'Per tier', 'Per table size']) {
      await expect(panel.getByRole('heading', { name: heading })).toBeVisible();
    }

    await page.reload();
    await expect(panel).toBeVisible({ timeout: 15000 });

    const firstDate = panel.getByTestId('result-statistics-date').first();
    const date = await firstDate.getAttribute('data-value');
    await firstDate.click();
    await expect(page).toHaveURL(new RegExp(`date=${date}`));
    await expect(page.getByTestId('tables-filter-date')).toHaveValue(date ?? '');
    await expect(panel).toBeVisible();

    await page.getByTestId('result-statistics-button').click();
    await expect(panel).toHaveCount(0);
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
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
    // The name each vendor chose, then their full name, then the address (E35/F03/S02), then
    // whether the review approved them (E36/F02/S03).
    const text = readFileSync((await file.path()) as string, 'utf8');
    expect(text.split('\n')[0].startsWith('Name,Full name,Email,Approval,')).toBe(true);
    expect(text).toContain('Alice Example,Alice Example,alice@example.com,Approved');
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

  test('before the first run it says so, and where to allocate tables', async ({
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
    await expect(empty).toContainText('Nothing assigned yet', { timeout: 15000 });
    await expect(
      empty.getByRole('link', { name: 'Set the rules and allocate tables' }),
    ).toBeVisible();
    // Where a run can happen, the tables stay: a vendor pinned before the first run is placed
    // around by it (E11/F02/S01), so they are offered for that and not as a result.
    await expect(page.getByTestId('result-pin-before-run')).toContainText(
      'allocating tables assigns',
    );
    await expect(page.getByTestId('tables-count-empty')).toBeVisible();
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
    // Nowhere a run can happen, no grid of empty tables stands in for a result (E31/F03/S05).
    await expect(page.getByTestId('result-pin-before-run')).toHaveCount(0);
    await expect(page.getByTestId('tables-count-empty')).toHaveCount(0);
  });
});
