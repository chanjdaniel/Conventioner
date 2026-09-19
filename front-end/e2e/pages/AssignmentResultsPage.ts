import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the Assignment Results / Generate Assignment view.
 * Covers action buttons (Back, Download CSV, Send to Discord, Done)
 * and the quick-nav buttons (Vendors, Tables, Attendance).
 */
export class AssignmentResultsPage {
  readonly page: Page;

  // Action buttons
  readonly backButton: Locator;
  readonly downloadCsvButton: Locator;
  readonly sendToDiscordButton: Locator;
  readonly doneButton: Locator;

  // Quick nav buttons
  readonly viewVendorsButton: Locator;
  readonly viewTablesButton: Locator;
  readonly viewAttendanceButton: Locator;

  // Summary stats
  readonly summaryStats: Locator;

  // Discord feedback messages
  readonly discordError: Locator;
  readonly discordToast: Locator;

  // The Vendors modal this view opens: one row per applicant, one cell per market date
  readonly vendorRows: Locator;

  constructor(page: Page) {
    this.page = page;

    this.backButton = page.getByTestId('assignment-results-back-button');
    this.downloadCsvButton = page.getByTestId('assignment-results-download-csv-button');
    this.sendToDiscordButton = page.getByTestId('assignment-results-send-discord-button');
    this.doneButton = page.getByTestId('assignment-results-done-button');

    this.viewVendorsButton = page.getByTestId('assignment-results-view-vendors-button');
    this.viewTablesButton = page.getByTestId('assignment-results-view-tables-button');
    this.viewAttendanceButton = page.getByTestId('assignment-results-view-attendance-button');

    this.summaryStats = page.locator('.summary-card');

    this.discordError = page.getByTestId('assignment-results-discord-error');
    this.discordToast = page.getByTestId('assignment-results-discord-toast');

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

  async goto(): Promise<void> {
    await this.page.goto('/assignment-results');
  }

  async clickBack(): Promise<void> {
    await this.backButton.click();
  }

  async clickDownloadCsv(): Promise<void> {
    await this.downloadCsvButton.click();
  }

  async clickSendToDiscord(): Promise<void> {
    await this.sendToDiscordButton.click();
  }

  async clickDone(): Promise<void> {
    await this.doneButton.click();
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

  async isSendToDiscordEnabled(): Promise<boolean> {
    return await this.sendToDiscordButton.isEnabled();
  }
}
