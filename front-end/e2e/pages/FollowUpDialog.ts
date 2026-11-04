import type { Locator, Page } from '@playwright/test';
import { PersonChooser } from './PersonChooser';

/**
 * Page object for the dialog that marks an application as needing a follow-up (E34/F02/S01),
 * opened from One by one's card or the All view's drawer: who will follow up, and the vendor's
 * notes box, offered only to someone who may write them (E38/F07/S03).
 */
export class FollowUpDialog {
  readonly page: Page;

  readonly dialog: Locator;
  /** "Who will follow up": the reviewer, unless they choose someone else on the market. */
  readonly chooser: PersonChooser;
  /** The chooser's field, which names who will follow up. */
  readonly owner: Locator;
  /** "Their notes: what is needed", absent for someone who may not write vendor notes. */
  readonly note: Locator;
  readonly submit: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dialog = page.getByTestId('follow-up-window');
    this.chooser = new PersonChooser(page, 'follow-up-owner');
    this.owner = this.chooser.field;
    this.note = page.getByTestId('follow-up-note');
    this.submit = page.getByTestId('follow-up-submit-button');
  }

  /** Mark it, and wait for the dialog to close on the write landing. */
  async confirm(): Promise<void> {
    await this.submit.click();
    await this.dialog.waitFor({ state: 'hidden' });
  }
}
