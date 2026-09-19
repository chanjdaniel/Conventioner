import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the public vendor check-in view (/:marketSlug/check-in).
 */
export class CheckinPage {
  readonly page: Page;

  readonly marketName: Locator;
  readonly emailInput: Locator;
  readonly lookupButton: Locator;
  readonly checkinButtons: Locator;
  readonly confirmationPills: Locator;
  readonly undoButtons: Locator;

  constructor(page: Page) {
    this.page = page;

    this.marketName = page.getByTestId('attendance-checkin-market-name');
    this.emailInput = page.getByTestId('attendance-checkin-email-input');
    this.lookupButton = page.getByTestId('attendance-checkin-lookup-button');
    this.checkinButtons = page.getByTestId('attendance-checkin-checkin-button');
    this.confirmationPills = page.getByTestId('attendance-checkin-confirmation-pill');
    this.undoButtons = page.getByTestId('attendance-checkin-undo-button');
  }

  async goto(marketSlug: string): Promise<void> {
    await this.page.goto(`/${marketSlug}/check-in`);
  }

  async fillEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
  }

  async clickLookup(): Promise<void> {
    await this.lookupButton.click();
  }

  async clickCheckIn(): Promise<void> {
    await this.checkinButtons.first().click();
  }

  async clickUndo(): Promise<void> {
    await this.undoButtons.first().click();
  }
}
