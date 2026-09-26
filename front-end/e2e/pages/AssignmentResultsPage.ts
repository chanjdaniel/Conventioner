import type { Locator, Page } from '@playwright/test';
import { marketSetupPath } from '../helpers/marketScreens';

/**
 * Page object for the market's Assignment tab and the results it shows.
 * Covers action buttons (Back, Download CSV, Done)
 * and the quick-nav buttons (Vendors, Tables, Attendance).
 */
export class AssignmentResultsPage {
  readonly page: Page;

  // Action buttons
  readonly downloadCsvButton: Locator;

  // Quick nav buttons
  readonly viewVendorsButton: Locator;
  readonly viewTablesButton: Locator;
  readonly viewAttendanceButton: Locator;

  // Summary stats
  readonly summaryStats: Locator;

  // The Vendors modal this view opens: one row per applicant, one cell per market date
  readonly vendorRows: Locator;

  constructor(page: Page) {
    this.page = page;

    this.downloadCsvButton = page.getByTestId('assignment-results-download-csv-button');

    this.viewVendorsButton = page.getByTestId('assignment-results-view-vendors-button');
    this.viewTablesButton = page.getByTestId('assignment-results-view-tables-button');
    this.viewAttendanceButton = page.getByTestId('assignment-results-view-attendance-button');

    this.summaryStats = page.locator('.summary-card');

    this.vendorRows = page.getByTestId('vendors-modal-row');
  }

  /** The Vendors-modal row for one applicant, found by the address they applied with. */
  vendorRow(applicantEmail: string): Locator {
    return this.vendorRows.filter({ hasText: applicantEmail });
  }

  /**
   * Where one applicant was placed, one entry per market date they were given a table on.
   *
   * The modal lists every applicant, placed or not, with an empty cell per date they hold no
   * table on. Those empty cells are dropped here, so the result reads as "what they got".
   */
  async placementsFor(applicantEmail: string): Promise<string[]> {
    const cells = await this.vendorRow(applicantEmail)
      .getByTestId('vendors-modal-cell')
      .allTextContents();
    // The first two cells are the vendor's name and address (E13/F02/S01) and the last is cost;
    // the dates are the ones between.
    return cells
      .slice(2, -1)
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);
  }

  /** The results are a tab on the market, not a route of their own (E10/F03/S01). */
  async goto(marketId: string): Promise<void> {
    await this.page.goto(marketSetupPath(marketId, 'assignment'));
  }

  async clickDownloadCsv(): Promise<void> {
    await this.downloadCsvButton.click();
  }

  async clickViewVendors(): Promise<void> {
    await this.viewVendorsButton.click();
  }

  async clickViewTables(): Promise<void> {
    await this.viewTablesButton.click();
  }

  async clickViewAttendance(): Promise<void> {
    await this.viewAttendanceButton.click();
  }

  async isDownloadEnabled(): Promise<boolean> {
    return await this.downloadCsvButton.isEnabled();
  }
}
