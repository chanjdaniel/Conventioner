import { test, expect, TEST_USER, BACKEND_URL, APP_API } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';
import { mongoEval } from './helpers/mongo';
import { TablesPage } from './pages/TablesPage';

/**
 * Moving a seated vendor to an empty table on the same day, in one step (T208).
 *
 * A taken seat's dialog asks what to do with its vendor, and starts at "Move to an empty seat":
 * the day's empty seats, by section in the plan's order. "Move them" is the one placement write,
 * which replaces the seat they held that date, so they never stand at no table; the history holds
 * one "Moved" entry, and what they owe for the day follows the new table's price.
 */
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const GOLD = { id: 1, name: 'Gold' };
const SILVER = { id: 2, name: 'Silver' };

/** One date, a Gold and a Silver section at different prices, more tables than vendors. */
const PLAN = {
  priority: [],
  marketDates: [{ date: SEED_MARKET_DATE }],
  tiers: [GOLD, SILVER],
  locations: [{ name: 'Main Hall' }],
  sections: [
    { name: 'North Wing', location: { name: 'Main Hall' }, tier: GOLD, count: 2 },
    { name: 'Landing', location: { name: 'Main Hall' }, tier: SILVER, count: 2 },
  ],
  assignmentOptions: { maxAssignmentsPerVendor: 1, maxHalfTableProportionPerSection: 50 },
  pricing: {
    currency: 'CAD',
    halfTablePercent: 50,
    everyoneElse: [
      { tier: 'Gold', cents: 3500 },
      { tier: 'Silver', cents: 3000 },
    ],
  },
};

async function put(request: APIRequestContext, path: string, data: Record<string, unknown>) {
  const res = await request.put(`${BACKEND_URL}${path}`, { data });
  expect(res.ok(), `put ${path}: ${await res.text()}`).toBeTruthy();
}

/** A priced market in assignment: Alice at a Gold whole table, North Wing 1, and nobody else. */
async function aliceAtNorthWing1(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  mongoEval(
    `db.applications.updateMany({ market_id: ${JSON.stringify(marketId)} },
      { $set: { 'form_data.essential_section_ranking': ['North Wing', 'Landing'] } })`,
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, PLAN);
  for (const toPhase of ['applications', 'assignment']) {
    const res = await request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
      data: { toPhase },
    });
    expect(res.ok(), `transition to ${toPhase}: ${await res.text()}`).toBeTruthy();
  }
  await put(request, `/markets/${marketId}/placements`, {
    email: ALICE,
    date: SEED_MARKET_DATE,
    tableCode: 'North Wing 1',
    tableChoice: 'Full Table',
  });
  return marketId;
}

interface HistoryEntry {
  id: string;
  action: string;
  kind: string;
  vendors: string[];
  detail: { table_code?: string; before?: { table_code: string } | null } | null;
}

/** The market's history, newest first, read with the page's own session. */
async function history(page: Page, marketId: string): Promise<HistoryEntry[]> {
  const res = await page.request.get(`${APP_API}/markets/${marketId}/history`);
  expect(res.ok(), `history: ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { entries: HistoryEntry[] }).entries;
}

/** Alice's line of what she owes on the market's one date. */
async function aliceOwes(page: Page, marketId: string) {
  const res = await page.request.get(`${APP_API}/markets/${marketId}/payments/${ALICE}`);
  expect(res.ok(), `account: ${await res.text()}`).toBeTruthy();
  const account = (await res.json()) as {
    lines: { date: string; tableCode: string; owedCents: number | null }[];
  };
  return account.lines.find((line) => line.date === SEED_MARKET_DATE);
}

/** Open Alice's seat's dialog on the Assignments page. */
async function openAlicesSeat(page: Page, marketId: string): Promise<TablesPage> {
  const tables = new TablesPage(page);
  await tables.goto(marketId);
  const seat = tables.seatIn('North Wing 1', ALICE);
  await expect(seat).toBeVisible({ timeout: 15000 });
  await tables.change(seat);
  await expect(tables.dialog).toBeVisible();
  return tables;
}

test('a vendor moves from their seat to an empty Silver table in one change', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await aliceAtNorthWing1(request);
  expect(await aliceOwes(page, marketId)).toMatchObject({
    tableCode: 'North Wing 1',
    owedCents: 3500,
  });
  const before = new Set((await history(page, marketId)).map((entry) => entry.id));

  const tables = await openAlicesSeat(page, marketId);
  // The move that disturbs nobody is the one offered first, its seats in the plan's order and
  // her own table left out.
  await expect(tables.action('move')).toBeChecked();
  await tables.openPicker('move-target');
  await expect(tables.pickerOptions('move-target')).toHaveCount(3);
  expect(await tables.moveOptionCodes()).toEqual(['North Wing 2', 'Landing 1', 'Landing 2']);

  await tables.moveTo('Landing 2');
  await expect(tables.dialog).toBeHidden();

  // She sits at the new table, and her old seat is free.
  await expect(tables.seatIn('Landing 2', ALICE)).toBeVisible();
  await expect(tables.vacantSeat('North Wing 1')).toBeVisible();
  await expect(tables.seatOf(ALICE)).toHaveCount(1);

  // One entry, which names the table she left.
  const added = (await history(page, marketId)).filter((entry) => !before.has(entry.id));
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ action: 'assign', kind: 'placed', vendors: [ALICE] });
  expect(added[0]!.detail).toMatchObject({
    table_code: 'Landing 2',
    before: { table_code: 'North Wing 1' },
  });

  // And what she owes for the day follows the Silver table's price.
  expect(await aliceOwes(page, marketId)).toMatchObject({
    tableCode: 'Landing 2',
    owedCents: 3000,
  });
});

test('a move to a seat taken meanwhile is refused in the dialog, which stays open', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await aliceAtNorthWing1(request);
  const tables = await openAlicesSeat(page, marketId);
  await tables.pickerField('move-target').fill('Landing 1');
  await tables.moveOption('Landing 1').click();

  // Somebody else takes it while the dialog is open.
  await put(request, `/markets/${marketId}/placements`, {
    email: BOB,
    date: SEED_MARKET_DATE,
    tableCode: 'Landing 1',
    tableChoice: 'Full Table',
  });

  await tables.moveButton.click();
  await expect(tables.dialogError).toBeVisible();
  await expect(tables.dialog).toBeVisible();
  await tables.cancel();
  await expect(tables.seatIn('North Wing 1', ALICE)).toBeVisible();
});
