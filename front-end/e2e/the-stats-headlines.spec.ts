import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { SEED_MARKET_DATE, recordCheckIns, seedMarketWithVendors } from './helpers/seeds';
import { seedApplication, seedApprovedVendor } from './helpers/seedApplication';
import { savePlan } from './helpers/savePlan';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { allocateThenFreeEverySeat, publishResults } from './helpers/seeds';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';
import { StatsPage } from './pages/StatsPage';
import { VendorsPage } from './pages/VendorsPage';

/**
 * The Stats tab's strip (T201): three or four tiles chosen by the market's phase, each the figure
 * the page it links to shows, and the link opens that page with its filter - none in draft; who
 * applied, who is open to review and the table-days asked in applications; the table-days used, who
 * is unassigned and what is still owed in assignment; who is in and who is not yet on the day
 * counted, and what is still owed, in Market Days; who came, the table-days used and what was paid in
 * the archive.
 * Below them the Money section tells the market's money with a bar of paid against owed, and from
 * Market Days on the Check-in section tells each day's vendors in of those expected (T201).
 */
const SECOND_DATE = '2099-05-08';
const GOLD = { id: 1, name: 'Gold' };
const SILVER = { id: 2, name: 'Silver' };
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const CAROL = 'carol@example.com';
const DAN = 'dan@example.com';
const ERIN = 'erin@example.com';

const PRICING = {
  currency: 'CAD',
  halfTablePercent: 50,
  everyoneElse: [
    { tier: 'Gold', cents: 3500 },
    { tier: 'Silver', cents: 3000 },
  ],
};

/** Two dates of four tables: eight table-days. */
function plan(pricing: typeof PRICING | null) {
  return {
    priority: [],
    marketDates: [{ date: SEED_MARKET_DATE }, { date: SECOND_DATE }],
    tiers: [GOLD, SILVER],
    locations: [{ name: 'Main Hall' }],
    sections: [
      { name: 'North Wing', location: { name: 'Main Hall' }, tier: GOLD, count: 2 },
      { name: 'Landing', location: { name: 'Main Hall' }, tier: SILVER, count: 2 },
    ],
    assignmentOptions: { maxAssignmentsPerVendor: 2, maxHalfTableProportionPerSection: 50 },
    pricing,
  };
}

async function call(
  request: APIRequestContext,
  method: 'put' | 'post',
  path: string,
  data: Record<string, unknown>,
) {
  const res = await request[method](`${BACKEND_URL}${path}`, { data });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
}

/** Four approved vendors on a market moved through `phases`, to assignment unless named, nobody placed yet. */
async function fourVendors(
  request: APIRequestContext,
  pricing: typeof PRICING | null,
  phases: string[] = ['applications', 'assignment'],
): Promise<string> {
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { dates: [SEED_MARKET_DATE, SECOND_DATE] },
  );
  for (const [email, fullName] of [
    [CAROL, 'Carol Example'],
    [DAN, 'Dan Example'],
  ]) {
    seedApprovedVendor(marketId, email, {
      dates: [SEED_MARKET_DATE, SECOND_DATE],
      tiers: ['Gold'],
      fullName,
    });
  }
  mongoEval(
    `db.applications.updateMany({ market_id: ${JSON.stringify(marketId)} },
      { $set: { 'form_data.essential_section_ranking': ['North Wing', 'Landing'] } })`,
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, plan(pricing));
  for (const toPhase of phases) {
    await call(request, 'post', `/markets/${marketId}/transition`, { toPhase });
  }
  return marketId;
}

/**
 * Alice on Gold both days ($70) has paid $35, Bob on Silver one day ($30) has paid $30, Carol on
 * half a Gold table one day ($17.50) has paid $25, and Dan holds nothing.
 */
async function seatAndPay(request: APIRequestContext, marketId: string) {
  for (const [email, date, table, choice] of [
    [ALICE, SEED_MARKET_DATE, 'North Wing 1', 'Full Table'],
    [ALICE, SECOND_DATE, 'North Wing 1', 'Full Table'],
    [BOB, SEED_MARKET_DATE, 'Landing 1', 'Full Table'],
    [CAROL, SECOND_DATE, 'North Wing 2', 'Half Table (Left)'],
  ]) {
    await call(request, 'put', `/markets/${marketId}/placements`, {
      email,
      date,
      table_code: table,
      table_choice: choice,
    });
  }
  for (const [email, cents] of [
    [ALICE, 3500],
    [BOB, 3000],
    [CAROL, 2500],
  ] as const) {
    await call(request, 'post', `/markets/${marketId}/payments/${email}`, {
      cents,
      method: 'e-transfer',
      paidOn: '2099-04-01',
      note: '',
    });
  }
}

