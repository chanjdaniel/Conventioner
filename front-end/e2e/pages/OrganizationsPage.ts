import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page object for the Organizations view (OrganizationsView) and the
 * ManageOrgOverlay. Covers org CRUD: create, rename, add/remove admin/member,
 * delete, the organization's History, and its default permissions for new markets.
 *
 * The manage dialog is built on `AppDialog` (E20/F01/S02), so its window, scrim and close ids
 * come from the shell's `manage-org` prefix. **It no longer closes when something saves**: add
 * and remove leave it open showing the new membership, and the helpers here no longer reopen it.
 */
export class OrganizationsPage {
  readonly page: Page;

  // ── Organizations list view ──
  readonly createButton: Locator;
  readonly orgCards: Locator;
  readonly manageButtons: Locator;
  /** "Find an organization", drawn past 12 (T223). */
  readonly findInput: Locator;
  /** The list's count line, drawn once the list has been read. */
  readonly listCount: Locator;

  // ── Create org overlay ──
  readonly createOverlayBackground: Locator;
  readonly createNameInput: Locator;
  readonly createSubmitButton: Locator;

  // ── Manage org overlay ──
  readonly manageOverlayBackground: Locator;
  readonly renameInput: Locator;
  readonly renameSaveButton: Locator;
  readonly addAdminButton: Locator;
  readonly addAdminInput: Locator;
  readonly addAdminSubmit: Locator;
  readonly addMemberButton: Locator;
  readonly addMemberInput: Locator;
  readonly addMemberSubmit: Locator;
  readonly removeUserButtons: Locator;
  readonly removeMemberButtons: Locator;
  readonly admins: Locator;
  readonly members: Locator;
  readonly removeConfirm: Locator;
  readonly removeConsequence: Locator;
  readonly removeConfirmButton: Locator;
  readonly removeCancelButton: Locator;
  readonly deleteButton: Locator;
  readonly deleteConfirmButton: Locator;
  readonly deleteCancelButton: Locator;
  readonly deleteWindow: Locator;
  readonly deleteBlocked: Locator;
  readonly doomedMarkets: Locator;
  readonly blockingMarkets: Locator;
  readonly manageWindow: Locator;
  /** What Manage organization says of a request that failed, under its title. */
  readonly manageError: Locator;
  readonly manageCloseButton: Locator;
  readonly adminEmails: Locator;
  readonly memberEmails: Locator;
  readonly adminsFind: Locator;
  readonly adminsCount: Locator;
  readonly adminsMore: Locator;
  readonly membersFind: Locator;
  readonly membersCount: Locator;
  readonly membersMore: Locator;

  // ── Manage org's History (E40/F02/S01) ──
  readonly history: Locator;
  readonly historyToggle: Locator;
  readonly historyEntries: Locator;
  readonly historySentences: Locator;
  readonly historyBox: Locator;
  readonly historyBoxShadeBottom: Locator;
  readonly historySentinel: Locator;

  // ── Manage org's default permissions for new markets (E39/F02/S01) ──
  readonly defaultsOpen: Locator;
  readonly defaultsWindow: Locator;
  readonly defaultsBody: Locator;
  readonly defaultsClose: Locator;
  readonly defaultsSummary: Locator;
  readonly defaultsReset: Locator;
  readonly defaultsResetConfirm: Locator;
  readonly defaultsReadOnly: Locator;
  readonly defaultSelects: Locator;
  readonly defaultChanges: Locator;
  readonly defaultChangesBox: Locator;
  readonly defaultConfirm: Locator;

