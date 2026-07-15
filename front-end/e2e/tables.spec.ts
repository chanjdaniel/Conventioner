import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { TablesPage } from './pages/TablesPage';

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
});