async function openStats(page: Page, marketId: string): Promise<StatsPage> {
  const stats = new StatsPage(page);
  await stats.goto(marketId);
  await expect(stats.total).toBeVisible({ timeout: 15000 });
  return stats;
}

/** Follow a tile's link, and come back to Stats for the next. */
async function follow(stats: StatsPage, marketId: string, id: string, then: () => Promise<void>) {
  await stats.headline(id).getByRole('link').click();
  await then();
  await openStats(stats.page, marketId);
}

async function figureOf(locator: Locator): Promise<string> {
  return ((await locator.textContent()) ?? '').trim();
}

/** The strip's tiles, in order, each read as one line: "4 of 8 table-days used". */
async function tiles(stats: StatsPage): Promise<string[]> {
  return stats.strip
    .getByRole('listitem')
    .allInnerTexts()
    .then((all) => all.map((text) => text.replace(/\s+/g, ' ').trim()));
}

/** At a desk the strip is one row: every tile starts at one height, each to the right of the last. */
async function expectOneRow(stats: StatsPage): Promise<void> {
  const boxes = await stats.strip
    .getByRole('listitem')
    .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().toJSON()));
  expect(boxes.length).toBeGreaterThanOrEqual(3);
  for (const [i, box] of boxes.entries()) {
    expect(box.top, `tile ${i + 1} stands in the first tile's row`).toBe(boxes[0].top);
    if (i) expect(box.left, `tile ${i + 1} follows the last`).toBeGreaterThan(boxes[i - 1].right);
  }
}

test('the strip has no tile in draft, and in applications tells who applied, who is open and the table-days asked', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await fourVendors(request, null, []);
  seedApplication(marketId, ERIN, { business_name: 'Erin Example' }, { status: 'open' });
  let stats = await openStats(page, marketId);
  await expect(stats.strip).toHaveCount(0);

  await call(request, 'post', `/markets/${marketId}/transition`, { toPhase: 'applications' });
  stats = await openStats(page, marketId);
  expect(await tiles(stats)).toEqual(['5 applied', '1 open to review', '8 of 8 table-days asked']);
  await expectOneRow(stats);
  // The tile is the link, named by its figure and its words.
  await expect(stats.headline('applied').getByRole('link', { name: '5 applied' })).toBeVisible();

  // Who applied: the All view, every application.
  const all = new ApplicationsAllPage(page);
  await follow(stats, marketId, 'applied', async () => {
    await expect(page).toHaveURL(/\/applications\?view=all$/);
    await expect(all.count).toHaveText('5 applications', { timeout: 15000 });
    await expect(all.rows).toHaveCount(5);
  });

  // Who is open to review: its filter, on every reviewer's share.
  await follow(stats, marketId, 'open', async () => {
    await expect(page).toHaveURL(/\/applications\?view=all&status=undecided&reviewer=anyone$/);
    await expect(all.count).toHaveText('1 of 5 applications', { timeout: 15000 });
    await expect(all.rows).toHaveCount(1);
  });

  // The table-days asked: the Room section below, brought in under the bar and read from.
  await page.setViewportSize({ width: 1280, height: 400 });
  await expect(stats.room.getByRole('heading', { level: 2 })).not.toBeInViewport();
  await stats.headline('asked').getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`${marketScreenPath(marketId, 'stats')}$`));
  await expect(stats.room.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(stats.room.getByRole('heading', { level: 2 })).toBeInViewport();
});

