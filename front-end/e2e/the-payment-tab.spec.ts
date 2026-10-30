import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';

/**
 * The drawer's Payment tab (E44/F01/S01).
 *
 * A line per table-day with what is owed for it, the payments an Editor records, and how the two
 * compare. Freeing a table keeps its line, still owed, and changes neither amount (Q26); a Viewer
 * reads the tab and records nothing.
 */
const EDITOR = { email: 'e2e-payment-editor@example.com', password: 'e2epassword123' };
const VIEWER = { email: 'e2e-payment-viewer@example.com', password: 'e2epassword123' };
const SECOND_DATE = '2099-05-08';
const GOLD = { id: 1, name: 'Gold' };
const SILVER = { id: 2, name: 'Silver' };
const ALICE = 'alice@example.com';

const PLAN = {
  priority: [],
  marketDates: [{ date: SEED_MARKET_DATE }, { date: SECOND_DATE }],
  tiers: [GOLD, SILVER],
  locations: [{ name: 'Main Hall' }],
  sections: [
    { name: 'Atrium', location: { name: 'Main Hall' }, tier: GOLD, count: 2 },
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
  method: 'put' | 'post' | 'delete',
  path: string,
  data: Record<string, unknown>,
) {
  const res = await request[method](`${BACKEND_URL}${path}`, { data });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
}

/** A priced market in assignment, Alice on a Gold full table on both of its days. */
async function aliceOnTwoGoldDays(request: APIRequestContext): Promise<string> {
  const seed = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { dates: [SEED_MARKET_DATE, SECOND_DATE] },
  );
  const marketId = seed.marketId;
  mongoEval(
    `db.applications.updateMany({ market_id: ${JSON.stringify(marketId)} },
      { $set: { 'form_data.essential_section_ranking': ['Atrium', 'Landing'] } })`,
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, PLAN);
  for (const [user, role] of [
    [EDITOR.email, 'editor'],
    [VIEWER.email, 'viewer'],
  ]) {
    await call(request, 'post', `/markets/${marketId}/roles`, { user_email: user, role });
  }
  for (const toPhase of ['applications', 'assignment']) {
    await call(request, 'post', `/markets/${marketId}/transition`, { toPhase });
  }
  for (const date of [SEED_MARKET_DATE, SECOND_DATE]) {
    await call(request, 'put', `/markets/${marketId}/placements`, {
      email: ALICE,
      date,
      table_code: 'Atrium 1',
      table_choice: 'Full Table',
    });
  }
  return marketId;
}

/** Alice's drawer, open on its Payment tab. */
async function paymentTab(page: Page, marketId: string) {
  const query = new URLSearchParams({ vendor: ALICE, vendorTab: 'payment' });
  await page.goto(`${marketScreenPath(marketId, 'vendors')}?${query.toString()}`);
  const tab = page.getByTestId('payment-tab');
  await expect(tab).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('tab', { name: 'Payment' })).toHaveAttribute('aria-selected', 'true');
  return tab;
}

async function recordPayment(page: Page, amount: string, method: 'e-transfer' | 'cash') {
  await page.getByTestId('payment-record').click();
  const dialog = page.getByTestId('record-payment-window');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Amount (CAD)').fill(amount);
  await dialog.getByLabel(method === 'cash' ? 'Cash' : 'E-transfer').check();
  await dialog.getByRole('button', { name: 'Record payment' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('the Payment tab', () => {
  test.beforeAll(() => {
    ensureVerifiedUser(EDITOR.email, EDITOR.password);
    ensureVerifiedUser(VIEWER.email, VIEWER.password);
  });

  test('two Gold full days owe $70, and two payments of $35 pay it in full', async ({
    browser,
    request,
  }) => {
    const marketId = await aliceOnTwoGoldDays(request);

    await withUser(browser, EDITOR.email, EDITOR.password, async (page) => {
      const tab = await paymentTab(page, marketId);
      const lines = tab.getByTestId('payment-line');
      await expect(lines).toHaveCount(2);
      await expect(lines.nth(0)).toContainText('Atrium 1, Gold, full table');
      await expect(lines.nth(0).getByTestId('payment-line-owed')).toHaveText('$35');
      await expect(tab.getByTestId('payment-owed')).toHaveText('$70');
      await expect(tab.getByTestId('payment-paid')).toHaveText('$0');
      await expect(tab.getByTestId('payment-balance')).toHaveText('Owes $70');

      await recordPayment(page, '35', 'e-transfer');
      await expect(tab.getByTestId('payment-balance')).toHaveText('Owes $35');
      await expect(tab.getByTestId('payment-paid')).toHaveText('$35');

      await recordPayment(page, '35', 'cash');
      await expect(tab.getByTestId('payment-balance')).toHaveText('Paid in full');
      const entries = tab.getByTestId('payment-entry');
      await expect(entries).toHaveCount(2);
      await expect(entries.nth(0)).toContainText('Cash, paid');
      await expect(entries.nth(0).getByTestId('payment-entry-who')).toContainText(
        `Recorded by ${EDITOR.email}`,
      );

      // A reload reads what the server kept.
      await page.reload();
      await expect(page.getByTestId('payment-balance')).toHaveText('Paid in full', {
        timeout: 15000,
      });
    });

    // Freeing a paid day keeps its line, still owed, and changes neither amount (Q26).
    await call(request, 'delete', `/markets/${marketId}/placements`, {
      email: ALICE,
      date: SECOND_DATE,
    });
    await withUser(browser, EDITOR.email, EDITOR.password, async (page) => {
      const tab = await paymentTab(page, marketId);
      const lines = tab.getByTestId('payment-line');
      await expect(lines).toHaveCount(2);
      // The line says where its number came from: the seat, freed, and when.
      await expect(lines.nth(1).getByTestId('payment-line-source')).toHaveText(
        /^Atrium 1, Gold, full table - table freed [A-Z][a-z]{2} \d{1,2}, \d{4}$/,
      );
      await expect(lines.nth(1).getByTestId('payment-line-owed')).toHaveText('$35');
      await expect(tab.getByTestId('payment-owed')).toHaveText('$70');
      await expect(tab.getByTestId('payment-balance')).toHaveText('Paid in full');
    });
  });

  test('a Viewer reads the tab and is offered no Record payment', async ({ browser, request }) => {
    const marketId = await aliceOnTwoGoldDays(request);

    await withUser(browser, VIEWER.email, VIEWER.password, async (page) => {
      const tab = await paymentTab(page, marketId);
      await expect(tab.getByTestId('payment-owed')).toHaveText('$70');
      await expect(tab.getByText('No payments recorded.')).toBeVisible();
      await expect(page.getByTestId('payment-record')).toHaveCount(0);
    });
  });
});
