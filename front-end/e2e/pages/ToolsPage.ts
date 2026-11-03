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
  readonly roleSelect: Locator;
  readonly inviteInput: Locator;
  readonly inviteError: Locator;
  readonly roleWarning: Locator;
  readonly questionSelect: Locator;
  readonly giving: Locator;
  readonly givingNeedsRole: Locator;
  readonly givingNeedsQuestion: Locator;
  readonly givingNeedsAssignment: Locator;
  readonly givingVendors: Locator;

  constructor(page: Page) {
    this.page = page;
    this.tools = page.getByTestId('market-tools');
    this.discordCard = page.getByTestId('plan-card-discord');
    this.serverName = page.getByTestId('discord-server-name');
    this.roleValue = page.getByTestId('discord-role-value');
    this.questionValue = page.getByTestId('discord-question-value');
    this.inviteValue = page.getByTestId('discord-invite-value');
    this.roleSelect = page.getByTestId('discord-role-select');
    this.inviteInput = page.getByTestId('discord-invite-input');
    this.inviteError = page.getByTestId('discord-invite-error');
    this.roleWarning = page.getByTestId('discord-role-warning');
    this.questionSelect = page.getByTestId('discord-question-select');
    this.giving = page.getByTestId('discord-giving');
    this.givingNeedsRole = page.getByTestId('discord-giving-needs-role');
    this.givingNeedsQuestion = page.getByTestId('discord-giving-needs-question');
    this.givingNeedsAssignment = page.getByTestId('discord-giving-needs-assignment');
    this.givingVendors = page.getByTestId('discord-giving-vendors');
  }

  async goto(marketId: string): Promise<void> {
    await this.page.goto(marketScreenPath(marketId, 'tools'));
  }

  /** The server's role, once the card has read the server's roles. */
  roleOption(roleId: string): Locator {
    return this.roleSelect.locator(`option[value="${roleId}"]`);
  }

  /** Write in "Invite link" and leave the field, which saves it, until the server has answered. */
  async leaveInviteLink(text: string): Promise<void> {
    const answered = this.page.waitForResponse(
      (response) => response.request().method() === 'PUT' && response.url().endsWith('/discord'),
    );
    await this.inviteInput.fill(text);
    await this.inviteInput.blur();
    await answered;
  }
}
