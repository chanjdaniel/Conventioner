import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the ManageMarketOverlay reached from MarketsView.
 * Covers adding/removing/changing user roles, org management,
 * market rename, deletion, and who may do what.
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
  readonly permissions: Locator;
  readonly permissionsToggle: Locator;
  readonly permissionsSummary: Locator;
  readonly permissionsReadOnly: Locator;
  readonly permissionSelects: Locator;
  readonly permissionSources: Locator;
  readonly permissionChanges: Locator;
  readonly permissionsReset: Locator;
  readonly permissionConfirm: Locator;
  readonly resetConfirm: Locator;

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
    // Who may do what (E39/F01/S04): closed until its toggle opens it.
    this.permissions = page.getByTestId('manage-market-permissions');
    this.permissionsToggle = page.getByTestId('manage-market-permissions-toggle');
    this.permissionsSummary = page.getByTestId('manage-market-permissions-summary');
    this.permissionsReadOnly = page.getByTestId('manage-market-permissions-read-only');
    this.permissionSelects = page.getByTestId('manage-market-permission-select');
    this.permissionSources = page.getByTestId('manage-market-permission-source');
    this.permissionChanges = page.getByTestId('manage-market-permission-change');
    this.permissionsReset = page.getByTestId('manage-market-permissions-reset');
    // Each its own dialog, a sibling of Manage market.
    this.permissionConfirm = page.getByTestId('manage-market-permission-confirm-window');
    this.resetConfirm = page.getByTestId('manage-market-permissions-reset-confirm-window');
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

  // ── Permissions ──

  async showPermissions(): Promise<void> {
    await this.permissionsToggle.click();
  }

  /** One row of the table, by its action id: `check-in`. */
  permissionRow(actionId: string): Locator {
    return this.page.getByTestId(`manage-market-permission-row-${actionId}`);
  }

  permissionSelect(actionId: string): Locator {
    return this.permissionRow(actionId).getByTestId('manage-market-permission-select');
  }

  permissionRole(actionId: string): Locator {
    return this.permissionRow(actionId).getByTestId('manage-market-permission-role');
  }

  permissionSource(actionId: string): Locator {
    return this.permissionRow(actionId).getByTestId('manage-market-permission-source');
  }

  /** Chooses a role for a row, from the focused select as a person does, which opens its confirmation. */
  async choosePermission(actionId: string, role: string): Promise<void> {
    await this.permissionSelect(actionId).focus();
    await this.permissionSelect(actionId).selectOption(role);
  }

  async confirmPermission(): Promise<void> {
    await this.page.getByTestId('manage-market-permission-confirm-submit-button').click();
  }

  async cancelPermission(): Promise<void> {
    await this.page.getByTestId('manage-market-permission-confirm-cancel-button').click();
  }

  async resetPermissions(): Promise<void> {
    await this.permissionsReset.click();
  }

  async confirmReset(): Promise<void> {
    await this.page.getByTestId('manage-market-permissions-reset-confirm-submit-button').click();
  }

  // ── Change role ──

  async selectRoleForFirstUser(role: string): Promise<void> {
    await this.roleSelects.first().selectOption(role);
  }
}