  constructor(page: Page) {
    this.page = page;

    // OrganizationsView
    this.createButton = page.getByTestId('organizations-create-button');
    this.orgCards = page.getByTestId('organization-card');
    this.manageButtons = page.getByTestId('organizations-manage-button');
    this.findInput = page.getByTestId('organizations-list-find');
    this.listCount = page.getByTestId('organizations-list-count');

    // Create org overlay
    this.createOverlayBackground = page.getByTestId('organizations-overlay-background');
    this.createNameInput = page.getByTestId('organizations-create-name-input');
    this.createSubmitButton = page.getByTestId('organizations-create-submit-button');

    // ManageOrgOverlay
    this.manageOverlayBackground = page.getByTestId('manage-org-background');
    this.manageWindow = page.getByTestId('manage-org-window');
    this.manageError = page.getByTestId('manage-org-error');
    this.manageCloseButton = page.getByTestId('manage-org-close-button');
    this.renameInput = page.getByTestId('manage-org-rename-input');
    this.renameSaveButton = page.getByTestId('manage-org-rename-save-button');
    this.addAdminButton = page.getByTestId('manage-org-add-admin-button');
    this.addAdminInput = page.getByTestId('manage-org-add-admin-input');
    this.addAdminSubmit = page.getByTestId('manage-org-add-admin-submit');
    this.addMemberButton = page.getByTestId('manage-org-add-member-button');
    this.addMemberInput = page.getByTestId('manage-org-add-member-input');
    this.addMemberSubmit = page.getByTestId('manage-org-add-member-submit');
    this.removeUserButtons = page.getByTestId('manage-org-remove-user-button');
    this.removeMemberButtons = page.getByTestId('manage-org-remove-member-button');
    this.admins = page.getByTestId('manage-org-admins');
    this.members = page.getByTestId('manage-org-members');
    // Remove asks first (E38/F15/S01): its own destructive dialog, a sibling of Manage organization.
    this.removeConfirm = page.getByTestId('manage-org-remove-window');
    this.removeConsequence = page.getByTestId('manage-org-remove-consequence');
    this.removeConfirmButton = page.getByTestId('manage-org-remove-submit-button');
    this.removeCancelButton = page.getByTestId('manage-org-remove-cancel-button');
    this.deleteButton = page.getByTestId('manage-org-delete-button');
    this.deleteConfirmButton = page.getByTestId('delete-org-submit-button');
    this.deleteCancelButton = page.getByTestId('delete-org-cancel-button');
    this.deleteWindow = page.getByTestId('delete-org-window');
    this.deleteBlocked = page.getByTestId('delete-org-blocked');
    this.doomedMarkets = page.getByTestId('delete-org-doomed-market');
    this.blockingMarkets = page.getByTestId('delete-org-blocking-market');
    this.adminEmails = this.manageWindow.getByTestId('manage-org-admin-email');
    this.memberEmails = this.manageWindow.getByTestId('manage-org-member-email');
    this.adminsFind = page.getByTestId('manage-org-admin-list-find');
    this.adminsCount = page.getByTestId('manage-org-admin-list-count');
    this.adminsMore = page.getByTestId('manage-org-admin-list-more');
    this.membersFind = page.getByTestId('manage-org-member-list-find');
    this.membersCount = page.getByTestId('manage-org-member-list-count');
    this.membersMore = page.getByTestId('manage-org-member-list-more');

    this.history = page.getByTestId('manage-org-history');
    this.historyToggle = page.getByTestId('manage-org-history-toggle');
    this.historyEntries = page.getByTestId('org-history-entry');
    this.historySentences = page.getByTestId('org-history-sentence');
    this.historyBox = page.getByTestId('org-history-box');
    this.historyBoxShadeBottom = page.getByTestId('org-history-box-shade-bottom');
    this.historySentinel = page.getByTestId('org-history-sentinel');

    // The section's button, and the rows' own dialog it opens (T217).
    this.defaultsOpen = page.getByTestId('manage-org-permissions-open');
    this.defaultsWindow = page.getByTestId('manage-org-permissions-window');
    this.defaultsBody = page.getByTestId('manage-org-permissions-body');
    this.defaultsClose = page.getByTestId('manage-org-permissions-close-button');
    this.defaultsSummary = page.getByTestId('manage-org-permissions-summary');
    this.defaultsReset = page.getByTestId('manage-org-permissions-reset');
    this.defaultsResetConfirm = page.getByTestId('manage-org-permissions-reset-confirm-window');
    this.defaultsReadOnly = page.getByTestId('manage-org-permissions-read-only');
    this.defaultSelects = page.getByTestId('manage-org-permission-select');
    this.defaultChanges = page.getByTestId('manage-org-permission-change');
    this.defaultChangesBox = page.getByTestId('manage-org-permission-changes-box');
    this.defaultConfirm = page.getByTestId('manage-org-permission-confirm-window');
  }

  async goto(): Promise<void> {
    await this.page.goto('/organizations');
  }

  async waitForLoaded(): Promise<void> {
    await this.page.waitForSelector('.organizations-view', { timeout: 10000 });
  }

  /**
   * One organization's card, found as a person finds it: by "Find an organization" when the page
   * offers it, and by nothing at 12 or fewer. The list shows 50 at a time in the order the
   * organizations were made (T223), so a new one on an account that has gathered many is past the
   * first page. The words stay in the address as `search`, the find field filled, until changed.
   */
  async findCard(name: string): Promise<Locator> {
    await expect(this.createNameInput).toBeHidden();
    await expect(this.listCount).toBeVisible({ timeout: 10000 });
    if (await this.findInput.isVisible()) await this.findInput.fill(name);
    const card = this.orgCards.filter({ hasText: name });
    await expect(card.first()).toBeVisible({ timeout: 10000 });
    return card;
  }

  // ── Create org ──

  async clickCreate(): Promise<void> {
    await this.createButton.click();
  }

  async fillOrgName(name: string): Promise<void> {
    await this.createNameInput.fill(name);
  }

