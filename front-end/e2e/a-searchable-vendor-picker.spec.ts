import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { TablesPage } from './pages/TablesPage';
import { SEED_MARKET_DATE, ensureTestOrg } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { namelessControls } from './helpers/accessibleNames';

/**
 * The placement dialog's vendor pickers are searched by typing (E38/F08/S03).
 *
 * "Swap them with" was a select of everyone seated that day, scrolled through for the one wanted.
 * It narrows as it is typed in, by a vendor's name, business or address and by the table they sit
 * at, with the same terms as the pages' search, and is worked from the keyboard: the arrow keys,
 * Enter to choose, Escape to close the list without closing the dialog.
 */
test.beforeEach(async ({ request }) => {
  await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
});

test('a swap partner is found by typing, and the swap is made as before', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { run: false },
  );
  for (const [email, fullName] of [
    ['cora@example.com', 'Cora Pottery'],
    ['dev@example.com', 'Dev Prints'],
  ]) {
    seedApprovedVendor(marketId, email!, { dates: [SEED_MARKET_DATE], tiers: ['Gold'], fullName });
  }
  const run = await request.post(`${BACKEND_URL}/markets/${marketId}/assignment`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
  });
  expect(run.ok()).toBe(true);

  const tables = new TablesPage(page);
  await tables.goto(marketId);
  await expect(tables.seatOf('alice@example.com')).toBeVisible({ timeout: 15000 });
  const aliceTable = await tables.tableCodeOf(tables.seatOf('alice@example.com'));
  const coraTable = await tables.tableCodeOf(tables.seatOf('cora@example.com'));
  const devTable = await tables.tableCodeOf(tables.seatOf('dev@example.com'));

  await tables.change(tables.seatOf('alice@example.com'));
  const field = tables.pickerField('swap-target');
  const options = tables.pickerOptions('swap-target');
  expect(await namelessControls(page), 'the placement dialog').toEqual([]);

  // Everyone else seated that day, until a word narrows them.
  await tables.openPicker('swap-target');
  await expect(options).toHaveCount(3);
  await field.fill('pott');
  await expect(options).toHaveText([new RegExp(`Cora Pottery.*${coraTable}`)]);
  // By the table they sit at, too.
  await field.fill(devTable);
  await expect(options).toHaveText([/Dev Prints/]);

  // Escape closes the list and leaves the dialog open; the next one is the dialog's.
  await field.press('Escape');
  await expect(tables.pickerList('swap-target')).toHaveCount(0);
  await expect(tables.dialog).toBeVisible();

  // Chosen from the keyboard: the first match is active as it is typed, and Enter takes it.
  await field.fill('cora');
  await field.press('ArrowDown');
  await field.press('Enter');
  await expect(field).toHaveValue('Cora Pottery (cora@example.com)');
  await expect(tables.dialog).toBeVisible();

  // Reopened on that choice, typing searches afresh rather than running on from the label.
  await field.click();
  await field.pressSequentially('dev');
  await expect(options).toHaveText([/Dev Prints/]);
  await field.press('Escape');
  await field.fill('cora');
  await field.press('Enter');
  await expect(field).toHaveValue('Cora Pottery (cora@example.com)');

  await tables.dialog.getByTestId('placement-dialog-swap').click();
  await expect(tables.dialog).toBeHidden();
  await expect(tables.seatOf('cora@example.com')).toBeVisible();
  expect(await tables.tableCodeOf(tables.seatOf('cora@example.com'))).toBe(aliceTable);
  expect(await tables.tableCodeOf(tables.seatOf('alice@example.com'))).toBe(coraTable);
});
