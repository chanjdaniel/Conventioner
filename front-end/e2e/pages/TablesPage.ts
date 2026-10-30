import { marketScreenPath } from '../helpers/marketScreens';
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
  readonly tableRows: Locator;
  /** The status pills above the list: assigned, partial, empty. */
  readonly countAssigned: Locator;
  readonly countPartial: Locator;
  readonly countEmpty: Locator;
  readonly dateGroups: Locator;
  readonly dialog: Locator;
  readonly dialogWarning: Locator;
  readonly dialogError: Locator;
  /** The search beside the filters (E35/F02/S01), and its chip. */
  readonly searchInput: Locator;
  readonly searchChip: Locator;
  /** The placement history, behind its button (E35/F03/S03). */
  readonly historyButton: Locator;
  readonly historyDialog: Locator;
  readonly historyEntries: Locator;

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
    this.tableRows = page.locator('.table-row');
    this.dateGroups = page.locator('.date-group');
    this.dialog = page.getByTestId('placement-dialog-window');
    this.dialogWarning = page.getByTestId('placement-dialog-warning');
    this.dialogError = page.getByTestId('placement-dialog-error');
    this.searchInput = page.getByTestId('tables-filter-search');
    this.searchChip = page.getByTestId('tables-filter-chip-search');
    this.historyButton = page.getByTestId('result-history-button');
    this.historyDialog = page.getByTestId('placement-history-dialog-window');
    this.historyEntries = page.getByTestId('placement-history-entry');
  }

  async goto(marketId: string): Promise<void> {
    await this.page.goto(marketScreenPath(marketId, 'assignments'));
  }

  async gotoWithFilters(marketId: string, query: Record<string, string>): Promise<void> {
    const params = new URLSearchParams(query).toString();
    await this.page.goto(`${marketScreenPath(marketId, 'assignments')}?${params}`);
  }

  async clearAllFilters(): Promise<void> {
    await this.clearAllFilterButton.click();
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

  async search(words: string): Promise<void> {
    await this.searchInput.fill(words);
  }

  /** The table codes shown, in order. */
  async shownTableCodes(): Promise<string[]> {
    const codes: string[] = [];
    for (const row of await this.tableRows.all()) {
      codes.push((await row.getAttribute('data-table-code')) ?? '');
    }
    return codes;
  }

  /** Open the placement history from its button. */
  async openHistory(): Promise<void> {
    await this.historyButton.click();
    await this.historyDialog.waitFor();
  }

  /** Open whoever holds a seat, by their name (E35/F01/S02). */
  async openVendor(seat: Locator): Promise<void> {
    await seat.getByTestId('tables-seat-vendor').click();
  }

  /** Open a held seat's dialog, by its Change: its name opens the vendor's drawer (E35/F01/S02). */
  async change(seat: Locator): Promise<void> {
    await seat.getByTestId('tables-seat-change').click();
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
