import type { Locator, Page } from '@playwright/test';
import { MARKET_SETUP_URL } from '../helpers/marketScreens';

/**
 * Page object for the New Market dialog.
 *
 * Built on `AppDialog` (E20/F01/S01), so its scrim, window, close and submit ids are the shell's,
 * derived from the `new-market` prefix - not hand-rolled per overlay as they were.
 */
export class NewMarketPage {
  readonly page: Page;

  readonly overlayBackground: Locator;
  readonly orgSelect: Locator;
  readonly orgEmptyHint: Locator;
  readonly orgCreateLink: Locator;
  readonly nameInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;
  readonly closeButton: Locator;
  readonly cancelButton: Locator;
  readonly orgOnly: Locator;

  constructor(page: Page) {
    this.page = page;

    this.overlayBackground = page.getByTestId('new-market-background');
    this.orgSelect = page.getByTestId('org-select-dropdown');
    this.orgEmptyHint = page.getByTestId('org-select-empty-hint');
    this.orgCreateLink = page.getByTestId('org-select-create-link');
    this.nameInput = page.getByTestId('new-market-name-input');
    this.submitButton = page.getByTestId('new-market-submit-button');
    this.errorMessage = page.getByTestId('new-market-error');
    this.closeButton = page.getByTestId('new-market-close-button');
    this.cancelButton = page.getByTestId('new-market-cancel-button');
    this.orgOnly = page.getByTestId('org-select-only');
  }

  /** Wait for the overlay to be visible. */
  async waitForOverlay(): Promise<void> {
    await this.nameInput.waitFor({ state: 'visible', timeout: 5000 });
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

  /** Select an organization from the dropdown (first available option). */
  async selectFirstOrg(): Promise<void> {
    await this.orgSelect.waitFor({ state: 'visible', timeout: 5000 });
    await this.orgSelect.selectOption({ index: 1 });
  }

  /** Names of the organizations offered by the dropdown, excluding the placeholder. */
  async orgOptionLabels(): Promise<string[]> {
    await this.orgSelect.waitFor({ state: 'visible', timeout: 5000 });
    const labels = await this.orgSelect.locator('option:not([disabled])').allTextContents();
    return labels.map((label) => label.trim());
  }

  /**
   * Wait for navigation to the new market's setup screen, and return the market's id - which the
   * URL now carries, since every market screen is addressed by id (E21/F02/S02).
   */
  async waitForSetupRedirect(): Promise<string> {
    await this.page.waitForURL(MARKET_SETUP_URL, { timeout: 15000 });
    const match = new URL(this.page.url()).pathname.match(/^\/markets\/([^/]+)\/setup$/);
    if (!match) throw new Error(`not on a market's setup screen: ${this.page.url()}`);
    return decodeURIComponent(match[1]);
  }
}
