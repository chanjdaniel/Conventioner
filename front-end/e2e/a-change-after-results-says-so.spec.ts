import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { publishResults } from './helpers/seeds';
import { TablesPage } from './pages/TablesPage';

/**
 * A change after results are published says so (T316).
 *
 * Once results are out, each vendor's page tells them where they sit, so the seat's dialog says
 * what freeing or moving them changes there, and that nothing is sent to them; and the history
 * entry of each says it came after results were published, naming the table their page had shown.
 */
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const DAY = 'Friday, May 1, 2099';
const NOTHING_SENT =
  'Freeing, moving or swapping them changes what it says, and nothing is sent to them.';

test('freeing and moving a vendor after results are published say so, in the dialog and the history', async ({
  authenticatedPage: page,
  request,
}) => {
  // Allocated by the solver, then published through the route an organizer's button calls.
  const { marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await publishResults(request, BACKEND_URL, TEST_USER.email, marketId);

  const tables = new TablesPage(page);
  await tables.goto(marketId);
  const note = tables.dialog.getByTestId('placement-dialog-results-out');

  // Alice's seat: the note names her table and her day before she is freed.
  const alice = tables.seatOf(ALICE);
  await expect(alice).toBeVisible({ timeout: 15000 });
  const alicesTable = await tables.tableCodeOf(alice);
  await tables.change(alice);
  await expect(tables.dialog).toBeVisible();
  await expect(note).toHaveText(
    `Results are published, so the vendor page of Alice Example (${ALICE}) tells them they have ${alicesTable}, a whole table on ${DAY}. ${NOTHING_SENT}`,
  );
  await tables.freeSeat();
  await expect(tables.dialog).toBeHidden();
  await expect(tables.seatOf(ALICE)).toHaveCount(0);

  // Bob's seat: the same note, then a move to the table Alice left.
  const bob = tables.seatOf(BOB);
  const bobsTable = await tables.tableCodeOf(bob);
  await tables.change(bob);
  await expect(note).toHaveText(
    `Results are published, so the vendor page of Bob Example (${BOB}) tells them they have ${bobsTable}, a whole table on ${DAY}. ${NOTHING_SENT}`,
  );
  await tables.moveTo(alicesTable);
  await expect(tables.dialog).toBeHidden();
  await expect(tables.seatIn(alicesTable, BOB)).toBeVisible();

  // The history says each came after results, and what their page had shown.
  await tables.openHistory();
  await expect(tables.historySentences.nth(0)).toContainText(
    `moved Bob Example ${BOB} from ${bobsTable} to ${alicesTable} (Full Table), after results were published: their vendor page had shown ${bobsTable}`,
  );
  await expect(tables.historySentences.nth(1)).toContainText(
    `freed ${alicesTable}, leaving Alice Example ${ALICE} with no table, after results were published: their vendor page had shown ${alicesTable}`,
  );
});
