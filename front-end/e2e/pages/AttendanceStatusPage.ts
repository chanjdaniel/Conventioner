import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the owner-facing attendance status view
 * (/markets/:marketId/attendance).
 */
export class AttendanceStatusPage {
  readonly page: Page;

  readonly backButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.backButton = page.getByTestId('attendance-status-back-button');
  }

  async goto(marketId: string): Promise<void> {
    await this.page.goto(`/markets/${marketId}/attendance`);
  }

  async clickBack(): Promise<void> {
    await this.backButton.click();
  }

  /**
   * Return all td cells in the vendor row matching the given email.
   */
  getVendorRowCells(vendorEmail: string): Locator {
    return this.page
      .locator('.attendance-table tbody tr')
      .filter({ has: this.page.locator('.vendor-cell', { hasText: vendorEmail }) })
      .locator('td');
  }
}
