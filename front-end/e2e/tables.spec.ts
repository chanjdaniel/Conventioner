import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments, SEED_MARKET_DATE } from './helpers/seeds';
import { TablesPage } from './pages/TablesPage';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import type { Locator } from '@playwright/test';

/**
 * The palette as the browser reports it, from `src/assets/base.css`. Named here rather than read
 * from the page so that a token quietly changing value is a failure to look at, not a test that
 * agrees with whatever it finds.
 */
const AMBER = 'rgb(228, 166, 41)'; // --mm-yellow
const BEIGE = 'rgb(233, 230, 225)'; // --mm-beige
const GREEN = 'rgb(54, 130, 111)'; // --mm-green

const background = (locator: Locator) =>
  locator.evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe('Table browsing and filtering', () => {
  test('applies date filter via query params, shows filtered table groupings', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );

    const tablesPage = new TablesPage(page);
    await tablesPage.goto(seed.marketId);

    await expect(tablesPage.tableRows.first()).toBeVisible({ timeout: 10000 });
    const initialCount = await tablesPage.tableRows.count();
    expect(initialCount).toBeGreaterThan(0);

    await tablesPage.gotoWithFilters(seed.marketId, { date: '2026-05-01' });
    await expect(tablesPage.dateFilterChip).toBeVisible({ timeout: 5000 });
    await expect(tablesPage.tableRows.first()).toBeVisible({ timeout: 5000 });

    const filteredCount = await tablesPage.tableRows.count();
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThanOrEqual(initialCount);

    await tablesPage.gotoWithFilters(seed.marketId, { date: '2099-01-01' });
    await expect(tablesPage.tableRows).toHaveCount(0);

    await tablesPage.clearAllFilters();
    await expect(tablesPage.tableRows.first()).toBeVisible({ timeout: 5000 });
    await expect(tablesPage.tableRows).toHaveCount(initialCount);
  });

  test('applies section filter via query params and narrows results', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );

    const tablesPage = new TablesPage(page);
    await tablesPage.goto(seed.marketId);
    await expect(tablesPage.tableRows.first()).toBeVisible({ timeout: 10000 });

    await tablesPage.gotoWithFilters(seed.marketId, { section: 'A' });
    await expect(tablesPage.sectionFilterChip).toBeVisible({ timeout: 5000 });
    await expect(tablesPage.tableRows.first()).toBeVisible({ timeout: 5000 });

    const sectionFilteredCount = await tablesPage.tableRows.count();
    expect(sectionFilteredCount).toBeGreaterThan(0);
  });

  test('clearing filters restores all table rows', async ({ authenticatedPage: page, request }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );

    const tablesPage = new TablesPage(page);
    await tablesPage.goto(seed.marketId);
    await expect(tablesPage.tableRows.first()).toBeVisible({ timeout: 10000 });

    await tablesPage.gotoWithFilters(seed.marketId, { date: '2026-05-01' });
    await expect(tablesPage.dateFilterChip).toBeVisible({ timeout: 5000 });
    await expect(tablesPage.tableRows.first()).toBeVisible({ timeout: 5000 });

    await tablesPage.clearAllFilters();
    await expect(tablesPage.dateFilterChip).toHaveCount(0);
    await expect(tablesPage.tableRows.first()).toBeVisible({ timeout: 5000 });
  });

  /**
   * "6 assigned, 0 partial, 14 empty" - and the partial pill was amber whatever its value, so a
   * market with nothing partially filled showed a warning-coloured zero pulling the eye to a
   * non-problem (E14/F02/S03).
   */
  test('a count of zero is not worn in a colour that asks for attention', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );

    const tablesPage = new TablesPage(page);
    await tablesPage.goto(seed.marketId);
    await expect(tablesPage.tableRows.first()).toBeVisible({ timeout: 10000 });

    // This seed places both vendors at full tables, so nothing is partially filled - which is the
    // case the pill got wrong. Asserted, not assumed: if the seed ever changes, this says so rather
    // than quietly testing a pill that was never zero.
    await expect(tablesPage.countPartial).toHaveText('0 partial');
    expect(await background(tablesPage.countPartial), 'a zero count kept its fill').toBe(BEIGE);

    // A count that is not zero keeps its colour. The green one is the only non-zero pill this seed
    // produces whose colour differs from the neutral fill; the amber one gets its own test below,
    // because a market with nothing partial cannot show what amber does.
    await expect(tablesPage.countAssigned).toHaveText('2 assigned');
    expect(await background(tablesPage.countAssigned)).toBe(GREEN);
  });

  /**
   * The other half of the same criterion, and it needs its own market: a seed with nothing
   * partially filled cannot show what amber does, so the test above would stay green if the amber
   * were deleted outright rather than made conditional. This one fails in that case.
   *
   * Placed by hand rather than by seeding a vendor who asked for half a table. The solver gave that
   * vendor a whole one, correctly - with five tables and three vendors there is no reason to share
   * - so the answer to "what makes a table partial" is a placement, not a preference.
   */
  test('a partial count that is not zero still asks to be looked at', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );

    // One side of a table nobody else is on: one occupant, not a full-table booking, which is what
    // `rowStatus` counts as partial.
    const placed = await request.put(`${BACKEND_URL}/markets/${seed.marketId}/placements`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: {
        email: 'alice@example.com',
        date: SEED_MARKET_DATE,
        tableCode: 'Hall A 3',
        tableChoice: 'Half Table (Left)',
      },
    });
    expect(placed.ok(), await placed.text()).toBeTruthy();

    const tablesPage = new TablesPage(page);
    await tablesPage.goto(seed.marketId);
    await expect(tablesPage.tableRows.first()).toBeVisible({ timeout: 10000 });

    await expect(tablesPage.countPartial).not.toHaveText('0 partial');
    expect(await background(tablesPage.countPartial)).toBe(AMBER);
  });
});
