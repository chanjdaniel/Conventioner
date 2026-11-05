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
    { name: 'North Wing', location: { name: 'Main Hall' }, tier: GOLD, count: 2 },
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
        { $set: { 'form_data.essential_section_ranking': ['North Wing', 'Landing'] } })`,
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
      groups: [],
      everyoneElse: [
        { tier: 'Gold', cents: 3500 },
        { tier: 'Silver', cents: 3000 },
      ],
    });

    for (const toPhase of ['applications', 'assignment']) {
      await call(request, 'post', `/markets/${marketId}/transition`, { toPhase });
    }
    // Alice on a Gold full table on the first day and a Silver half table on the second: a tier she
    // did not pick, priced at the table's tier all the same (Q20).
    const alice = 'alice@example.com';
    for (const [date, table_code, table_choice] of [
      [SEED_MARKET_DATE, 'North Wing 1', 'Full Table'],
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
        'Gold, full table, $35.00',
      );
      await expect(cards.nth(1).getByTestId('vendor-date-card-price')).toHaveText(
        'Silver, half table, $15.00',
      );

      // Past draft the card is read-only, under the setup's own lock line.
      await page.goto(marketSetupPath(marketId, 'setup'));
      const card = page.getByTestId('plan-card-pricing');
      await expect(card).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('plan-setup-settled')).toContainText('The setup is settled');
      await expect(card.getByRole('textbox', { name: 'Everyone else Gold' })).toBeDisabled();
      await expect(card.getByRole('textbox', { name: 'Everyone else Gold' })).toHaveValue('$35.00');
      await expect(card.getByTestId('pricing-half-percent')).toBeDisabled();
      await expect(card.getByTestId('pricing-currency')).toBeDisabled();
    });
  });

  test('a table of many tiers scrolls inside the card, shading the end with more beyond it', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedMarketWithVendors(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { dates: [SEED_MARKET_DATE, SECOND_DATE] },
    );
    const tiers = Array.from({ length: 14 }, (_, i) => ({
      id: i + 1,
      name: `A long tier ${i + 1}`,
    }));
    await savePlan(request, BACKEND_URL, TEST_USER.email, seed.marketId, {
      ...PLAN,
      tiers,
      sections: tiers.map((tier) => ({
        name: `Section ${tier.id}`,
        location: { name: 'Main Hall' },
        tier,
        count: 1,
      })),
    });

    await page.goto(marketSetupPath(seed.marketId, 'setup'));
    const card = page.getByTestId('plan-card-pricing');
    await expect(card).toBeVisible({ timeout: 15000 });
    const frame = card.getByTestId('pricing-frame');
    const left = card.getByTestId('pricing-frame-shade-left');
    const right = card.getByTestId('pricing-frame-shade-right');
    await expect(right).toBeVisible();
    await expect(left).toHaveCount(0);
    await expect(frame, 'a cell takes the keys, so the scroller is no stop').not.toHaveAttribute(
      'tabindex',
      /.*/,
    );

    // Focus walks to the last cell, past the edge, and brings it into view.
    const last = card.getByRole('textbox', { name: 'Everyone else A long tier 14' });
    await last.focus();
    await expect(last).toBeInViewport({ ratio: 1 });
    await expect(left).toBeVisible();

    await frame.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(right).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      'the page stays',
    ).toBeLessThanOrEqual(0);
  });

  test('a cell reads as currency once left, and the plain number while focused', async ({
    authenticatedPage: page,
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
    mongoEval(
      `db.applications.updateMany({ market_id: ${JSON.stringify(marketId)} },
        { $set: { 'form_data.essential_section_ranking': ['North Wing', 'Landing'] } })`,
    );
    await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, PLAN);
    const stored = async () =>
      (await (await request.get(`${BACKEND_URL}/markets/${marketId}`)).json()).market.setupObject
        .pricing;

    await page.goto(marketSetupPath(marketId, 'setup'));
    const card = page.getByTestId('plan-card-pricing');
    await expect(card).toBeVisible({ timeout: 15000 });
    const gold = card.getByRole('textbox', { name: 'Everyone else Gold' });
    const silver = card.getByRole('textbox', { name: 'Everyone else Silver' });

    // Typed as a number, left as money; focused again, the number to edit, the caret at its end.
    await gold.fill('50');
    await gold.press('Tab');
    await expect(gold).toHaveValue('$50.00');
    // Pressed at its left edge, where the caret would land at the start of the text it replaced.
    await gold.click({ position: { x: 8, y: 10 } });
    await expect(gold).toHaveValue('50.00');
    expect(
      await gold.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
    ).toEqual([5, 5]);

    // Money pasted as the app writes it is taken whole.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText('$1,234.50'));
    await silver.focus();
    await page.keyboard.press('ControlOrMeta+V');
    await expect(silver).toHaveValue('$1,234.50');
    await silver.press('Tab');
    await expect(silver).toHaveValue('$1,234.50');
    // Come back to by the keyboard, the number is not selected whole: the caret is at its end.
    await page.keyboard.press('Shift+Tab');
    await expect(silver).toBeFocused();
    await expect(silver).toHaveValue('1234.50');
    expect(
      await silver.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
    ).toEqual([7, 7]);
    await silver.press('Tab');

    // Text that is no amount keeps its text and the card's error once left, until it is fixed.
    // An amount field rewrites itself on focus, which drops a selection made before it: focus it,
    // as a person does, before filling it.
    await gold.focus();
    await gold.fill('3x');
    await gold.press('Tab');
    await expect(gold).toHaveValue('3x');
    await expect(card.getByTestId('pricing-error')).toBeVisible();
    await gold.fill('$50');
    await gold.press('Tab');
    await expect(gold).toHaveValue('$50.00');
    await expect(card.getByTestId('pricing-error')).toHaveCount(0);

    // Another currency re-reads every left cell at once.
    const currency = card.getByTestId('pricing-currency');
    await currency.focus();
    await currency.selectOption('USD');
    await expect(gold).toHaveValue('US$50.00');
    await expect(silver).toHaveValue('US$1,234.50');
    await expect(page.getByTestId('market-setup-plan-saved')).toBeVisible({ timeout: 10000 });
    await expect.poll(stored).toMatchObject({
      currency: 'USD',
      everyoneElse: [
        { tier: 'Gold', cents: 5000 },
        { tier: 'Silver', cents: 123450 },
      ],
    });

    // The vendor's date card names the price the cell read.
    for (const toPhase of ['applications', 'assignment']) {
      await call(request, 'post', `/markets/${marketId}/transition`, { toPhase });
    }
    await call(request, 'put', `/markets/${marketId}/placements`, {
      email: 'alice@example.com',
      date: SEED_MARKET_DATE,
      table_code: 'Landing 1',
      table_choice: 'Full Table',
    });
    const cards = await dateCards(page, marketId, 'alice@example.com', PLAN.marketDates.length);
    await expect(cards.nth(0).getByTestId('vendor-date-card-price')).toHaveText(
      'Silver, full table, US$1,234.50',
    );
  });

  test('prices typed key by key keep their cents, and text that is no value keeps nothing', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedMarketWithVendors(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { dates: [SEED_MARKET_DATE, SECOND_DATE] },
    );
    await savePlan(request, BACKEND_URL, TEST_USER.email, seed.marketId, PLAN);
    const stored = async () =>
      (await (await request.get(`${BACKEND_URL}/markets/${seed.marketId}`)).json()).market
        .setupObject.pricing;

    await page.goto(marketSetupPath(seed.marketId, 'setup'));
    const card = page.getByTestId('plan-card-pricing');
    await expect(card).toBeVisible({ timeout: 15000 });
    const gold = card.getByRole('textbox', { name: 'Everyone else Gold' });
    const silver = card.getByRole('textbox', { name: 'Everyone else Silver' });

    // As an organizer types: one key at a time, the cell never redrawn under the caret.
    await gold.pressSequentially('12.05');
    await expect(gold).toHaveValue('12.05');
    await silver.pressSequentially('30.01');
    await expect(silver).toHaveValue('30.01');
    await expect(gold).toHaveValue('$12.05');
    await expect(page.getByTestId('market-setup-plan-saved')).toBeVisible({ timeout: 10000 });
    await expect.poll(stored).toMatchObject({
      everyoneElse: [
        { tier: 'Gold', cents: 1205 },
        { tier: 'Silver', cents: 3001 },
      ],
    });

    // A share typed past 100 is shown with its error, and the plan keeps the share it had.
    const share = card.getByTestId('pricing-half-percent');
    await share.fill('');
    await share.pressSequentially('150');
    await expect(card.getByTestId('pricing-share-error')).toBeVisible();
    await expect(share).toHaveValue('150');
    await page.reload();
    await expect(card.getByTestId('pricing-half-percent')).toHaveValue('50', { timeout: 15000 });
    expect((await stored()).halfTablePercent).toBe(50);
  });

  test('text that is no amount keeps no price nobody chose, and follows its tier', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedMarketWithVendors(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { dates: [SEED_MARKET_DATE, SECOND_DATE] },
    );
    await savePlan(request, BACKEND_URL, TEST_USER.email, seed.marketId, PLAN);
    const stored = async () =>
      (await (await request.get(`${BACKEND_URL}/markets/${seed.marketId}`)).json()).market
        .setupObject;

    await page.goto(marketSetupPath(seed.marketId, 'setup'));
    const card = page.getByTestId('plan-card-pricing');
    await expect(card).toBeVisible({ timeout: 15000 });

    // A blank cell on its way to no amount: "3" is never kept as a price behind the error.
    await card.getByRole('textbox', { name: 'Everyone else Silver' }).pressSequentially('3x');
    await expect(card.getByTestId('pricing-error')).toBeVisible();

    // Tier Setup renames Silver: the text moves with it, still to fix, and fixing it saves both.
    await page.getByTestId('setup-tier-name-input-1').fill('Silvery');
    const silvery = card.getByRole('textbox', { name: 'Everyone else Silvery' });
    await expect(silvery).toHaveValue('3x');
    await expect(silvery).toHaveAttribute('aria-invalid', 'true');
    await silvery.fill('31');
    await expect(card.getByTestId('pricing-error')).toHaveCount(0);
    await expect(page.getByTestId('market-setup-plan-saved')).toBeVisible({ timeout: 10000 });
    await expect.poll(stored).toMatchObject({
      tiers: [GOLD, { ...SILVER, name: 'Silvery' }],
      pricing: { everyoneElse: [{ tier: 'Silvery', cents: 3100 }] },
    });

    // Leaving the page with a blank cell still on its way writes no price for it.
    await card.getByRole('textbox', { name: 'Everyone else Gold' }).pressSequentially('3x');
    await expect(card.getByTestId('pricing-error')).toBeVisible();
    await page.getByTestId('market-bar-tab-applications').click();
    await expect(card).toHaveCount(0);
    await expect
      .poll(async () => (await stored()).pricing.everyoneElse)
      .toEqual([{ tier: 'Silvery', cents: 3100 }]);
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
