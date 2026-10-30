import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the ManageMarketOverlay reached from MarketsView.
 * Covers adding/removing/changing user roles, org management,
 * market rename, the market's history, and deletion.
 */
export class ManageMarketPage {
  readonly page: Page;

  readonly overlayBackground: Locator;
  readonly window: Locator;
  readonly roleSelects: Locator;
  readonly removeUserButtons: Locator;
  readonly addUserButton: Locator;
  readonly addUserInput: Locator;
  readonly addUserSelect: Locator;
  readonly addUserSubmit: Locator;
  readonly renameInput: Locator;
  readonly renameSaveButton: Locator;
  readonly deleteButton: Locator;
  readonly deleteConfirmButton: Locator;
  readonly deleteCancelButton: Locator;
  readonly history: Locator;
  readonly historyToggle: Locator;
  readonly historyEntries: Locator;
  readonly historySentences: Locator;
  readonly historyVendorLinks: Locator;
  readonly historyWho: Locator;
  readonly historyKind: Locator;
  readonly historyVendor: Locator;
  readonly historyLoadMore: Locator;

  constructor(page: Page) {
    this.page = page;

    this.overlayBackground = page.getByTestId('manage-market-background');
    this.window = page.getByTestId('manage-market-window');
    this.roleSelects = page.getByTestId('manage-market-role-select');
    this.removeUserButtons = page.getByTestId('manage-market-remove-user-button');
    this.addUserButton = page.getByTestId('manage-market-add-user-button');
    this.addUserInput = page.getByTestId('manage-market-add-user-input');
    this.addUserSelect = page.getByTestId('manage-market-add-user-select');
    this.addUserSubmit = page.getByTestId('manage-market-add-user-submit');
    this.renameInput = page.getByTestId('manage-market-rename-input');
    this.renameSaveButton = page.getByTestId('manage-market-rename-save-button');
    this.deleteButton = page.getByTestId('manage-market-delete-button');
    // Its own destructive dialog (bug 43), so its buttons are that dialog's.
    this.deleteConfirmButton = page.getByTestId('manage-market-delete-submit-button');
    this.deleteCancelButton = page.getByTestId('manage-market-delete-cancel-button');
    this.history = page.getByTestId('manage-market-history');
    this.historyToggle = page.getByTestId('manage-market-history-toggle');
    this.historyEntries = page.getByTestId('market-history-entry');
    this.historySentences = page.getByTestId('market-history-sentence');
    this.historyVendorLinks = page.getByTestId('market-history-vendor-link');
    this.historyWho = page.getByTestId('market-history-who');
    this.historyKind = page.getByTestId('market-history-kind');
    this.historyVendor = page.getByTestId('market-history-vendor');
    this.historyLoadMore = page.getByTestId('market-history-load-more');
  }

  /** Opens the History section, closed until opened, and waits for its first page. */
  async openHistory(): Promise<void> {
    await this.historyToggle.click();
    await this.page.getByTestId('market-history').waitFor();
  }

  /** Opens one change of the History section to its before and after, and answers that table. */
  async openHistoryEntry(index: number): Promise<Locator> {
    const entry = this.historyEntries.nth(index);
    await entry.getByTestId('market-history-toggle').click();
    return entry.getByTestId('market-history-changes');
  }

  async waitForOverlay(): Promise<void> {
    await this.window.waitFor({ state: 'visible', timeout: 5000 });
  }

  // ── Add user with role ──

  async clickAddUser(): Promise<void> {
    await this.addUserButton.click();
  }

  async fillAddUserEmail(email: string): Promise<void> {
    await this.addUserInput.fill(email);
  }

  async selectAddUserRole(role: string): Promise<void> {
    await this.addUserSelect.selectOption(role);
  }

  async submitAddUser(): Promise<void> {
    await this.addUserSubmit.click();
  }

  async addUser(email: string, role: string): Promise<void> {
    await this.clickAddUser();
    await this.fillAddUserEmail(email);
    await this.selectAddUserRole(role);
    await this.submitAddUser();
  }

  // ── Remove user ──

  async removeFirstUser(): Promise<void> {
    await this.removeUserButtons.first().click();
  }

  // ── Change role ──

  async selectRoleForFirstUser(role: string): Promise<void> {
    await this.roleSelects.first().selectOption(role);
  }
}
