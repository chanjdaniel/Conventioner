import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the ManageMarketOverlay reached from MarketsView.
 * Covers adding/removing/changing user roles, org management,
 * market rename, and deletion.
 */
export class ManageMarketPage {
  readonly page: Page;

  readonly overlayBackground: Locator;
  readonly roleSelects: Locator;
  readonly removeUserButtons: Locator;
  readonly addUserButton: Locator;
  readonly addUserInput: Locator;
  readonly addUserSelect: Locator;
  readonly addUserSubmit: Locator;
  readonly removeOrgButton: Locator;
  readonly addOrgButton: Locator;
  readonly addOrgSelect: Locator;
  readonly addOrgSubmit: Locator;
  readonly renameInput: Locator;
  readonly renameSaveButton: Locator;
  readonly deleteButton: Locator;
  readonly deleteConfirmButton: Locator;
  readonly deleteCancelButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.overlayBackground = page.getByTestId('manage-market-overlay-background');
    this.roleSelects = page.getByTestId('manage-market-role-select');
    this.removeUserButtons = page.getByTestId('manage-market-remove-user-button');
    this.addUserButton = page.getByTestId('manage-market-add-user-button');
    this.addUserInput = page.getByTestId('manage-market-add-user-input');
    this.addUserSelect = page.getByTestId('manage-market-add-user-select');
    this.addUserSubmit = page.getByTestId('manage-market-add-user-submit');
    this.removeOrgButton = page.getByTestId('manage-market-remove-org-button');
    this.addOrgButton = page.getByTestId('manage-market-add-org-button');
    this.addOrgSelect = page.getByTestId('manage-market-add-org-select');
    this.addOrgSubmit = page.getByTestId('manage-market-add-org-submit');
    this.renameInput = page.getByTestId('manage-market-rename-input');
    this.renameSaveButton = page.getByTestId('manage-market-rename-save-button');
    this.deleteButton = page.getByTestId('manage-market-delete-button');
    this.deleteConfirmButton = page.getByTestId('manage-market-delete-confirm-button');
    this.deleteCancelButton = page.getByTestId('manage-market-delete-cancel-button');
  }

  async waitForOverlay(): Promise<void> {
    await this.page.waitForSelector('.container .window', { timeout: 5000 });
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
