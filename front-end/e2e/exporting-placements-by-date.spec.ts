import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { VendorsPage } from './pages/VendorsPage';
import { VendorExportDialog } from './pages/VendorExportDialog';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { SEED_MARKET_DATE } from './helpers/seeds';

/**
 * The export's placement columns (E42/F01/S02).
 *
 * Each market date's seat is a group of columns, so one row carries a vendor's whole assignment.
 * Three dates, and a vendor the run placed on all three; the organizer frees their seat on the
 * second and moves them by hand on the third. The export then holds the seats the Assignments page
 * shows: two date groups filled, the moved one where it was moved to, and one empty.
 */
const DATES = [SEED_MARKET_DATE, '2099-05-02', '2099-05-03'];
const HEADINGS = ['Fri 1 May', 'Sat 2 May', 'Sun 3 May'];
const PARTS = ['table', 'section', 'tier', 'size'] as const;
const PART_WORDS = { table: 'table', section: 'section', tier: 'tier', size: 'half or full' };
const VENDOR = 'alice@example.com';

interface TableRow {
  date: string;
  assignment: string[];
  tableCode: string;
}

test('a vendor placed on two of three dates exports two seats and one empty date', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { dates: DATES },
  );
  const placements = `${BACKEND_URL}/markets/${encodeURIComponent(marketId)}/placements`;
  const tables = async (): Promise<TableRow[]> => {
    const res = await request.get(`${BACKEND_URL}/markets/${encodeURIComponent(marketId)}/tables`);
    expect(res.ok(), await res.text()).toBeTruthy();
    return ((await res.json()) as { rows: TableRow[] }).rows;
  };

  const freed = await request.delete(placements, { data: { email: VENDOR, date: DATES[1] } });
  expect(freed.ok(), await freed.text()).toBeTruthy();
  const empty = (await tables()).find((row) => row.date === DATES[2] && !row.assignment.length);
  const moved = await request.put(placements, {
    data: {
      email: VENDOR,
      date: DATES[2],
      table_code: empty!.tableCode,
      table_choice: 'Full Table',
    },
  });
  expect(moved.ok(), await moved.text()).toBeTruthy();

  // Where the Assignments page shows them, date by date.
  const shown = await tables();
  const seatOn = (date: string) =>
    shown.find((row) => row.date === date && row.assignment.includes(VENDOR))?.tableCode;
  expect(seatOn(DATES[1])).toBeUndefined();
  expect(seatOn(DATES[2])).toBe(empty!.tableCode);

  const vendors = new VendorsPage(page);
  await vendors.goto(marketId);
  await vendors.search(VENDOR);
  await expect(vendors.vendorListItems).toHaveCount(1);
  await vendors.exportButton.click();
  const dialog = new VendorExportDialog(page);
  await expect(dialog.window).toBeVisible();
  await expect(dialog.summary).toHaveText('1 vendor, 3 columns');

  await expect(dialog.group('assignment').locator('legend')).toHaveText('Assignment');
  await dialog.column('name').uncheck();
  await dialog.column('status').uncheck();
  for (const date of DATES) {
    for (const part of PARTS) await dialog.column(`date:${date}:${part}`).check();
  }
  await dialog.column('datesPlaced').check();
  await expect(dialog.summary).toHaveText('1 vendor, 14 columns');

  const header = [
    'Email',
    ...HEADINGS.flatMap((day) => PARTS.map((part) => `${day} - ${PART_WORDS[part]}`)),
    'Dates placed',
  ];
  const seat = (date: string) => [seatOn(date)!, 'Hall A', 'Gold', 'Full table'];
  const row = [VENDOR, ...seat(DATES[0]), '', '', '', '', ...seat(DATES[2]), '2'];
  await expect(dialog.previewRows.first().locator('td')).toHaveText(row);

  const { text } = await dialog.download();
  const lines = text.slice(1).trim().split(/\r?\n/);
  expect(lines).toEqual([header.join(','), row.join(',')]);
});
