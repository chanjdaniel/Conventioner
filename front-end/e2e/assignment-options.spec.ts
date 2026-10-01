import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { savePlan } from './helpers/savePlan';
import { SEED_MARKET_DATE } from './helpers/seeds';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * The two assignment options (E26/F04/S03).
 *
 * "Leave blank for no ceiling" kept Assign disabled until a ceiling was typed (bug 7), and both
 * inputs rendered as blank white areas with no border and no name (bug 13).
 */
test('a blank ceiling runs with no ceiling, and both options are named fields', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { run: false },
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    priority: [],
    marketDates: [{ date: SEED_MARKET_DATE }],
    tiers: [{ id: 1, name: 'Gold' }],
    locations: [{ name: 'Main Hall' }],
    sections: [
      { name: 'Hall A', location: { name: 'Main Hall' }, tier: { id: 1, name: 'Gold' }, count: 5 },
    ],
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: 50 },
  });

  await page.goto(marketScreenPath(marketId, 'assignment'));
  const ceiling = page.getByRole('spinbutton', { name: 'Max assignments per vendor' });
  const halves = page.getByRole('spinbutton', { name: /Max half table proportion/ });
  await expect(ceiling).toHaveValue('');
  await expect(ceiling).toHaveAttribute('placeholder', 'No ceiling');
  await expect(halves).toHaveValue('50');
  for (const input of [ceiling, halves]) {
    const border = await input.evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(parseFloat(border)).toBeGreaterThanOrEqual(1);
  }

  const run = page.getByTestId('market-setup-assign-button');
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page).toHaveURL(new RegExp(`/markets/${marketId}/result$`), { timeout: 15000 });

  const res = await request.get(`${BACKEND_URL}/markets/${marketId}`);
  const { market } = (await res.json()) as {
    market: {
      setupObject: { assignmentOptions: { maxAssignmentsPerVendor: number | null } };
      assignmentObject: { vendorAssignments?: unknown[] };
    };
  };
  expect(market.setupObject.assignmentOptions.maxAssignmentsPerVendor).toBeNull();
  expect(market.assignmentObject.vendorAssignments?.length).toBeGreaterThan(0);
});
