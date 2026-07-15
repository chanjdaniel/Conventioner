import type { Locator, Page } from '@playwright/test'

/**
 * Page object for the New Market overlay.
 * Covers organization selection, market name entry, and submission.
 */
export class NewMarketPage {
  readonly page: Page

  readonly overlayBackground: Locator
  readonly orgSelect: Locator
  readonly orgEmptyHint: Locator
  readonly orgCreateLink: Locator
  readonly nameInput: Locator
  readonly submitButton: Locator
  readonly errorMessage: Locator

  constructor(page: Page) {
    this.page = page

    this.overlayBackground = page.getByTestId('new-market-overlay-background')
    this.orgSelect = page.getByTestId('org-select-dropdown')
    this.orgEmptyHint = page.getByTestId('org-select-empty-hint')
    this.orgCreateLink = page.getByTestId('org-select-create-link')
    this.nameInput = page.getByTestId('new-market-name-input')
    this.submitButton = page.getByTestId('new-market-submit-button')
    this.errorMessage = page.locator('.error-message')
  }

  /** Wait for the overlay to be visible. */
  async waitForOverlay(): Promise<void> {
    await this.nameInput.waitFor({ state: 'visible', timeout: 5000 })
  }

  /** Fill the market name input. */
  async fillMarketName(name: string): Promise<void> {
    await this.nameInput.waitFor({ state: 'visible', timeout: 10000 })
    await this.nameInput.fill(name)
  }

  /** Click the submit button to create the market. */
  async clickSubmit(): Promise<void> {
    await this.submitButton.click()
  }

  /** Select an organization from the dropdown (first available option). */
  async selectFirstOrg(): Promise<void> {
    await this.orgSelect.waitFor({ state: 'visible', timeout: 5000 })
    await this.orgSelect.selectOption({ index: 1 })
  }

  /** Names of the organizations offered by the dropdown, excluding the placeholder. */
  async orgOptionLabels(): Promise<string[]> {
    await this.orgSelect.waitFor({ state: 'visible', timeout: 5000 })
    const labels = await this.orgSelect.locator('option:not([disabled])').allTextContents()
    return labels.map((label) => label.trim())
  }

  /** Wait for navigation to the market setup wizard after submission. */
  async waitForSetupRedirect(): Promise<void> {
    await this.page.waitForURL('**/market-setup', { timeout: 15000 })
  }
}
