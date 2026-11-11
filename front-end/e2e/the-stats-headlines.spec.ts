import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { seedApprovedVendor } from './helpers/seedApplication';
import { savePlan } from './helpers/savePlan';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { publishResults } from './helpers/seeds';
import { AttendanceStatusPage } from './pages/AttendanceStatusPage';
import { StatsPage } from './pages/StatsPage';
import { VendorsPage } from './pages/VendorsPage';

/**
 * The Stats tab's headlines (E45/F01/S03): the market's state in figures at the top of the page,
 * each the figure the page it links to shows, and the link opens that page with its filter - the
 * table-days used and free (Assignments), the vendors unassigned (Vendors, "Unassigned only"), and
 * what is owed, paid and still owed (Payments), the money only where the market sets prices.
 * Below them the Money section tells the same three figures with a bar of paid against owed, and
 * from Market Days on the Check-in section tells each day's vendors in of those expected (T201).
 */
const SECOND_DATE = '2099-05-08';
const GOLD = { id: 1, name: 'Gold' };
const SILVER = { id: 2, name: 'Silver' };
const ALICE = 'alice@example.com';
const BOB = 'bob@example.com';
const CAROL = 'carol@example.com';
const DAN = 'dan@example.com';

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

/** Four approved vendors on a market in assignment, nobody placed yet. */
async function fourVendors(
  request: APIRequestContext,
  pricing: typeof PRICING | null,
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
  for (const toPhase of ['applications', 'assignment']) {
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

/** Follow a headline's link, and come back to Stats for the next. */
async function follow(stats: StatsPage, marketId: string, id: string, then: () => Promise<void>) {
  await stats.headline(id).getByRole('link').click();
  await then();
  await openStats(stats.page, marketId);
}

async function figureOf(locator: Locator): Promise<string> {
  return ((await locator.textContent()) ?? '').trim();
}

test('each headline is the figure of the page it links to, opened on its filter', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await fourVendors(request, PRICING);
  await seatAndPay(request, marketId);
  const stats = await openStats(page, marketId);

  await expect(stats.page.getByTestId('stats-headlines')).toBeVisible();
  await expect(stats.headline('used')).toHaveText('4 of 8 table-days used');
  await expect(stats.headline('free')).toHaveText('4 table-days free');
  await expect(stats.headline('unassigned')).toHaveText('1 vendor unassigned');
  await expect(stats.headline('owed')).toHaveText('$117.50 owed');
  await expect(stats.headline('paid')).toHaveText('$90.00 paid');
  await expect(stats.headline('stillOwed')).toHaveText('$35.00 still owed');

  // The table-days used: the Assignments page's strip.
  await follow(stats, marketId, 'used', async () => {
    await expect(page).toHaveURL(new RegExp(`${marketScreenPath(marketId, 'assignments')}$`));
    await expect(page.getByTestId('result-tables-used')).toHaveText(/4\s+of\s+8 table-days used/, {
      timeout: 15000,
    });
  });

  // The table-days free: the grid's "Empty" count, chosen.
  const free = await figureOf(stats.headlineFigure('free'));
  await follow(stats, marketId, 'free', async () => {
    await expect(page).toHaveURL(/\/assignments\?status=empty$/);
    const empty = page.getByTestId('tables-count-empty');
    await expect(empty).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
    await expect(empty).toHaveText(`✓${free} empty`);
  });

  // The vendors unassigned: Vendors, "Unassigned only".
  const unassigned = await figureOf(stats.headlineFigure('unassigned'));
  await follow(stats, marketId, 'unassigned', async () => {
    await expect(page).toHaveURL(/\/vendors\?show=unassigned$/);
    const vendors = new VendorsPage(page);
    await expect(vendors.unassignedOnly).toHaveAttribute('aria-pressed', 'true', {
      timeout: 15000,
    });
    await expect(vendors.summary).toHaveText(
      new RegExp(`^${unassigned}\\s+of\\s+4\\s+vendors shown`),
    );
    await expect(vendors.vendorListItems).toHaveCount(Number(unassigned));
  });

  // What is owed and paid: the Payments page's figures.
  for (const [id, total] of [
    ['owed', 'owedCents'],
    ['paid', 'paidCents'],
  ]) {
    const figure = await figureOf(stats.headlineFigure(id));
    await follow(stats, marketId, id, async () => {
      await expect(page).toHaveURL(new RegExp(`${marketScreenPath(marketId, 'payments')}$`));
      await expect(page.getByTestId(`payments-total-${total}`).locator('dd')).toHaveText(figure, {
        timeout: 15000,
      });
    });
  }

  // What is still owed: Payments, "Owes".
  const stillOwed = await figureOf(stats.headlineFigure('stillOwed'));
  await follow(stats, marketId, 'stillOwed', async () => {
    await expect(page).toHaveURL(/\/payments\?show=owes$/);
    await expect(page.getByTestId('payments-show-owes')).toHaveAttribute('aria-pressed', 'true', {
      timeout: 15000,
    });
    await expect(page.getByTestId('payments-total-stillOwedCents').locator('dd')).toHaveText(
      stillOwed,
    );
    await expect(page.getByTestId('payments-row')).toHaveCount(1);
  });
});

test('placements are told once an assignment is stored, and money only with prices', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await fourVendors(request, null);
  let stats = await openStats(page, marketId);
  // Nothing stored and no prices: no state to headline.
  await expect(stats.page.getByTestId('stats-headlines')).toHaveCount(0);

  await seatAndPay(request, marketId);
  stats = await openStats(page, marketId);
  await expect(stats.headline('used')).toHaveText('4 of 8 table-days used');
  await expect(stats.headline('owed')).toHaveCount(0);
  await expect(stats.headline('stillOwed')).toHaveCount(0);
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
  // The bar is drawn for the eye; the words carry its figures. Nobody paid past what is owed.
  await expect(stats.moneyBar).toHaveAttribute('aria-hidden', 'true');
  await expect(stats.money.getByTestId('stats-money-bar-mark')).toBeVisible();
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
  await seatAndPay(request, marketId);
  let stats = await openStats(page, marketId);
  // Nobody checks in before Market Days, and an unpriced market has no money to tell.
  await expect(stats.fill).toBeVisible();
  await expect(stats.checkIn).toHaveCount(0);
  await expect(stats.money).toHaveCount(0);

  await publishResults(request, BACKEND_URL, TEST_USER.email, marketId);
  await call(request, 'post', `/markets/${marketId}/transition`, { toPhase: 'market_days' });
  // Alice and Bob are in on the first day; Carol is in on the second, where Alice is not yet.
  for (const [email, date] of [
    [ALICE, SEED_MARKET_DATE],
    [BOB, SEED_MARKET_DATE],
    [CAROL, SECOND_DATE],
  ]) {
    await call(request, 'post', `/markets/${marketId}/attendance`, { vendorEmail: email, date });
  }
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
