import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the vendor browsing view (/vendors).
 */
export class VendorsPage {
  readonly page: Page;

  readonly searchInput: Locator;
  readonly vendorListItems: Locator;
  readonly backButton: Locator;
  readonly detailCloseButton: Locator;
  readonly detailAssignmentItems: Locator;

  constructor(page: Page) {
    this.page = page;

    this.searchInput = page.getByTestId('vendors-search-input');
    this.vendorListItems = page.getByTestId('vendors-list-item');
    this.backButton = page.getByTestId('vendors-back-button');
    this.detailCloseButton = page.getByTestId('vendors-detail-close');
    this.detailAssignmentItems = page.locator('.assignment-item');
  }

  async goto(): Promise<void> {
    await this.page.goto('/vendors');
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
  }

  async clickVendor(index: number): Promise<void> {
    await this.vendorListItems.nth(index).click();
  }

  async closeDetail(): Promise<void> {
    await this.detailCloseButton.click();
  }

  async clickBack(): Promise<void> {
    await this.backButton.click();
  }
}
