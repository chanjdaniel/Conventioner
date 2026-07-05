import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the Organizations view (OrganizationsView) and the
 * ManageOrgOverlay. Covers org CRUD: create, rename, add/remove admin/member,
 * and delete.
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

  constructor(page: Page) {
    this.page = page;

    // OrganizationsView
    this.createButton = page.getByTestId('organizations-create-button');
    this.orgCards = page.locator('.org-card');
    this.manageButtons = page.getByTestId('organizations-manage-button');

    // Create org overlay
    this.createOverlayBackground = page.getByTestId('organizations-overlay-background');
    this.createNameInput = page.getByTestId('organizations-create-name-input');
    this.createSubmitButton = page.getByTestId('organizations-create-submit-button');

    // ManageOrgOverlay
    this.manageOverlayBackground = page.getByTestId('manage-org-overlay-background');
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
    this.deleteConfirmButton = page.getByTestId('manage-org-delete-confirm-button');
    this.deleteCancelButton = page.getByTestId('manage-org-delete-cancel-button');
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
    await this.page.waitForSelector('.container .window', { timeout: 5000 });
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

  async deleteOrg(): Promise<void> {
    await this.clickDelete();
    await this.confirmDelete();
  }
}
