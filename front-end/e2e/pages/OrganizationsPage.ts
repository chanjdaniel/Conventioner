import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page object for the Organizations view (OrganizationsView) and the
 * ManageOrgOverlay. Covers org CRUD: create, rename, add/remove admin/member,
 * and delete.
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
  readonly deleteButton: Locator;
  readonly deleteConfirmButton: Locator;
  readonly deleteCancelButton: Locator;
  readonly deleteWindow: Locator;
  readonly deleteBlocked: Locator;
  readonly doomedMarkets: Locator;
  readonly blockingMarkets: Locator;
  readonly manageWindow: Locator;
  readonly manageCloseButton: Locator;
  readonly adminEmails: Locator;
  readonly memberEmails: Locator;

  constructor(page: Page) {
    this.page = page;

    // OrganizationsView
    this.createButton = page.getByTestId('organizations-create-button');
    this.orgCards = page.getByTestId('organization-card');
    this.manageButtons = page.getByTestId('organizations-manage-button');

    // Create org overlay
    this.createOverlayBackground = page.getByTestId('organizations-overlay-background');
    this.createNameInput = page.getByTestId('organizations-create-name-input');
    this.createSubmitButton = page.getByTestId('organizations-create-submit-button');

    // ManageOrgOverlay
    this.manageOverlayBackground = page.getByTestId('manage-org-background');
    this.manageWindow = page.getByTestId('manage-org-window');
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
    this.deleteButton = page.getByTestId('manage-org-delete-button');
    this.deleteConfirmButton = page.getByTestId('delete-org-submit-button');
    this.deleteCancelButton = page.getByTestId('delete-org-cancel-button');
    this.deleteWindow = page.getByTestId('delete-org-window');
    this.deleteBlocked = page.getByTestId('delete-org-blocked');
    this.doomedMarkets = page.getByTestId('delete-org-doomed-market');
    this.blockingMarkets = page.getByTestId('delete-org-blocking-market');
    this.adminEmails = this.manageWindow.getByTestId('manage-org-admin-email');
    this.memberEmails = this.manageWindow.getByTestId('manage-org-member-email');
  }

  async goto(): Promise<void> {
    await this.page.goto('/organizations');
  }

  async waitForLoaded(): Promise<void> {
    await this.page.waitForSelector('.organizations-view', { timeout: 10000 });
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

  async removeFirstAdmin(): Promise<void> {
    await this.removeUserButtons.first().click();
  }

  async removeFirstMember(): Promise<void> {
    await this.removeMemberButtons.first().click();
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
