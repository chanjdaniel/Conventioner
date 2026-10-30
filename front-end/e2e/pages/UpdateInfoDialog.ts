import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the Update info dialog (E41/F01/S01), opened from the vendor drawer: the vendor's
 * answers, each in its question's own control, with Save and Cancel; the essential questions below
 * them, as the form asks them (E41/F01/S02).
 */
export class UpdateInfoDialog {
  readonly page: Page;

  readonly openButton: Locator;
  readonly window: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;
  readonly essentials: Locator;
  readonly essentialsNote: Locator;

  constructor(page: Page) {
    this.page = page;
    this.openButton = page.getByTestId('vendors-detail-update-info');
    this.window = page.getByTestId('update-info-window');
    this.saveButton = page.getByTestId('update-info-submit-button');
    this.cancelButton = page.getByTestId('update-info-cancel-button');
    this.essentials = page.getByTestId('update-info-essentials');
    this.essentialsNote = page.getByTestId('update-info-essentials-note');
  }

  async open(): Promise<void> {
    await this.openButton.click();
    await this.window.waitFor();
  }

  /** The question's own control: a text box, a select, ... */
  input(key: string): Locator {
    return this.page.getByTestId(`update-info-input-${key}`);
  }

  /** An essential question's control, by the form's own name for it: `tier-2099-08-01-Gold`. */
  essential(name: string): Locator {
    return this.page.getByTestId(`update-info-essential-${name}`);
  }

  /** What the vendor wrote, beside an answer that differs from it. */
  theirs(key: string): Locator {
    return this.page.getByTestId(`update-info-theirs-${key}`);
  }

  async useTheirs(key: string): Promise<void> {
    await this.page.getByTestId(`update-info-use-theirs-${key}`).click();
  }

  async save(): Promise<void> {
    await this.saveButton.click();
    await this.window.waitFor({ state: 'detached' });
  }
}
