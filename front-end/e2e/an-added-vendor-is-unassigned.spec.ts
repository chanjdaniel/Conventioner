import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { TablesPage } from './pages/TablesPage';

/**
 * A vendor added by hand without a table is unassigned like anyone (E38/F08/S02).
 *
 * Adding approves them and keeps them out of the run, but they still need a table on every market
 * day: "Unassigned only" lists them, their row says "Unassigned" beside "Added", and the Assignments
 * page's "N unassigned" counts them, so the link and the list it opens agree (bug 10). Seating them
 * takes them off both, and with a date chosen they are listed on each day they have no table.
 */
const FIRST = '2099-05-01';
const SECOND = '2099-05-02';

test.beforeEach(async ({ request }) => {
  await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
});

test('a vendor added without a table is unassigned until seated', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { dates: [FIRST, SECOND] },
  );
  const vendors = marketScreenPath(marketId, 'vendors');
  const unassignedLink = page.getByTestId('result-unassigned-link');

  // Everyone the run reads has a table, so nobody is unassigned yet.
  await page.goto(marketScreenPath(marketId, 'assignments'));
  await expect(unassignedLink).toHaveText(/^0\s+unassigned\s*$/, { timeout: 15000 });

  await page.goto(vendors);
  await page.getByTestId('vendors-add-button').click();
  const dialog = page.getByTestId('add-vendor-window');
  await dialog.getByTestId('add-vendor-name-input').fill('Walk-in Wares');
  await dialog.getByTestId('add-vendor-email-input').fill('walk.in@example.com');
  await dialog.getByTestId('add-vendor-submit-button').click();
  await expect(dialog).toBeHidden();
  await page.getByTestId('vendors-detail-close').click();

  // Unassigned only: the new vendor, said as both.
  await page.getByTestId('vendors-filter-unassigned').click();
  const rows = page.getByTestId('vendors-list-item');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Walk-in Wares');
  await expect(rows.getByTestId('vendors-list-status')).toHaveText('Added');
  await expect(rows.getByTestId('vendors-list-badge')).toHaveText('Unassigned');
  // Needed on every market day: none of two had.
  await expect(rows.getByTestId('vendor-date-count')).toHaveText(/0 of 2 dates/);

  // The count that leads here says the same.
  await page.goto(marketScreenPath(marketId, 'assignments'));
  await expect(unassignedLink).toHaveText(/^1\s+unassigned\s*$/, { timeout: 15000 });
  await expect(page.getByTestId('result-approved-assigned')).toHaveText(
    /of\s+\d+\s+approved applicants assigned/,
  );
  await unassignedLink.click();
  await expect(page).toHaveURL(/\/vendors\?show=unassigned$/);
  await expect(rows).toHaveCount(1);

  // Seated on the first day: off both lists, and still without a table on the second.
  const tables = new TablesPage(page);
  await tables.gotoWithFilters(marketId, { date: FIRST });
  await tables.vacantSeat('Hall A 5').click();
  await tables.dialog.getByTestId('placement-dialog-vendor').selectOption('walk.in@example.com');
  await tables.dialog.getByTestId('placement-dialog-confirm').click();
  await expect(tables.dialog).toBeHidden();
  await expect(unassignedLink).toHaveText(/^0\s+unassigned\s*$/);

  await page.goto(`${vendors}?show=unassigned`);
  await expect(page.getByTestId('vendors-summary')).toBeVisible({ timeout: 15000 });
  await expect(rows).toHaveCount(0);
  await expect(page.getByText('Every vendor has a table.')).toBeVisible();

  await page.goto(`${vendors}?show=unassigned&date=${SECOND}`);
  await expect(rows).toHaveCount(1, { timeout: 15000 });
  await expect(rows).toContainText('Walk-in Wares');
  await page.goto(`${vendors}?show=unassigned&date=${FIRST}`);
  await expect(page.getByTestId('vendors-summary')).toHaveText(/0\s+of\s+3\s+vendors shown/, {
    timeout: 15000,
  });
  await expect(rows).toHaveCount(0);

  // Listed with everyone, the row says they have a table, on one of the two days.
  await page.goto(vendors);
  const walkIn = rows.filter({ hasText: 'Walk-in Wares' });
  await expect(walkIn.getByTestId('vendors-list-badge')).toHaveText('Assigned', {
    timeout: 15000,
  });
  await expect(walkIn.getByTestId('vendor-date-count')).toHaveText(/1 of 2 dates/);
});
