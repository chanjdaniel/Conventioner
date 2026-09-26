import type { Locator, Page } from '@playwright/test';

/**
 * Page object for a market's Result page (E22/F04/S04): the summary strip over the tables grid.
 *
 * It replaced the Assignment tab's results, whose Vendors modal listed one row per applicant; the
 * grid itself is where a placement is read now, and `placementsFor` reads it there.
 */
export class ResultPage {
  readonly page: Page;
  readonly strip: Locator;
  readonly downloadCsvButton: Locator;
  readonly occupiedSeats: Locator;

  constructor(page: Page) {
    this.page = page;
    this.strip = page.getByTestId('result-strip');
    this.downloadCsvButton = page.getByTestId('result-download-csv-button');
    this.occupiedSeats = page.getByTestId('tables-seat-occupied');
  }

  async goto(marketId: string): Promise<void> {
    await this.page.goto(`/markets/${encodeURIComponent(marketId)}/result`);
  }

  /**
   * Where one applicant was placed: the table code of every seat they hold, one per market date
   * they were given a table on. Empty for an applicant the assignment left without a table.
   */
  async placementsFor(applicantEmail: string): Promise<string[]> {
    const seats = this.page.locator(
      `[data-testid="tables-seat-occupied"][data-vendor-email="${applicantEmail}"]`,
    );
    const codes: string[] = [];
    for (const seat of await seats.all()) {
      const code = await seat
        .locator('xpath=ancestor::*[@data-testid="tables-table-row"]')
        .getAttribute('data-table-code');
      if (code) codes.push(code);
    }
    return codes;
  }
}
