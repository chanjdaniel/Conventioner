import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the ManageMarketOverlay reached from MarketsView.
 * Covers adding/removing/changing user roles, org management,
 * market rename, deletion, who may do what, and the market's history.
 */
export class ManageMarketPage {
  readonly page: Page;

  readonly overlayBackground: Locator;
  readonly window: Locator;
  /** What Manage market says of a request that failed, under its title. */
  readonly error: Locator;
  readonly roleSelects: Locator;
  readonly removeUserButtons: Locator;
  readonly people: Locator;
  readonly peopleFind: Locator;
  readonly peopleCount: Locator;
  readonly peopleRows: Locator;
  readonly peopleMore: Locator;
  readonly removeConfirm: Locator;
  readonly removeConsequence: Locator;
  readonly removeKeeps: Locator;
  readonly removeConfirmButton: Locator;
  readonly removeCancelButton: Locator;
  readonly roleChangeConfirm: Locator;
  readonly roleChangeWas: Locator;
  readonly roleChangeGains: Locator;
  readonly roleChangeLoses: Locator;
  readonly roleChangeBody: Locator;
  readonly roleChangeConfirmButton: Locator;
  readonly roleChangeCancelButton: Locator;
  readonly roleChangeBackdrop: Locator;
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
  readonly permissionGroups: Locator;
  readonly permissionGroupTitles: Locator;
  readonly permissionSelects: Locator;
  readonly permissionSources: Locator;
  readonly permissionChanges: Locator;
  readonly permissionsReset: Locator;
  readonly permissionConfirm: Locator;
  readonly permissionsCopy: Locator;
  readonly copyConfirm: Locator;
  readonly resetConfirm: Locator;
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
    this.error = page.getByTestId('manage-market-error');
    this.roleSelects = page.getByTestId('manage-market-role-select');
    this.removeUserButtons = page.getByTestId('manage-market-remove-user-button');
    this.people = page.getByTestId('manage-market-people');
    this.peopleFind = page.getByTestId('manage-market-access-find');
    this.peopleCount = page.getByTestId('manage-market-access-count');
    this.peopleRows = page.getByTestId('manage-market-person');
    this.peopleMore = page.getByTestId('manage-market-access-more');
    // Remove asks first (E38/F15/S01): its own destructive dialog, a sibling of Manage market.
    this.removeConfirm = page.getByTestId('manage-market-remove-window');
    this.removeConsequence = page.getByTestId('manage-market-remove-consequence');
    this.removeKeeps = page.getByTestId('manage-market-remove-keeps');
    this.removeConfirmButton = page.getByTestId('manage-market-remove-submit-button');
    this.removeCancelButton = page.getByTestId('manage-market-remove-cancel-button');
    this.roleChangeConfirm = page.getByTestId('manage-market-role-change-window');
    this.roleChangeWas = page.getByTestId('manage-market-role-change-was');
    this.roleChangeGains = page.getByTestId('manage-market-role-change-gains');
    this.roleChangeLoses = page.getByTestId('manage-market-role-change-loses');
    this.roleChangeBody = page.getByTestId('manage-market-role-change-body');
    this.roleChangeConfirmButton = page.getByTestId('manage-market-role-change-submit-button');
    this.roleChangeCancelButton = page.getByTestId('manage-market-role-change-cancel-button');
    this.roleChangeBackdrop = page.getByTestId('manage-market-role-change-background');
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
    this.permissionGroups = page.getByTestId('manage-market-permission-group');
    this.permissionGroupTitles = page.getByTestId('manage-market-permission-group-title');
    this.permissionSelects = page.getByTestId('manage-market-permission-select');
    this.permissionSources = page.getByTestId('manage-market-permission-source');
    this.permissionChanges = page.getByTestId('manage-market-permission-change');
    this.permissionsReset = page.getByTestId('manage-market-permissions-reset');
    // Each its own dialog, a sibling of Manage market.
    this.permissionConfirm = page.getByTestId('manage-market-permission-confirm-window');
    this.resetConfirm = page.getByTestId('manage-market-permissions-reset-confirm-window');
    this.permissionsCopy = page.getByTestId('manage-market-permissions-copy');
    this.copyConfirm = page.getByTestId('manage-market-permissions-copy-confirm-window');
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

  /** The row of the person whose address holds `email`. */
  person(email: string): Locator {
    return this.peopleRows.filter({ hasText: email });
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

  /** Confirms the confirmation a row's Remove opened; nothing is removed until then. */
  async confirmRemove(): Promise<void> {
    await this.removeConfirmButton.click();
  }

  /** Removes the person whose row holds `email`, through the confirmation Remove opens. */
  async removeUser(email: string): Promise<void> {
    await this.page
      .getByTestId('manage-market-person')
      .filter({ hasText: email })
      .getByTestId('manage-market-remove-user-button')
      .click();
    await this.removeConfirmButton.click();
  }

  // ── Permissions ──

  async showPermissions(): Promise<void> {
    await this.permissionsToggle.click();
  }

  /** Where each group's title and rows stand: the title, its first label, its last row's content. */
  permissionGroupEdges(): Promise<
    Array<{ titleTop: number; titleBottom: number; firstLabelTop: number; lastRowBottom: number }>
  > {
    return this.permissionGroups.evaluateAll((groups) =>
      groups.map((group) => {
        const rectOf = (testid: string) =>
          group.querySelector(`[data-testid="${testid}"]`)!.getBoundingClientRect();
        const title = rectOf('manage-market-permission-group-title');
        const lastRow = group.querySelector('li:last-child')!;
        return {
          titleTop: title.top,
          titleBottom: title.bottom,
          firstLabelTop: rectOf('manage-market-permission-label').top,
          lastRowBottom: Math.max(
            ...Array.from(lastRow.children, (part) => part.getBoundingClientRect().bottom),
          ),
        };
      }),
    );
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

  permissionLabel(actionId: string): Locator {
    return this.permissionRow(actionId).getByTestId('manage-market-permission-label');
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

  /** "Copy the organization's defaults again", which opens its confirmation (E39/F02/S01). */
  async copyOrganizationDefaults(): Promise<void> {
    await this.permissionsCopy.click();
  }

  async confirmCopy(): Promise<void> {
    await this.page.getByTestId('manage-market-permissions-copy-confirm-submit-button').click();
  }

  // ── Change role ──

  async selectRoleForFirstUser(role: string): Promise<void> {
    await this.roleSelects.first().selectOption(role);
    await this.roleChangeConfirmButton.click();
    await this.roleChangeConfirm.waitFor({ state: 'detached' });
  }
}
