import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the dialog the rail's "Open Applications" opens on a market whose vendors apply
 * on its own page, for someone who may choose reviewers (E38/F07/S02): the reviewer picker, and the
 * confirm that writes the reviewers and then opens applications.
 */
export class OpenApplicationsDialog {
  readonly page: Page;

  /** The rail's "Open Applications", which opens the dialog. */
  readonly opener: Locator;
  readonly dialog: Locator;
  readonly confirm: Locator;
  readonly cancel: Locator;
  readonly error: Locator;

  constructor(page: Page) {
    this.page = page;
    this.opener = page.getByTestId('phase-transition-applications');
    this.dialog = page.getByTestId('open-applications-window');
    this.confirm = page.getByTestId('open-applications-submit-button');
    this.cancel = page.getByTestId('open-applications-cancel-button');
    this.error = page.getByTestId('open-applications-error');
  }

  /** The picker's checkbox for one address. */
  choice(email: string): Locator {
    return this.dialog.getByTestId(`reviewer-picker-${email}`);
  }

  /** Press "Open Applications" on the rail, and wait for the dialog. */
  async start(): Promise<void> {
    await this.opener.click();
    await this.dialog.waitFor();
  }

  /** Open applications with these reviewers ticked (none: first come, first served). */
  async openWith(...emails: string[]): Promise<void> {
    await this.start();
    for (const email of emails) await this.choice(email).check();
    await this.confirm.click();
    await this.dialog.waitFor({ state: 'hidden' });
  }
}