test('from assignment to the archive, each tile is the figure of the page it links to, opened on its filter', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await fourVendors(request, PRICING);
  // Results are published below, which waits for tables to be allocated (T316): the seats are
  // hand edits of a run.
  await allocateThenFreeEverySeat(request, BACKEND_URL, marketId);
  await seatAndPay(request, marketId);
  let stats = await openStats(page, marketId);

  // Assignment: the table-days used, who is unassigned and what is still owed.
  expect(await tiles(stats)).toEqual([
    '4 of 8 table-days used',
    '1 unassigned',
    '$35.00 still owed',
  ]);
  await expectOneRow(stats);

  await follow(stats, marketId, 'used', async () => {
    await expect(page).toHaveURL(new RegExp(`${marketScreenPath(marketId, 'assignments')}$`));
    await expect(page.getByTestId('result-tables-used')).toHaveText(/4\s+of\s+8 table-days used/, {
      timeout: 15000,
    });
  });

  await follow(stats, marketId, 'unassigned', async () => {
    await expect(page).toHaveURL(/\/vendors\?show=unassigned$/);
    const vendors = new VendorsPage(page);
    await expect(vendors.unassignedOnly).toHaveAttribute('aria-pressed', 'true', {
      timeout: 15000,
    });
    await expect(vendors.summary).toHaveText(/^1\s+of\s+4\s+vendors shown/);
    await expect(vendors.vendorListItems).toHaveCount(1);
  });

  await follow(stats, marketId, 'stillOwed', async () => {
    await expect(page).toHaveURL(/\/payments\?show=owes$/);
    await expect(page.getByTestId('payments-show-owes')).toHaveAttribute('aria-pressed', 'true', {
      timeout: 15000,
    });
    await expect(page.getByTestId('payments-total-stillOwedCents').locator('dd')).toHaveText(
      '$35.00',
    );
    await expect(page.getByTestId('payments-row')).toHaveCount(1);
  });

  // Market Days: the next market date ahead is counted, and named. Alice is in on it; Carol is in
  // on the second.
  await publishResults(request, BACKEND_URL, TEST_USER.email, marketId);
  await call(request, 'post', `/markets/${marketId}/transition`, { toPhase: 'market_days' });
  recordCheckIns(
    marketId,
    [
      { vendorEmail: ALICE, date: SEED_MARKET_DATE },
      { vendorEmail: CAROL, date: SECOND_DATE },
    ],
    TEST_USER.email,
  );
  stats = await openStats(page, marketId);
  expect(await tiles(stats)).toEqual([
    '1 of 2 checked in, May 1, 2099',
    '1 not yet in',
    '$35.00 still owed',
  ]);
  await expectOneRow(stats);

  const door = new AttendanceStatusPage(page);
  for (const id of ['checkedIn', 'notYet']) {
    await follow(stats, marketId, id, async () => {
      await expect(page).toHaveURL(new RegExp(`/attendance\\?date=${SEED_MARKET_DATE}$`));
      await expect(door.date(SEED_MARKET_DATE)).toHaveAttribute('aria-pressed', 'true', {
        timeout: 15000,
      });
      await expect(door.date(SEED_MARKET_DATE)).toContainText('1/2');
    });
  }

  // Archived: the vendors who came on any day, the table-days used and what was paid.
  await call(request, 'post', `/markets/${marketId}/transition`, { toPhase: 'archived' });
  stats = await openStats(page, marketId);
  expect(await tiles(stats)).toEqual(['2 vendors came', '4 of 8 table-days used', '$90.00 paid']);

  await follow(stats, marketId, 'came', async () => {
    await expect(page).toHaveURL(new RegExp(`${marketScreenPath(marketId, 'attendance')}(\\?|$)`));
    await expect(door.date(SEED_MARKET_DATE)).toBeVisible({ timeout: 15000 });
  });
  await follow(stats, marketId, 'paid', async () => {
    await expect(page).toHaveURL(new RegExp(`${marketScreenPath(marketId, 'payments')}$`));
    await expect(page.getByTestId('payments-total-paidCents').locator('dd')).toHaveText('$90.00', {
      timeout: 15000,
    });
  });
});

test('a zero whose link would list nothing is told, not linked, and an archive that never ran tells no one came', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await fourVendors(request, PRICING);
  await seatAndPay(request, marketId);
  // Dan takes a Gold table on the first day ($35), and he and Alice pay what they owe.
  await call(request, 'put', `/markets/${marketId}/placements`, {
    email: DAN,
    date: SEED_MARKET_DATE,
    table_code: 'North Wing 2',
    table_choice: 'Full Table',
  });
  for (const [email, cents] of [
    [ALICE, 3500],
    [DAN, 3500],
  ] as const) {
    await call(request, 'post', `/markets/${marketId}/payments/${email}`, {
      cents,
      method: 'e-transfer',
      paidOn: '2099-04-01',
      note: '',
    });
  }
  let stats = await openStats(page, marketId);
  expect(await tiles(stats)).toEqual([
    '5 of 8 table-days used',
    '0 unassigned',
    '$0.00 still owed',
  ]);
  await expect(stats.headline('used').getByRole('link')).toHaveCount(1);
  await expect(stats.headline('unassigned').getByRole('link')).toHaveCount(0);
  await expect(stats.headline('stillOwed').getByRole('link')).toHaveCount(0);

  await call(request, 'post', `/markets/${marketId}/transition`, { toPhase: 'archived' });
  stats = await openStats(page, marketId);
  expect(await tiles(stats)).toEqual(['5 of 8 table-days used', '$160.00 paid']);
});