  async submitCreate(): Promise<void> {
    await this.createSubmitButton.click();
  }

  async createOrg(name: string): Promise<void> {
    await this.clickCreate();
    await this.fillOrgName(name);
    await this.submitCreate();
  }

  // ── Manage org ──

  async clickManage(): Promise<void> {
    await this.manageButtons.first().click();
  }

  async waitForManageOverlay(): Promise<void> {
    await this.manageWindow.waitFor({ state: 'visible', timeout: 5000 });
  }

  // ── Rename ──

  async renameOrg(newName: string): Promise<void> {
    await this.renameInput.clear();
    await this.renameInput.fill(newName);
    await this.renameSaveButton.click();
  }

  // ── Add admin ──

  async clickAddAdmin(): Promise<void> {
    await this.addAdminButton.click();
  }

  async fillAdminEmail(email: string): Promise<void> {
    await this.addAdminInput.fill(email);
  }

  async submitAddAdmin(): Promise<void> {
    await this.addAdminSubmit.click();
  }

  async addAdmin(email: string): Promise<void> {
    await this.clickAddAdmin();
    await this.fillAdminEmail(email);
    await this.submitAddAdmin();
  }

  // ── Add member ──

  async clickAddMember(): Promise<void> {
    await this.addMemberButton.click();
  }

  async fillMemberEmail(email: string): Promise<void> {
    await this.addMemberInput.fill(email);
  }

  async submitAddMember(): Promise<void> {
    await this.addMemberSubmit.click();
  }

  async addMember(email: string): Promise<void> {
    await this.clickAddMember();
    await this.fillMemberEmail(email);
    await this.submitAddMember();
  }

  // ── Remove users ──

  /** Confirms the confirmation a row's Remove opened; nothing is removed until then. */
  async confirmRemove(): Promise<void> {
    await this.removeConfirmButton.click();
  }

  // ── History ──

  /** Open the History section, closed until its heading opens it, and wait for its first page. */
  async openHistory(): Promise<void> {
    await this.historyToggle.click();
    await this.page.getByTestId('org-history').waitFor();
  }

  /** Brings the History's box into sight and scrolls it to its end, as a reader's wheel does. */
  async scrollHistoryToEnd(): Promise<void> {
    await this.historyBox.evaluate((box) => {
      box.scrollIntoView({ block: 'nearest' });
      box.scrollTop = box.scrollHeight;
    });
  }

  /** Open one entry's before and after, and return them. */
  async openHistoryEntry(index: number): Promise<Locator> {
    const entry = this.historyEntries.nth(index);
    await entry.getByTestId('org-history-toggle').click();
    return entry.getByTestId('org-history-changes');
  }

  // ── Default permissions for new markets ──

  /** Opens the default's dialog, over Manage organization. */
  async showDefaults(): Promise<void> {
    await this.defaultsOpen.click();
    await this.defaultsWindow.waitFor();
  }

  /** One row of the default, by its action id: `check-in`. */
  defaultRow(actionId: string): Locator {
    return this.page.getByTestId(`manage-org-permission-row-${actionId}`);
  }

  defaultSelect(actionId: string): Locator {
    return this.defaultRow(actionId).getByTestId('manage-org-permission-select');
  }

  defaultRole(actionId: string): Locator {
    return this.defaultRow(actionId).getByTestId('manage-org-permission-role');
  }

  defaultSource(actionId: string): Locator {
    return this.defaultRow(actionId).getByTestId('manage-org-permission-source');
  }

  /** Chooses a role for a row, from the focused select as a person does, which opens its confirmation. */
  async chooseDefault(actionId: string, role: string): Promise<void> {
    await this.defaultSelect(actionId).focus();
    await this.defaultSelect(actionId).selectOption(role);
  }

  async confirmDefault(): Promise<void> {
    await this.page.getByTestId('manage-org-permission-confirm-submit-button').click();
  }

  // ── Delete ──

  async clickDelete(): Promise<void> {
    await this.deleteButton.click();
  }

  async confirmDelete(): Promise<void> {
    await this.deleteConfirmButton.click();
  }

  async cancelDelete(): Promise<void> {
    await this.deleteCancelButton.click();
  }

  /**
   * Delete the organization through its confirmation dialog (E20/F04/S01).
   *
   * The confirm waits to be enabled: the dialog reads what the deletion would destroy before it
   * offers to do it, so clicking straight through would race the preview.
   */
  async deleteOrg(): Promise<void> {
    await this.clickDelete();
    await this.deleteWindow.waitFor({ state: 'visible', timeout: 5000 });
    await this.deleteConfirmButton.waitFor({ state: 'visible', timeout: 5000 });
    await expect(this.deleteConfirmButton).toBeEnabled({ timeout: 10000 });
    await this.confirmDelete();
  }
}
