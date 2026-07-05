import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the table browsing view (/markets/:marketId/tables).
 */
export class TablesPage {
  readonly page: Page;

  readonly dateFilterChip: Locator;
  readonly sectionFilterChip: Locator;
  readonly tierFilterChip: Locator;
  readonly choiceFilterChip: Locator;
  readonly clearAllFilterButton: Locator;
  readonly backButton: Locator;
  readonly tableRows: Locator;
  readonly dateGroups: Locator;

  constructor(page: Page) {
    this.page = page;

    this.dateFilterChip = page.getByTestId('tables-filter-chip-date');
    this.sectionFilterChip = page.getByTestId('tables-filter-chip-section');
    this.tierFilterChip = page.getByTestId('tables-filter-chip-tier');
    this.choiceFilterChip = page.getByTestId('tables-filter-chip-choice');
    this.clearAllFilterButton = page.getByTestId('tables-filter-chip-clear-all');
    this.backButton = page.getByTestId('tables-back-button');
    this.tableRows = page.locator('.table-row');
    this.dateGroups = page.locator('.date-group');
  }

  async goto(marketId: string): Promise<void> {
    await this.page.goto(`/markets/${marketId}/tables`);
  }

  async gotoWithFilters(marketId: string, query: Record<string, string>): Promise<void> {
    const params = new URLSearchParams(query).toString();
    await this.page.goto(`/markets/${marketId}/tables?${params}`);
  }

  async clearAllFilters(): Promise<void> {
    await this.clearAllFilterButton.click();
  }

  async clickBack(): Promise<void> {
    await this.backButton.click();
  }
}
