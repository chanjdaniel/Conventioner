import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments, SEED_MARKET_DATE } from './helpers/seeds';
import { mongoEval } from './helpers/mongo';
import { TablesPage } from './pages/TablesPage';

/**
 * A search on the results (E35/F02/S01).
 *
 * The Result page filtered by date, section, tier and size, so finding one vendor's table meant
 * reading every card. The search keeps the tables seating someone whose name, business or address
 * matches, and the tables whose label does - in the address with the other filters.
 */
test('the search finds a vendor by name, business or address, and a table by its label', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  mongoEval(
    `db.applications.updateOne({ market_id: ${JSON.stringify(seed.marketId)}, ` +
      `applicant_email: 'alice@example.com' }, ` +
      `{ $set: { 'form_data.business_name': 'Kiln & Co Pottery' } })`,
  );
  const tables = new TablesPage(page);
  await tables.goto(seed.marketId);
  await expect(tables.tableRows).toHaveCount(3, { timeout: 10000 });
  const search = page.getByTestId('tables-filter-search');
  const shownCodes = async () => {
    const codes: string[] = [];
    for (const row of await tables.tableRows.all()) {
      codes.push((await row.getAttribute('data-table-code')) ?? '');
    }
    return codes;
  };

  // By part of the full name, the business name, and the address: only Alice's table.
  for (const words of ['alice exa', 'KILN & CO', 'alice@exam']) {
    await search.fill(words);
    await expect(tables.tableRows).toHaveCount(1);
    await expect(tables.tableRows.first().getByTestId('tables-seat-occupied')).toHaveAttribute(
      'data-vendor-email',
      'alice@example.com',
    );
  }

  // By a table's label: that table, empty or not.
  await search.fill('A 3');
  await expect(tables.tableRows).toHaveCount(1);
  expect(await shownCodes()).toEqual(['A 3']);

  // In the address, beside a date, and both survive a reload.
  await search.fill('bob');
  await tables.setFilter('date', SEED_MARKET_DATE);
  await expect(page).toHaveURL(/search=bob/);
  await page.reload();
  await expect(search).toHaveValue('bob');
  await expect(tables.tableRows).toHaveCount(1);
  await expect(page.getByTestId('tables-filter-chip-search')).toHaveText(/Search: bob/);

  // Clear all lets go of the search with the rest.
  await tables.clearAllFilters();
  await expect(search).toHaveValue('');
  await expect(tables.tableRows).toHaveCount(3);
});
