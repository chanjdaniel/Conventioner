import type { Locator, Page } from '@playwright/test';
import { ReviewerChooser } from './ReviewerChooser';

/**
 * Page object for the dialog the rail's "Open applications" opens on a market whose vendors apply
 * on its own page, for someone who may choose reviewers (E38/F07/S02): the reviewer picker, the
 * review setup it is about to open with its way back to Review setup (T206), and the confirm that
 * writes the reviewers and then opens applications.
 */
export class OpenApplicationsDialog {
  readonly page: Page;

  /** The rail's "Open applications", which opens the dialog. */
  readonly opener: Locator;
  readonly dialog: Locator;
  readonly confirm: Locator;
  readonly cancel: Locator;
  readonly error: Locator;
  /** The dialog's chooser of reviewers. */
  readonly chooser: ReviewerChooser;
  /** The review setup's two lines: what a reviewer reads first, and the automatic rejections. */
  readonly leads: Locator;
  readonly rejections: Locator;
  /** "Change", to Review setup. */
  readonly changeReviewSetup: Locator;

  constructor(page: Page) {
    this.page = page;
    this.opener = page.getByTestId('phase-transition-applications');
    this.dialog = page.getByTestId('open-applications-window');
    this.confirm = page.getByTestId('open-applications-submit-button');
    this.cancel = page.getByTestId('open-applications-cancel-button');
    this.error = page.getByTestId('open-applications-error');
    this.chooser = new ReviewerChooser(this.dialog);
    this.leads = this.dialog.getByTestId('open-applications-leads');
    this.rejections = this.dialog.getByTestId('open-applications-rejections');
    this.changeReviewSetup = this.dialog.getByTestId('open-applications-change-review-setup');
  }

  /** Press "Open applications" on the rail, and wait for the dialog. */
  async start(): Promise<void> {
    await this.opener.click();
    await this.dialog.waitFor();
  }

  /** Open applications with these reviewers chosen (none: first come, first served). */
  async openWith(...emails: string[]): Promise<void> {
    await this.start();
    await this.chooser.choose(...emails);
    await this.confirm.click();
    await this.dialog.waitFor({ state: 'hidden' });
  }
}
