import type { Locator, Page } from '@playwright/test';
import { PersonChooser } from './PersonChooser';

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
  /** "Hand this market on" (T283): the section, its line or the line saying nobody else has access,
   *  its button, and the dialog it opens with its picker. */
  readonly handOnSection: Locator;
  readonly handOnLine: Locator;
  readonly handOnNobody: Locator;
  readonly handOnButton: Locator;
  readonly handOn: Locator;
  readonly handOnPicker: PersonChooser;
  readonly handOnConsequence: Locator;
  readonly handOnConfirmButton: Locator;
  readonly handOnCancelButton: Locator;
  readonly deleteConfirmButton: Locator;
  readonly deleteCancelButton: Locator;
  readonly permissionsOpen: Locator;
  readonly permissionsWindow: Locator;
  readonly permissionsBody: Locator;
  readonly permissionsClose: Locator;
  readonly permissionsSummary: Locator;
  readonly permissionsReadOnly: Locator;
  readonly permissionGroups: Locator;
  readonly permissionGroupTitles: Locator;
  readonly permissionSelects: Locator;
  readonly permissionSources: Locator;
  readonly permissionChanges: Locator;
  readonly permissionChangesBox: Locator;
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
  readonly historyWho: PersonChooser;
  readonly historyKind: Locator;
  readonly historyVendor: PersonChooser;
  readonly historyVendorHint: Locator;
  /** The box the History's entries scroll in (T224). */
  readonly historyBox: Locator;
  readonly historyBoxShadeBottom: Locator;
  readonly historyBoxShadeTop: Locator;
  readonly historySentinel: Locator;
  readonly historyLoading: Locator;
  readonly historyPageFailed: Locator;
  readonly historyRetry: Locator;
  /** The dialog's own scrolling body, around the History's box. */
  readonly body: Locator;

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
    this.handOnSection = page.getByTestId('manage-market-hand-on');
    this.handOnLine = page.getByTestId('manage-market-hand-on-line');
    this.handOnNobody = page.getByTestId('manage-market-hand-on-nobody');
    this.handOnButton = page.getByTestId('manage-market-hand-on-button');
    // Its own destructive dialog, a sibling of Manage market.
    this.handOn = page.getByTestId('hand-on-market-window');
    this.handOnPicker = new PersonChooser(page, 'hand-on-market-picker');
    this.handOnConsequence = page.getByTestId('hand-on-market-consequence');
    this.handOnConfirmButton = page.getByTestId('hand-on-market-submit-button');
    this.handOnCancelButton = page.getByTestId('hand-on-market-cancel-button');
    // Its own destructive dialog (bug 43), so its buttons are that dialog's.
    this.deleteConfirmButton = page.getByTestId('manage-market-delete-submit-button');
    this.deleteCancelButton = page.getByTestId('manage-market-delete-cancel-button');
    // Who may do what (E39/F01/S04): the section's button, and the rows' own dialog it opens.
    this.permissionsOpen = page.getByTestId('manage-market-permissions-open');
    this.permissionsWindow = page.getByTestId('manage-market-permissions-window');
    this.permissionsBody = page.getByTestId('manage-market-permissions-body');
    this.permissionsClose = page.getByTestId('manage-market-permissions-close-button');
    this.permissionsSummary = page.getByTestId('manage-market-permissions-summary');
    this.permissionsReadOnly = page.getByTestId('manage-market-permissions-read-only');
    this.permissionGroups = page.getByTestId('manage-market-permission-group');
    this.permissionGroupTitles = page.getByTestId('manage-market-permission-group-title');
    this.permissionSelects = page.getByTestId('manage-market-permission-select');
    this.permissionSources = page.getByTestId('manage-market-permission-source');
    this.permissionChanges = page.getByTestId('manage-market-permission-change');
    this.permissionChangesBox = page.getByTestId('manage-market-permission-changes-box');
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
    this.historyWho = new PersonChooser(page, 'market-history-who');
    this.historyKind = page.getByTestId('market-history-kind');
    this.historyVendor = new PersonChooser(page, 'market-history-vendor');
    this.historyVendorHint = page.getByTestId('market-history-vendor-hint');
    this.historyBox = page.getByTestId('market-history-box');
    this.historyBoxShadeBottom = page.getByTestId('market-history-box-shade-bottom');
    this.historyBoxShadeTop = page.getByTestId('market-history-box-shade-top');
    this.historySentinel = page.getByTestId('market-history-sentinel');
    this.historyLoading = page.getByTestId('market-history-loading');
    this.historyPageFailed = page.getByTestId('market-history-read-failed');
    this.historyRetry = page.getByTestId('market-history-retry');
    this.body = page.getByTestId('manage-market-body');
  }

  /** Opens the History section, closed until opened, and waits for its first page. */
  async openHistory(): Promise<void> {
    await this.historyToggle.click();
    await this.page.getByTestId('market-history').waitFor();
  }

  /** Scrolls the dialog until the History's box is whole in sight. */
  async showHistoryBox(): Promise<void> {
    await this.historyBox.evaluate((box) => box.scrollIntoView({ block: 'nearest' }));
  }

  /**
   * Scrolls the dialog until the History's box is whole in sight, and the box to its end, as far as it
   * has read: a list's end inside a box still below the dialog's fold is not in view, and asks nothing.
   */
  async scrollHistoryToEnd(): Promise<void> {
    await this.historyBox.evaluate((box) => {
      box.scrollIntoView({ block: 'nearest' });
      box.scrollTop = box.scrollHeight;
    });
  }

  /** Narrows the History section by typing "Who"'s words ("Anyone", or part of an address). */
  async narrowHistoryTo(words: string): Promise<void> {
    const { field, options, list } = this.historyWho;
    await field.fill(words);
    await options.filter({ hasText: words }).first().waitFor();
    await field.press('Enter');
    await list.waitFor({ state: 'detached' });
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

  /** The address in that person's row. */
  personEmail(email: string): Locator {
    return this.person(email).locator('.user-email');
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

  /** Opens the Permissions dialog, over Manage market. */
  async showPermissions(): Promise<void> {
    await this.permissionsOpen.click();
    await this.permissionsWindow.waitFor();
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
