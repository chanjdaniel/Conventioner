import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { savePlan } from './helpers/savePlan';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';

/**
 * The Pricing card, and a price on each assignment (E43/F01/S01).
 *
 * Market Setup gains a full-table price per day for each tier and what a half table costs, and
 * every assignment shows its price on the drawer's date cards: the table's tier, half or full, even
 * at a tier the vendor did not pick (Q20).
 */
const EDITOR = { email: 'e2e-pricing-editor@example.com', password: 'e2epassword123' };
const SECOND_DATE = '2099-05-08';
const GOLD = { id: 1, name: 'Gold' };
const SILVER = { id: 2, name: 'Silver' };

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

/** The vendor's drawer, on its Assignments tab: a card for each of the market's `dates`. */
async function dateCards(page: Page, marketId: string, email: string, dates: number) {
  const query = new URLSearchParams({ vendor: email, vendorTab: 'assignments' });
  await page.goto(`${marketScreenPath(marketId, 'vendors')}?${query.toString()}`);
  const cards = page.getByTestId('vendors-detail-assignment-item');
  await expect(cards).toHaveCount(dates, { timeout: 15000 });
  return cards;
}

test.describe('the Pricing card', () => {
  test.beforeAll(() => {
    ensureVerifiedUser(EDITOR.email, EDITOR.password);
  });

  test('an Editor prices Gold and Silver, and each assignment shows its price', async ({
    browser,
    request,
  }) => {
    const seed = await seedMarketWithVendors(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { dates: [SEED_MARKET_DATE, SECOND_DATE] },
    );
    const marketId = seed.marketId;
    // Two sections, so every applicant ranks them.
    mongoEval(
      `db.applications.updateMany({ market_id: ${JSON.stringify(marketId)} },
        { $set: { 'form_data.essential_section_ranking': ['Atrium', 'Landing'] } })`,
    );
    await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, PLAN);
    await call(request, 'post', `/markets/${marketId}/roles`, {
      user_email: EDITOR.email,
      role: 'editor',
    });

    await withUser(browser, EDITOR.email, EDITOR.password, async (page) => {
      await page.goto(marketSetupPath(marketId, 'setup'));
      const card = page.getByTestId('plan-card-pricing');
      await expect(card).toBeVisible({ timeout: 15000 });
      await expect(card.locator('thead th')).toHaveText(['Who', 'Gold', 'Silver']);

      await card.getByRole('textbox', { name: 'Everyone else Gold' }).fill('35');
      await card.getByRole('textbox', { name: 'Everyone else Silver' }).fill('30');
      const half = card.getByTestId('pricing-half-percent');
      await expect(half).toHaveValue('50');
      await half.fill('50');
      await expect(card.getByTestId('pricing-currency')).toHaveValue('CAD');
      await expect(page.getByTestId('market-setup-plan-saved')).toBeVisible({ timeout: 10000 });
    });

    // Stored in cents, read back as they were typed.
    const stored = await request.get(`${BACKEND_URL}/markets/${marketId}`);
    expect((await stored.json()).market.setupObject.pricing).toEqual({
      currency: 'CAD',
      halfTablePercent: 50,
      everyoneElse: [
        { tier: 'Gold', cents: 3500 },
        { tier: 'Silver', cents: 3000 },
      ],
    });

    for (const toPhase of ['applications_open', 'applications_closed', 'review', 'assignment']) {
      await call(request, 'post', `/markets/${marketId}/transition`, { toPhase });
    }
    // Alice on a Gold full table on the first day and a Silver half table on the second: a tier she
    // did not pick, priced at the table's tier all the same (Q20).
    const alice = 'alice@example.com';
    for (const [date, table_code, table_choice] of [
      [SEED_MARKET_DATE, 'Atrium 1', 'Full Table'],
      [SECOND_DATE, 'Landing 1', 'Half Table (Left)'],
    ]) {
      await call(request, 'put', `/markets/${marketId}/placements`, {
        email: alice,
        date,
        table_code,
        table_choice,
      });
    }

    await withUser(browser, EDITOR.email, EDITOR.password, async (page) => {
      const cards = await dateCards(page, marketId, alice, PLAN.marketDates.length);
      await expect(cards.nth(0).getByTestId('vendor-date-card-price')).toHaveText(
        'Gold, full table, $35',
      );
      await expect(cards.nth(1).getByTestId('vendor-date-card-price')).toHaveText(
        'Silver, half table, $15',
      );

      // Past draft the card is read-only, under the setup's own lock line.
      await page.goto(marketSetupPath(marketId, 'setup'));
      const card = page.getByTestId('plan-card-pricing');
      await expect(card).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('plan-setup-settled')).toContainText('The setup is settled');
      await expect(card.getByRole('textbox', { name: 'Everyone else Gold' })).toBeDisabled();
      await expect(card.getByRole('textbox', { name: 'Everyone else Gold' })).toHaveValue('35');
      await expect(card.getByTestId('pricing-half-percent')).toBeDisabled();
      await expect(card.getByTestId('pricing-currency')).toBeDisabled();
    });
  });

  test('a market with no prices shows no price on any card', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const cards = await dateCards(page, seed.marketId, 'alice@example.com', 1);

    await expect(cards.first()).toHaveAttribute('data-state', 'placed');
    await expect(page.getByTestId('vendor-date-card-price')).toHaveCount(0);
  });
});
