import { marketScreenPath } from '../helpers/marketScreens';
import type { Locator, Page } from '@playwright/test';

/**
 * Page object for a market's Tools tab (/markets/:marketId/tools): the manual tools an organizer
 * runs in any phase, Discord's card first (E46/F01/S02).
 */
export class ToolsPage {
  readonly page: Page;
  readonly tools: Locator;
  readonly discordCard: Locator;
  readonly serverName: Locator;
  readonly roleValue: Locator;
  readonly questionValue: Locator;
  readonly inviteValue: Locator;

  constructor(page: Page) {
    this.page = page;
    this.tools = page.getByTestId('market-tools');
    this.discordCard = page.getByTestId('plan-card-discord');
    this.serverName = page.getByTestId('discord-server-name');
    this.roleValue = page.getByTestId('discord-role-value');
    this.questionValue = page.getByTestId('discord-question-value');
    this.inviteValue = page.getByTestId('discord-invite-value');
  }

  async goto(marketId: string): Promise<void> {
    await this.page.goto(marketScreenPath(marketId, 'tools'));
  }
}