test("the money reads the Payments page's figures, a bar of paid against owed, and still owed opens Owes", async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await fourVendors(request, PRICING);
  await seatAndPay(request, marketId);
  const stats = await openStats(page, marketId);

  await expect(stats.money.getByRole('heading', { level: 2 })).toHaveText('Money');
  await expect(stats.moneyFigure('owed')).toHaveText('Owed$117.50');
  await expect(stats.moneyFigure('paid')).toHaveText('Paid$90.00');
  await expect(stats.moneyFigure('stillOwed')).toHaveText('Still owed$35.00');
  await expect(stats.money.getByTestId('stats-money-bar-words')).toHaveText(
    '$90.00 of $117.50 paid',
  );
  // The bar is drawn for the eye; the words carry its figures. Nobody paid past what is owed, so
  // the track's end is what is owed, and no mark stands there.
  await expect(stats.moneyBar).toHaveAttribute('aria-hidden', 'true');
  await expect(stats.money.getByTestId('stats-money-bar-mark')).toHaveCount(0);
  await expect(stats.money.getByTestId('stats-money-bar-past')).toHaveCount(0);
  // Only still owed is worked on somewhere of its own.
  await expect(stats.moneyFigure('owed').getByRole('link')).toHaveCount(0);
  await expect(stats.moneyFigure('paid').getByRole('link')).toHaveCount(0);

  for (const [id, total] of [
    ['owed', 'owedCents'],
    ['paid', 'paidCents'],
    ['stillOwed', 'stillOwedCents'],
  ] as const) {
    const amount = await figureOf(stats.moneyFigure(id).locator('dd'));
    await stats.page.goto(marketScreenPath(marketId, 'payments'));
    await expect(page.getByTestId(`payments-total-${total}`).locator('dd')).toHaveText(amount, {
      timeout: 15000,
    });
    await openStats(page, marketId);
  }

  await stats.moneyFigure('stillOwed').getByRole('link', { name: '$35.00' }).click();
  await expect(page).toHaveURL(/\/payments\?show=owes$/);
  await expect(page.getByTestId('payments-show-owes')).toHaveAttribute('aria-pressed', 'true', {
    timeout: 15000,
  });
});

test("check-in reads each day's vendors in of those expected from Market Days, and who is not yet in opens that day", async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await fourVendors(request, null);
  // Results are published below, which waits for tables to be allocated (T316): the seats are
  // hand edits of a run.
  await allocateThenFreeEverySeat(request, BACKEND_URL, marketId);
  await seatAndPay(request, marketId);
  let stats = await openStats(page, marketId);
  // Nobody checks in before Market Days, and an unpriced market has no money to tell.
  await expect(stats.fill).toBeVisible();
  await expect(stats.checkIn).toHaveCount(0);
  await expect(stats.money).toHaveCount(0);

  await publishResults(request, BACKEND_URL, TEST_USER.email, marketId);
  await call(request, 'post', `/markets/${marketId}/transition`, { toPhase: 'market_days' });
  // Alice and Bob are in on the first day; Carol is in on the second, where Alice is not yet.
  recordCheckIns(
    marketId,
    [
      { vendorEmail: ALICE, date: SEED_MARKET_DATE },
      { vendorEmail: BOB, date: SEED_MARKET_DATE },
      { vendorEmail: CAROL, date: SECOND_DATE },
    ],
    TEST_USER.email,
  );
  stats = await openStats(page, marketId);

  await expect(stats.checkIn.getByRole('heading', { level: 2 })).toHaveText('Check-in');
  await expect(stats.checkInRows).toHaveCount(2);
  const first = stats.checkInRow(SEED_MARKET_DATE);
  const second = stats.checkInRow(SECOND_DATE);
  await expect(first.getByTestId('stats-check-in-row-label')).toHaveText('Friday, May 1, 2099');
  await expect(first.getByTestId('stats-check-in-row-words')).toHaveText('2 of 2 checked in');
  await expect(second.getByTestId('stats-check-in-row-words')).toHaveText('1 of 2 checked in');
  // Nobody missing is said, not linked; a reader hears the row as one line.
  await expect(first.getByTestId('stats-check-in-missing')).toHaveText('Everyone is in');
  await expect(first.getByRole('link')).toHaveCount(0);
  await expect(second).toHaveText('Friday, May 8, 2099: 1 of 2 checked in, 1 not yet');
  await expect(second.getByTestId('stats-check-in-row-bar')).toHaveAttribute('aria-hidden', 'true');

  await second.getByRole('link', { name: '1 not yet' }).click();
  await expect(page).toHaveURL(new RegExp(`/attendance\\?date=${SECOND_DATE}$`));
  const door = new AttendanceStatusPage(page);
  await expect(door.date(SECOND_DATE)).toHaveAttribute('aria-pressed', 'true', {
    timeout: 15000,
  });
  await expect(door.date(SECOND_DATE)).toContainText('1/2');
});
