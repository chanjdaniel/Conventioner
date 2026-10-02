import type { Locator } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPhaseMarket } from './helpers/seedPhaseMarket';
import { savePlan } from './helpers/savePlan';

/**
 * The Markets and Organizations lists read cleanly (bug 14, and items 8 and 9 of bug 43;
 * E26/F10/S01).
 *
 * A name longer than its column wrapped, so its card stood taller than its neighbours; a market on
 * two Saturdays read "Oct 3-10, 2026", eight days by the look of it; and Manage was solid black on
 * one list and outlined on the other.
 */
test.use({ viewport: { width: 1440, height: 900 } });

const PLAN = {
  priority: [],
  marketDates: [{ date: '2026-10-03' }, { date: '2026-10-10' }],
  tiers: [],
  locations: [],
  sections: [],
  assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
};

async function lineCount(name: Locator): Promise<number> {
  return name.evaluate((el) => {
    const style = getComputedStyle(el);
    return Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight));
  });
}

test('a market on two separate days names both, and its name keeps to one line', async ({
  authenticatedPage: page,
  request,
}) => {
  const market = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  await savePlan(request, BACKEND_URL, TEST_USER.email, market.marketId, PLAN);
  const long = `${market.marketName} Harbour Night Market of Handmade Goods`;
  const rename = await request.put(`${BACKEND_URL}/markets/${market.marketId}/name`, {
    data: { name: long },
  });
  expect(rename.ok(), await rename.text()).toBeTruthy();

  await page.goto('/markets');
  await page.getByTestId('markets-search-input').fill(market.marketName);
  const card = page.getByTestId('market-card');
  await expect(card).toHaveCount(1);

  await expect(card).toContainText('Oct 3 and 10, 2026');
  const name = card.getByTestId('market-card-name');
  expect(await lineCount(name)).toBe(1);
  // Shortened where it must be, never lost: the whole name is its hover text.
  await expect(name).toHaveAttribute('title', long);
});

test('an organization name keeps to one line, and Manage is one button on both lists', async ({
  authenticatedPage: page,
  request,
}) => {
  const market = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const orgName = `Pier Collective Society of Independent Makers ${Date.now()}`;
  const created = await request.post(`${BACKEND_URL}/organizations`, { data: { name: orgName } });
  expect(created.ok(), await created.text()).toBeTruthy();

  await page.goto('/organizations');
  const org = page.getByTestId('organization-card').filter({ hasText: orgName.slice(-13) });
  const orgTitle = org.locator('h3');
  await expect(orgTitle).toHaveAttribute('title', orgName);
  expect(await lineCount(orgTitle)).toBe(1);
  const cards = page.getByTestId('organization-card');
  const heights = await cards.evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().height)),
  );
  expect(new Set(heights).size, `card heights ${heights.join(', ')}`).toBe(1);

  const look = (button: Locator) =>
    button.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.backgroundColor, s.color, s.borderColor, s.height, s.fontSize].join(' ');
    });
  const onOrganizations = await look(org.getByTestId('organizations-manage-button'));

  await page.goto('/markets');
  await page.getByTestId('markets-search-input').fill(market.marketName);
  const onMarkets = await look(page.getByTestId('market-card-manage-button'));
  expect(onOrganizations).toBe(onMarkets);
});
