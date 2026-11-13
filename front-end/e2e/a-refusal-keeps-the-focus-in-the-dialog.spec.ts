import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { APIRequestContext } from '@playwright/test';
import { SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';

/**
 * A refused confirm leaves focus inside its dialog (T315, T223 notes 34 and 35).
 *
 * Record payment disables its confirm while it saves without holding its closes: pressing the
 * confirm disables the control that held the focus, so the browser drops it to `<body>`, and the
 * refusal enables the confirm again with the dialog still open. The shell moves focus back inside,
 * to the first safe control, so the next Tab stays in the dialog rather than starting from the page
 * behind it, which is inert.
 */
const GOLD = { id: 1, name: 'Gold' };
const ALICE = 'alice@example.com';
const REFUSAL = 'That payment could not be recorded.';

const PLAN = {
  priority: [],
  marketDates: [{ date: SEED_MARKET_DATE }],
  tiers: [GOLD],
  locations: [{ name: 'Main Hall' }],
  sections: [{ name: 'North Wing', location: { name: 'Main Hall' }, tier: GOLD, count: 2 }],
  assignmentOptions: { maxAssignmentsPerVendor: 1, maxHalfTableProportionPerSection: 50 },
  pricing: { currency: 'CAD', halfTablePercent: 50, everyoneElse: [{ tier: 'Gold', cents: 3500 }] },
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

/** A priced market in assignment, Alice on a Gold full table. */
async function aliceOnAGoldTable(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  mongoEval(
    `db.applications.updateMany({ market_id: ${JSON.stringify(marketId)} },
      { $set: { 'form_data.essential_section_ranking': ['North Wing'] } })`,
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, PLAN);
  for (const toPhase of ['applications', 'assignment']) {
    await call(request, 'post', `/markets/${marketId}/transition`, { toPhase });
  }
  await call(request, 'put', `/markets/${marketId}/placements`, {
    email: ALICE,
    date: SEED_MARKET_DATE,
    table_code: 'North Wing 1',
    table_choice: 'Full Table',
  });
  return marketId;
}

test('a refused Record payment leaves focus inside its dialog, and Tab stays there', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await aliceOnAGoldTable(request);
  const query = new URLSearchParams({ vendor: ALICE, vendorTab: 'payment' });
  await page.goto(`${marketScreenPath(marketId, 'vendors')}?${query.toString()}`);
  await expect(page.getByTestId('payment-tab')).toBeVisible({ timeout: 15000 });

  await page.getByTestId('payment-record').click();
  const dialog = page.getByTestId('record-payment-window');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Amount (CAD)').fill('35');

  await page.route(/\/payments\/[^/?]+$/, (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 400, json: { error: REFUSAL } })
      : route.fallback(),
  );
  const confirm = dialog.getByRole('button', { name: 'Record payment' });
  await confirm.click();
  await expect(dialog.getByTestId('record-payment-error')).toHaveText(REFUSAL);
  await expect(confirm).toBeEnabled();

  const focusIsInside = () => dialog.evaluate((window) => window.contains(document.activeElement));
  await expect.poll(focusIsInside).toBe(true);
  await expect(dialog.getByLabel('Amount (CAD)')).toBeFocused();

  await page.keyboard.press('Tab');
  expect(await focusIsInside()).toBe(true);
});
