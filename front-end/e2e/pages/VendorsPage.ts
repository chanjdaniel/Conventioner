import type { Locator, Page } from '@playwright/test';
import { marketScreenPath } from '../helpers/marketScreens';

/**
 * Page object for the vendor browsing view (`/markets/:marketId/vendors`).
 */
export class VendorsPage {
  readonly page: Page;

  readonly searchInput: Locator;
  readonly vendorListItems: Locator;
  readonly backButton: Locator;
  readonly detailCloseButton: Locator;
  readonly detailPanel: Locator;
  readonly detailOverlay: Locator;
  readonly detailAssignmentItems: Locator;

  constructor(page: Page) {
    this.page = page;

    this.searchInput = page.getByTestId('vendors-search-input');
    this.vendorListItems = page.getByTestId('vendors-list-item');
    this.backButton = page.getByTestId('vendors-back-button');
    this.detailCloseButton = page.getByTestId('vendors-detail-close');
    this.detailPanel = page.getByTestId('vendors-detail-panel');
    /** The scrim. Clicking it dismisses the drawer, and it is what holds the mouse out. */
    this.detailOverlay = page.getByTestId('vendors-detail-overlay');
    this.detailAssignmentItems = page.getByTestId('vendors-detail-assignment-item');
  }

  async goto(marketId: string): Promise<void> {
    await this.page.goto(marketScreenPath(marketId, 'vendors'));
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
