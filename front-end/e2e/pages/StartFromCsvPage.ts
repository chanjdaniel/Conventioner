import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page object for starting a draft from a Google Form's responses (`/markets/:id/start-from-csv`).
 *
 * Upload a CSV, answer the year its dates are in, and read the proposal ledger. Nothing is written
 * until the organizer confirms, so everything short of that leaves the market as it was.
 */
export class StartFromCsvPage {
  readonly page: Page;
  readonly view: Locator;
  readonly upload: Locator;
  readonly fileInput: Locator;
  readonly refused: Locator;
  readonly yearDialog: Locator;
  readonly yearInput: Locator;
  readonly yearConfirm: Locator;
  readonly yearWarning: Locator;
  readonly ledger: Locator;
  readonly rows: Locator;
  readonly checkedRows: Locator;
  readonly toCheck: Locator;
  readonly cancel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.view = page.getByTestId('start-from-csv');
    this.upload = page.getByTestId('start-from-csv-upload');
    this.fileInput = page.getByTestId('start-from-csv-file-input');
    this.refused = page.getByTestId('start-from-csv-refused');
    this.yearDialog = page.getByTestId('start-from-csv-year-dialog-window');
    this.yearInput = page.getByTestId('start-from-csv-year-input');
    this.yearConfirm = page.getByTestId('start-from-csv-year-dialog-submit-button');
    this.yearWarning = page.getByTestId('start-from-csv-year-warning');
    this.ledger = page.getByTestId('proposal-ledger');
    this.rows = page.getByTestId('proposal-row');
    this.checkedRows = page.locator('[data-testid="proposal-row"].checking');
    this.toCheck = page.getByTestId('proposal-to-check');
    this.cancel = page.getByTestId('proposal-cancel');
  }

  async open(marketId: string) {
    await this.page.goto(`/markets/${marketId}/start-from-csv`);
    await expect(this.view).toBeVisible();
  }

  async chooseFile(path: string) {
    await this.fileInput.setInputFiles(path);
  }

  async answerYear() {
    await expect(this.yearDialog).toBeVisible();
    await this.yearConfirm.click();
    await expect(this.yearDialog).toBeHidden();
  }
}
