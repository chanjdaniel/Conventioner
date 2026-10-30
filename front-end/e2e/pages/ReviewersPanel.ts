import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the Reviewers panel on the Applications tab (E38/F07/S02): who reviews the
 * market's applications, and its dialog that chooses them.
 */
export class ReviewersPanel {
  readonly page: Page;

  readonly panel: Locator;
  readonly people: Locator;
  readonly none: Locator;
  /** The mark beside a reviewer who no longer holds a role on the market. */
  readonly unable: Locator;
  /** "Choose reviewers", or "Change reviewers" once some are chosen. */
  readonly change: Locator;
  readonly dialog: Locator;
  readonly save: Locator;
  readonly error: Locator;

  constructor(page: Page) {
    this.page = page;
    this.panel = page.getByTestId('reviewers');
    this.people = page.getByTestId('reviewers-person');
    this.none = page.getByTestId('reviewers-none');
    this.unable = page.getByTestId('reviewers-unable');
    this.change = page.getByTestId('reviewers-change');
    this.dialog = page.getByTestId('reviewers-dialog-window');
    this.save = page.getByTestId('reviewers-dialog-submit-button');
    this.error = page.getByTestId('reviewers-dialog-error');
  }

  /** The picker's checkbox for one address. */
  choice(email: string): Locator {
    return this.dialog.getByTestId(`reviewer-picker-${email}`);
  }

  /** Open the dialog and tick these addresses, beside whoever is ticked already. */
  async tick(...emails: string[]): Promise<void> {
    await this.change.click();
    await this.dialog.waitFor();
    for (const email of emails) await this.choice(email).check();
  }

  /** Open the dialog and untick these addresses, leaving whoever else is ticked. */
  async untick(...emails: string[]): Promise<void> {
    await this.change.click();
    await this.dialog.waitFor();
    for (const email of emails) await this.choice(email).uncheck();
  }

  /** Save the dialog's choice, and wait for it to close on the save landing. */
  async submit(): Promise<void> {
    await this.save.click();
    await this.dialog.waitFor({ state: 'hidden' });
  }
}
