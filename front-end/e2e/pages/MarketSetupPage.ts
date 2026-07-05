import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the Market Setup wizard view.
 * Covers wizard step navigation (Back/Next/Assign) and the Discord webhook input.
 */
export class MarketSetupPage {
  readonly page: Page;

  // Wizard navigation
  readonly backButton: Locator;
  readonly nextButton: Locator;
  readonly assignButton: Locator;

  // Discord webhook
  readonly discordWebhookInput: Locator;

  constructor(page: Page) {
    this.page = page;

    this.backButton = page.getByTestId('market-setup-back-button');
    this.nextButton = page.getByTestId('market-setup-next-button');
    this.assignButton = page.getByTestId('market-setup-assign-button');

    this.discordWebhookInput = page.getByTestId('market-setup-discord-webhook-input');
  }

  async goto(): Promise<void> {
    await this.page.goto('/market-setup');
  }

  async clickNext(): Promise<void> {
    await this.nextButton.click();
  }

  async clickBack(): Promise<void> {
    await this.backButton.click();
  }

  async clickAssign(): Promise<void> {
    await this.assignButton.click();
  }

  async isAssignEnabled(): Promise<boolean> {
    return await this.assignButton.isEnabled();
  }

  async fillDiscordWebhook(url: string): Promise<void> {
    await this.discordWebhookInput.fill(url);
  }
}
