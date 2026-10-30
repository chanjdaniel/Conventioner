import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { TablesPage } from './pages/TablesPage';

/**
 * An Admin changes the amount owed and the amount paid; freeing a table asks (E44/F01/S02).
 *
 * The market's owner, an Admin and more, sets a line to $0 to waive it; frees a paid seat and ticks
 * "Also remove its $15 from what Alice owes?", so the tab reads paid more than owed, a refund to
 * issue; and records the refund once it is given back, which squares the account (Daniel, T92 Q26).
 */
const SUNDAY = '2099-05-08';
const ALICE = 'alice@example.com';
const GOLD = { id: 1, name: 'Gold' };
const SILVER = { id: 2, name: 'Silver' };

const PLAN = {
  priority: [],
  marketDates: [{ date: SEED_MARKET_DATE }, { date: SUNDAY }],
  tiers: [GOLD, SILVER],
  locations: [{ name: 'Main Hall' }],
  sections: [
    { name: 'North Wing', location: { name: 'Main Hall' }, tier: GOLD, count: 2 },
    { name: 'Landing', location: { name: 'Main Hall' }, tier: SILVER, count: 2 },
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

/**
 * A priced market in assignment: Alice on a Gold full table the first day ($35) and a Silver half
 * table on Sunday ($15), who paid the $50 in full.
 */
async function alicePaidInFull(request: APIRequestContext): Promise<string> {
  const seed = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { dates: [SEED_MARKET_DATE, SUNDAY] },
  );
  const marketId = seed.marketId;
  mongoEval(
    `db.applications.updateMany({ market_id: ${JSON.stringify(marketId)} },
      { $set: { 'form_data.essential_section_ranking': ['North Wing', 'Landing'] } })`,
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, PLAN);
  for (const toPhase of ['applications', 'assignment']) {
    await call(request, 'post', `/markets/${marketId}/transition`, { toPhase });
  }
  for (const [date, table_code, table_choice] of [
    [SEED_MARKET_DATE, 'North Wing 1', 'Full Table'],
    [SUNDAY, 'Landing 1', 'Half Table (Left)'],
  ]) {
    await call(request, 'put', `/markets/${marketId}/placements`, {
      email: ALICE,
      date,
      table_code,
      table_choice,
    });
  }
  await call(request, 'post', `/markets/${marketId}/payments/${ALICE}`, {
    cents: 5000,
    method: 'e-transfer',
    paidOn: '2099-04-01',
  });
  return marketId;
}

async function paymentTab(page: Page, marketId: string) {
  const query = new URLSearchParams({ vendor: ALICE, vendorTab: 'payment' });
  await page.goto(`${marketScreenPath(marketId, 'vendors')}?${query.toString()}`);
  const tab = page.getByTestId('payment-tab');
  await expect(tab.getByTestId('payment-balance')).toBeVisible({ timeout: 15000 });
  return tab;
}

/** Free Alice's Sunday seat from the Result page, ticking the deduction or not. */
async function freeSunday(page: Page, marketId: string, deduct: boolean) {
  const tables = new TablesPage(page);
  await tables.gotoWithFilters(marketId, { date: SUNDAY, search: ALICE });
  const seat = tables.row('Landing 1').locator(`[data-vendor-email="${ALICE}"]`);
  await expect(seat).toBeVisible({ timeout: 15000 });
  await tables.change(seat);
  const box = tables.dialog.getByLabel(/Also remove its \$15 from what .* owes\?/);
  await expect(box).not.toBeChecked();
  if (deduct) await box.check();
  await tables.dialog.getByTestId('placement-dialog-free').click();
  await expect(tables.dialog).toBeHidden();
}

test.describe('changing what is owed and paid', () => {
  test('an Admin sets a $35 line to $0, and the line shows the calculated price, who and when', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await alicePaidInFull(request);
    const tab = await paymentTab(page, marketId);
    await expect(tab.getByTestId('payment-owed')).toHaveText('$50');

    const first = tab.getByTestId('payment-line').first();
    await first.getByTestId('payment-line-menu-button').click();
    await first.getByTestId('payment-line-menu-owed').click();
    const dialog = page.getByTestId('change-owed-window');
    await dialog.getByLabel('Amount owed (CAD)').fill('0');
    await expect(dialog.getByTestId('change-owed-sentence')).toContainText(
      'will owe $0 instead of $35',
    );
    await dialog.getByRole('button', { name: 'Set amount owed' }).click();
    await expect(dialog).toBeHidden();

    await expect(tab.getByTestId('payment-owed')).toHaveText('$15');
    await expect(first.getByTestId('payment-line-owed')).toHaveText('$0');
    await expect(first.getByTestId('payment-line-price')).toHaveText('$35');
    await expect(first.getByTestId('payment-line-set')).toContainText(`Set by ${TEST_USER.email}`);

    // And back: the calculated price, once confirmed.
    await first.getByTestId('payment-line-menu-button').click();
    await first.getByTestId('payment-line-menu-calculated').click();
    await page.getByTestId('payment-confirm-submit-button').click();
    await expect(tab.getByTestId('payment-owed')).toHaveText('$50');
    await expect(first.getByTestId('payment-line-set')).toHaveCount(0);
  });

  test('freeing a paid $15 seat, ticked, reads paid $15 more than owed, and a $15 refund squares it', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await alicePaidInFull(request);
    await freeSunday(page, marketId, true);

    const tab = await paymentTab(page, marketId);
    const sunday = tab.locator(`[data-testid="payment-line"][data-date="${SUNDAY}"]`);
    await expect(sunday.getByTestId('payment-line-source')).toContainText('table freed');
    await expect(sunday.getByTestId('payment-line-owed')).toHaveText('$0');
    await expect(tab.getByTestId('payment-paid')).toHaveText('$50');
    await expect(tab.getByTestId('payment-balance')).toHaveText('Paid $15 more than owed');

    await page.getByTestId('payment-refund').click();
    const dialog = page.getByTestId('record-payment-window');
    await dialog.getByLabel('Amount (CAD)').fill('15');
    await dialog.getByLabel('Note (optional)').fill('Cancelled before the deadline');
    await dialog.getByRole('button', { name: 'Record refund' }).click();
    await expect(dialog).toBeHidden();

    await expect(tab.getByTestId('payment-balance')).toHaveText('Paid in full');
    const refund = tab.locator('[data-testid="payment-entry"][data-kind="refund"]');
    await expect(refund.getByTestId('payment-entry-amount')).toHaveText('-$15');
    await expect(refund).toContainText('Refund by e-transfer');

    // Each change is in the vendor's drawer History, with who and when (E40/F01/S04).
    await page.getByRole('tab', { name: 'History' }).click();
    const said = (action: string) =>
      page.locator(`[data-testid="market-history-entry"][data-action="${action}"]`);
    await expect(said('record-payment').getByTestId('market-history-sentence')).toHaveText(
      `${TEST_USER.email} recorded a payment of $50 from Alice Example`,
    );
    await expect(said('change-owed').getByTestId('market-history-sentence')).toHaveText(
      `${TEST_USER.email} set what Alice Example owes on May 8, 2099 to $0`,
    );
    await expect(said('adjust-paid').getByTestId('market-history-sentence')).toHaveText(
      `${TEST_USER.email} recorded a refund of $15 to Alice Example`,
    );
    for (const action of ['record-payment', 'change-owed', 'adjust-paid']) {
      await expect(said(action).locator('.history-when')).toHaveText(/\d{4} at \d{1,2}:\d{2}/);
    }
  });

  test('freeing it unticked leaves the line $15 owed, and saying the table was freed', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await alicePaidInFull(request);
    await freeSunday(page, marketId, false);

    const tab = await paymentTab(page, marketId);
    const sunday = tab.locator(`[data-testid="payment-line"][data-date="${SUNDAY}"]`);
    await expect(sunday.getByTestId('payment-line-source')).toContainText(
      'Landing 1, Silver, half table - table freed',
    );
    await expect(sunday.getByTestId('payment-line-owed')).toHaveText('$15');
    await expect(tab.getByTestId('payment-balance')).toHaveText('Paid in full');
  });

  test('the question names what the line owes, set by hand, and is not asked where it owes nothing', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await alicePaidInFull(request);
    const tables = new TablesPage(page);
    const openSunday = async () => {
      await tables.gotoWithFilters(marketId, { date: SUNDAY, search: ALICE });
      const seat = tables.row('Landing 1').locator(`[data-vendor-email="${ALICE}"]`);
      await expect(seat).toBeVisible({ timeout: 15000 });
      await tables.change(seat);
      await expect(tables.dialog).toBeVisible();
    };

    await call(request, 'put', `/markets/${marketId}/payments/${ALICE}/owed/${SUNDAY}`, {
      cents: 1000,
    });
    await openSunday();
    await expect(
      tables.dialog.getByLabel(/Also remove its \$10 from what .* owes\?/),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    await call(request, 'put', `/markets/${marketId}/payments/${ALICE}/owed/${SUNDAY}`, {
      cents: 0,
    });
    await openSunday();
    await expect(tables.dialog.getByTestId('placement-dialog-free')).toBeVisible();
    await expect(tables.dialog.getByTestId('placement-dialog-deduct')).toHaveCount(0);
  });
});
