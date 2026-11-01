import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { VendorsPage } from './pages/VendorsPage';
import { VendorExportDialog } from './pages/VendorExportDialog';
import { SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { approvedVendorApplication, insertApplications } from './helpers/seedApplication';
import { savePlan } from './helpers/savePlan';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';

/**
 * A payment reminder is one export (E42/F01/S04).
 *
 * Four vendors on a priced market, one in each payment state: Alice holds Gold on both days and
 * has paid nothing (owes $70), Dave holds Gold one day and has paid $10 (owes $25), Bob has paid
 * his $35 in full, and Carol paid $30 for a $15 half table (paid $15 more than owed). Exporting
 * "Owes" with name, email and the amount still owed gives exactly the vendors whose Payment tab
 * reads "Owes", each with what it says they owe.
 */
const SECOND_DATE = '2099-05-08';
const GOLD = { id: 1, name: 'Gold' };
const SILVER = { id: 2, name: 'Silver' };
const [ALICE, BOB, CAROL, DAVE] = ['alice', 'bob', 'carol', 'dave'].map((n) => `${n}@example.com`);

const PLAN = {
  priority: [],
  marketDates: [{ date: SEED_MARKET_DATE }, { date: SECOND_DATE }],
  tiers: [GOLD, SILVER],
  locations: [{ name: 'Main Hall' }],
  sections: [
    { name: 'North Wing', location: { name: 'Main Hall' }, tier: GOLD, count: 4 },
    { name: 'Landing', location: { name: 'Main Hall' }, tier: SILVER, count: 4 },
  ],
  assignmentOptions: { maxAssignmentsPerVendor: 2, maxHalfTableProportionPerSection: 50 },
  pricing: {
    currency: 'CAD',
    halfTablePercent: 50,
    everyoneElse: [
      { tier: 'Gold', cents: 3500 },
      { tier: 'Silver', cents: 3000 },
    ],
  },
};

async function call(
  request: APIRequestContext,
  method: 'put' | 'post',
  path: string,
  data: Record<string, unknown>,
) {
  const res = await request[method](`${BACKEND_URL}${path}`, { data });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
}

async function fourVendorsInEachState(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { dates: [SEED_MARKET_DATE, SECOND_DATE] },
  );
  const dates = [SEED_MARKET_DATE, SECOND_DATE];
  insertApplications([
    approvedVendorApplication(marketId, CAROL, { dates, tiers: ['Silver'], tableChoice: 'half' }),
    approvedVendorApplication(marketId, DAVE, { dates, tiers: ['Gold'] }),
  ]);
  mongoEval(
    `db.applications.updateMany({ market_id: ${JSON.stringify(marketId)} },
      { $set: { 'form_data.essential_section_ranking': ['North Wing', 'Landing'] } })`,
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, PLAN);
  for (const toPhase of ['applications', 'assignment']) {
    await call(request, 'post', `/markets/${marketId}/transition`, { toPhase });
  }
  const seats: [string, string, string, string][] = [
    [ALICE, SEED_MARKET_DATE, 'North Wing 1', 'Full Table'],
    [ALICE, SECOND_DATE, 'North Wing 1', 'Full Table'],
    [BOB, SEED_MARKET_DATE, 'North Wing 2', 'Full Table'],
    [CAROL, SECOND_DATE, 'Landing 1', 'Half Table (Left)'],
    [DAVE, SEED_MARKET_DATE, 'North Wing 3', 'Full Table'],
  ];
  for (const [email, date, table_code, table_choice] of seats) {
    await call(request, 'put', `/markets/${marketId}/placements`, {
      email,
      date,
      table_code,
      table_choice,
    });
  }
  for (const [email, cents] of [
    [BOB, 3500],
    [CAROL, 3000],
    [DAVE, 1000],
  ] as const) {
    await call(request, 'post', `/markets/${marketId}/payments/${encodeURIComponent(email)}`, {
      cents,
      method: 'e-transfer',
      paidOn: '2099-04-01',
      note: '',
    });
  }
  return marketId;
}

/** What a vendor's Payment tab says of their balance: "Owes $70", "Paid in full", ... */
async function paymentTabBalance(page: Page, marketId: string, email: string): Promise<string> {
  const query = new URLSearchParams({ vendor: email, vendorTab: 'payment' });
  await page.goto(`${marketScreenPath(marketId, 'vendors')}?${query.toString()}`);
  const balance = page.getByTestId('payment-tab').getByTestId('payment-balance');
  await expect(balance).toBeVisible({ timeout: 15000 });
  return ((await balance.textContent()) ?? '').trim();
}

test('exporting "Owes" gives exactly the vendors whose Payment tab says they owe, and how much', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await fourVendorsInEachState(request);

  const vendors = new VendorsPage(page);
  await vendors.goto(marketId);
  await expect(vendors.vendorListItems).toHaveCount(4);
  await vendors.exportButton.click();
  const dialog = new VendorExportDialog(page);
  await expect(dialog.window).toBeVisible();

  await dialog.payment.selectOption({ label: 'Owes' });
  await dialog.column('status').uncheck();
  await expect(dialog.group('payment')).toContainText('Still owed');
  await dialog.column('stillOwed').check();
  await expect(dialog.summary).toHaveText('2 vendors, 3 columns');
  await expect(dialog.previewHeader).toHaveText(/^Name\s*Email\s*Still owed$/);

  const { text } = await dialog.download();
  const [header, ...rows] = text.slice(1).trim().split(/\r?\n/);
  expect(header).toBe('Name,Email,Still owed');
  const exported = new Map(
    rows.map((row) => {
      const [, email, stillOwed] = row.split(',');
      return [email!, stillOwed!];
    }),
  );
  expect(Object.fromEntries(exported)).toEqual({ [ALICE]: '$70', [DAVE]: '$25' });

  // Each vendor's own Payment tab, the account the file was read from.
  const owing = new Map<string, string>();
  for (const email of [ALICE, BOB, CAROL, DAVE]) {
    const balance = await paymentTabBalance(page, marketId, email);
    if (balance.startsWith('Owes ')) owing.set(email, balance.slice('Owes '.length));
  }
  expect(owing).toEqual(exported);
});
