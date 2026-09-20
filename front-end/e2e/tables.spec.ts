import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { TablesPage } from './pages/TablesPage';

/**
 * The palette as the browser reports it, from `src/assets/base.css`. Named here rather than read
 * from the page so that a token quietly changing value is a failure to look at, not a test that
 * agrees with whatever it finds.
 */
const AMBER = 'rgb(228, 166, 41)'; // --mm-yellow
const BEIGE = 'rgb(233, 230, 225)'; // --mm-beige
const GREEN = 'rgb(54, 130, 111)'; // --mm-green

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

    const background = (locator: typeof tablesPage.countPartial) =>
      locator.evaluate((el) => getComputedStyle(el).backgroundColor);

    // The market this seeds has nothing partially filled, which is the case the pill got wrong.
    await expect(tablesPage.countPartial).toHaveText('0 partial');
    expect(
      await background(tablesPage.countPartial),
      'a zero count kept the warning fill',
    ).not.toBe(AMBER);
    expect(await background(tablesPage.countPartial)).toBe(BEIGE);

    // A count that is not zero keeps its colour, which is the half that must not regress.
    await expect(tablesPage.countEmpty).not.toHaveText('0 empty');
    const assignedText = await tablesPage.countAssigned.textContent();
    if (!assignedText?.startsWith('0 ')) {
      expect(await background(tablesPage.countAssigned)).toBe(GREEN);
    }
  });
});
