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
