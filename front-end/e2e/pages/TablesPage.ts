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
  /** The status pills above the list: assigned, partial, empty. */
  readonly countAssigned: Locator;
  readonly countPartial: Locator;
  readonly countEmpty: Locator;
  readonly dateGroups: Locator;
  readonly dialog: Locator;
  readonly dialogWarning: Locator;
  readonly dialogError: Locator;

  constructor(page: Page) {
    this.page = page;

    this.countAssigned = page.getByTestId('tables-count-assigned');
    this.countPartial = page.getByTestId('tables-count-partial');
    this.countEmpty = page.getByTestId('tables-count-empty');
    this.dateFilterChip = page.getByTestId('tables-filter-chip-date');
    this.sectionFilterChip = page.getByTestId('tables-filter-chip-section');
    this.tierFilterChip = page.getByTestId('tables-filter-chip-tier');
    this.choiceFilterChip = page.getByTestId('tables-filter-chip-choice');
    this.clearAllFilterButton = page.getByTestId('tables-filter-chip-clear-all');
    this.backButton = page.getByTestId('tables-back-button');
    this.tableRows = page.locator('.table-row');
    this.dateGroups = page.locator('.date-group');
    this.dialog = page.getByTestId('placement-dialog-window');
    this.dialogWarning = page.getByTestId('placement-dialog-warning');
    this.dialogError = page.getByTestId('placement-dialog-error');
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

  // ── Changing a placement (E11/F03/S01) ───────────────────────────────────────

  /** One table's row, by the code printed on it. */
  row(tableCode: string): Locator {
    return this.page.locator(`[data-testid="tables-table-row"][data-table-code="${tableCode}"]`);
  }

  /** A free seat at one table. `nth` picks the side when the table has two. */
  vacantSeat(tableCode: string, nth = 0): Locator {
    return this.row(tableCode).getByTestId('tables-seat-empty').nth(nth);
  }

  /** A seat somebody holds. */
  occupiedSeat(tableCode: string, nth = 0): Locator {
    return this.row(tableCode).getByTestId('tables-seat-occupied').nth(nth);
  }

  /** Who holds a seat, read from the seat itself rather than from the text drawn on it. */
  async occupantOf(seat: Locator): Promise<string> {
    return (await seat.getAttribute('data-vendor-email')) ?? '';
  }

  /** The table code the row around a seat carries. */
  async tableCodeOf(seat: Locator): Promise<string> {
    return (
      (await seat
        .locator('xpath=ancestor::*[@data-testid="tables-table-row"]')
        .getAttribute('data-table-code')) ?? ''
    );
  }

  async setFilter(name: 'date' | 'section' | 'tier' | 'choice', value: string): Promise<void> {
    await this.page.getByTestId(`tables-filter-${name}`).selectOption(value);
  }

  async placeVendor(email: string): Promise<void> {
    await this.dialog.getByTestId('placement-dialog-vendor').selectOption(email);
    await this.dialog.getByTestId('placement-dialog-confirm').click();
  }

  async swapWith(email: string): Promise<void> {
    await this.dialog.getByTestId('placement-dialog-swap-target').selectOption(email);
    await this.dialog.getByTestId('placement-dialog-swap').click();
  }

  async freeSeat(): Promise<void> {
    await this.dialog.getByTestId('placement-dialog-free').click();
  }
}
