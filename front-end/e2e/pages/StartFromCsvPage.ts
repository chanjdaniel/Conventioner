import { expect, type Locator, type Page } from '@playwright/test';

/** A question's answers on the proposal: the first 20, "Show all N", a find field past 12. */
class ProposalAnswers {
  readonly root: Locator;
  readonly find: Locator;
  readonly count: Locator;
  readonly more: Locator;
  readonly keepAll: Locator;
  readonly options: Locator;

  constructor(row: Locator) {
    this.root = row.getByTestId('proposal-row-list');
    this.find = row.getByTestId('proposal-row-list-find');
    this.count = row.getByTestId('proposal-row-list-count');
    this.more = row.getByTestId('proposal-row-list-more');
    this.keepAll = row.getByTestId('proposal-row-keep-all');
    this.options = row.getByTestId('proposal-option');
  }

  /** The row of the answer holding `words`. */
  option(words: string): Locator {
    return this.options.filter({ hasText: words });
  }
}

/**
 * Page object for starting a draft from a Google Form's responses (`/markets/:id/start-from-csv`).
 *
 * Upload a CSV, answer the year its dates are in, and read the proposal ledger. Nothing is written
 * until the organizer confirms, so everything short of that leaves the market as it was.
 */
export class StartFromCsvPage {
  readonly page: Page;
  readonly view: Locator;
  readonly title: Locator;
  readonly upload: Locator;
  readonly uploadHeading: Locator;
  /** What the file is read for, that no one is imported, and the intake's own way on (T205/F20). */
  readonly uploadHelp: Locator;
  readonly dropZone: Locator;
  readonly fileInput: Locator;
  readonly reading: Locator;
  readonly refused: Locator;
  readonly refusedHeading: Locator;
  readonly yearDialog: Locator;
  readonly yearInput: Locator;
  readonly yearConfirm: Locator;
  readonly yearWarning: Locator;
  readonly ledger: Locator;
  readonly rows: Locator;
  readonly checkedRows: Locator;
  readonly toCheck: Locator;
  readonly notAsked: Locator;
  readonly cancel: Locator;
  /** The proposal's "Create the form and plan". */
  readonly confirm: Locator;

  constructor(page: Page) {
    this.page = page;
    this.view = page.getByTestId('start-from-csv');
    this.title = page.getByTestId('start-from-csv-title');
    this.upload = page.getByTestId('start-from-csv-upload');
    this.uploadHeading = this.upload.getByRole('heading', { level: 2 });
    this.uploadHelp = page.getByTestId('start-from-csv-upload-help');
    this.dropZone = page.getByTestId('start-from-csv-drop-zone');
    this.fileInput = page.getByTestId('start-from-csv-file-input');
    this.reading = page.getByTestId('start-from-csv-reading');
    this.refused = page.getByTestId('start-from-csv-refused');
    this.refusedHeading = this.refused.getByRole('heading', { level: 2 });
    this.yearDialog = page.getByTestId('start-from-csv-year-dialog-window');
    this.yearInput = page.getByTestId('start-from-csv-year-input');
    this.yearConfirm = page.getByTestId('start-from-csv-year-dialog-submit-button');
    this.yearWarning = page.getByTestId('start-from-csv-year-warning');
    this.ledger = page.getByTestId('proposal-ledger');
    this.rows = page.getByTestId('proposal-row');
    this.checkedRows = page.locator('[data-testid="proposal-row"].checking');
    this.toCheck = page.getByTestId('proposal-to-check');
    this.notAsked = page.getByTestId('proposal-not-asked');
    this.cancel = page.getByTestId('proposal-cancel');
    this.confirm = page.getByTestId('proposal-confirm');
  }

  /** The ledger row whose column header starts with `header`. */
  row(header: string): Locator {
    const starts = new RegExp(`^\\s*${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    return this.rows.filter({
      has: this.page.getByTestId('proposal-row-header').filter({ hasText: starts }),
    });
  }

  answers(row: Locator): ProposalAnswers {
    return new ProposalAnswers(row);
  }

  async count(which: 'to-check' | 'custom' | 'left-out' | 'essential'): Promise<number> {
    const id = which === 'to-check' ? 'proposal-to-check' : `proposal-count-${which}`;
    return Number(await this.page.getByTestId(id).innerText());
  }

  async open(marketId: string) {
    await this.page.goto(`/markets/${marketId}/start-from-csv`);
    await expect(this.view).toBeVisible();
  }

  async chooseFile(path: string) {
    await this.fileInput.setInputFiles(path);
  }

  /** Confirm the year asked after upload: the one proposed, or `year` typed over it. */
  async answerYear(year?: number) {
    await expect(this.yearDialog).toBeVisible();
    if (year !== undefined) await this.yearInput.fill(String(year));
    await this.yearConfirm.click();
    await expect(this.yearDialog).toBeHidden();
  }
}
