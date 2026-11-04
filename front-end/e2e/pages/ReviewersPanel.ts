import type { Locator, Page } from '@playwright/test';
import { ReviewerChooser } from './ReviewerChooser';

/**
 * Page object for the Reviewers panel on the Applications tab (E38/F07/S02): who reviews the
 * market's applications, said in one line, the dialog that chooses them, and the read-only list of
 * them for someone who may not choose.
 */
export class ReviewersPanel {
  readonly page: Page;

  readonly panel: Locator;
  /** "12 reviewers: a, b, c and 9 more reviewers", the last word for a reader who hears it. */
  readonly line: Locator;
  /** "and 9 more", past the three the line names. */
  readonly more: Locator;
  readonly none: Locator;
  /** The mark beside a reviewer who no longer holds a role on the market, in the line or the list. */
  readonly unable: Locator;
  /** How many more of them the line has folded. */
  readonly unableFolded: Locator;
  /** "Choose reviewers", or "Change reviewers" once some are chosen. */
  readonly change: Locator;
  readonly dialog: Locator;
  /** The dialog's chooser of reviewers. */
  readonly chooser: ReviewerChooser;
  readonly save: Locator;
  readonly error: Locator;
  /** The read-only "Reviewers" dialog. */
  readonly all: Locator;
  readonly allPeople: Locator;
  readonly allClose: Locator;

  constructor(page: Page) {
    this.page = page;
    this.panel = page.getByTestId('reviewers');
    this.line = page.getByTestId('reviewers-line');
    this.more = page.getByTestId('reviewers-line-more');
    this.none = page.getByTestId('reviewers-none');
    this.unable = page.getByTestId('reviewers-unable');
    this.unableFolded = page.getByTestId('reviewers-unable-more');
    this.change = page.getByTestId('reviewers-change');
    this.dialog = page.getByTestId('reviewers-dialog-window');
    this.chooser = new ReviewerChooser(this.dialog);
    this.save = page.getByTestId('reviewers-dialog-submit-button');
    this.error = page.getByTestId('reviewers-dialog-error');
    this.all = page.getByTestId('reviewers-all-window');
    this.allPeople = this.all.getByTestId('reviewers-person');
    this.allClose = page.getByTestId('reviewers-all-close-button');
  }

  /** Open the dialog and choose these addresses, beside whoever is chosen already. */
  async choose(...emails: string[]): Promise<void> {
    await this.change.click();
    await this.dialog.waitFor();
    await this.chooser.choose(...emails);
  }

  /** Open the dialog and take these addresses off, leaving whoever else is chosen. */
  async takeOff(...emails: string[]): Promise<void> {
    await this.change.click();
    await this.dialog.waitFor();
    await this.chooser.remove(...emails);
  }

  /** Save the dialog's choice, and wait for it to close on the save landing. */
  async submit(): Promise<void> {
    await this.save.click();
    await this.dialog.waitFor({ state: 'hidden' });
  }
}
