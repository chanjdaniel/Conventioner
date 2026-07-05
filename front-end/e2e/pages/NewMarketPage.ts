import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the New Market overlay.
 * Covers CSV file upload, market name entry, and submission.
 */
export class NewMarketPage {
  readonly page: Page;

  readonly overlayBackground: Locator;
  readonly chooseFileButton: Locator;
  readonly nameInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.overlayBackground = page.getByTestId('new-market-overlay-background');
    this.chooseFileButton = page.getByTestId('file-drop-choose-button');
    this.nameInput = page.getByTestId('new-market-name-input');
    this.submitButton = page.getByTestId('new-market-submit-button');
  }

  /** Wait for the overlay to be visible. */
  async waitForOverlay(): Promise<void> {
    await this.chooseFileButton.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Upload a CSV file via the file chooser.
   * Uses Playwright's fileChooser event to handle the VueUse file dialog.
   */
  async uploadCsv(filePath: string): Promise<void> {
    const fileChooserPromise = this.page.waitForEvent('filechooser');
    await this.chooseFileButton.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);
  }

  /** Fill the market name input. */
  async fillMarketName(name: string): Promise<void> {
    await this.nameInput.waitFor({ state: 'visible', timeout: 10000 });
    await this.nameInput.fill(name);
  }

  /** Click the submit button to create the market. */
  async clickSubmit(): Promise<void> {
    await this.submitButton.click();
  }

  /** Wait for the name input to appear (indicating CSV was parsed). */
  async waitForNameInput(): Promise<void> {
    await this.nameInput.waitFor({ state: 'visible', timeout: 10000 });
  }

  /** Wait for navigation to the market setup wizard after submission. */
  async waitForSetupRedirect(): Promise<void> {
    await this.page.waitForURL('**/market-setup', { timeout: 15000 });
  }
}
