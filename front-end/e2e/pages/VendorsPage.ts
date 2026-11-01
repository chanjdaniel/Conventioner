import type { Locator, Page } from '@playwright/test';
import { marketScreenPath } from '../helpers/marketScreens';

/**
 * Page object for the vendor browsing view (`/markets/:marketId/vendors`).
 */
export class VendorsPage {
  readonly page: Page;

  readonly searchInput: Locator;
  readonly vendorListItems: Locator;
  readonly detailCloseButton: Locator;
  readonly detailPanel: Locator;
  readonly detailOverlay: Locator;
  readonly detailAssignmentItems: Locator;
  /** The drawer's History tab: each entry's sentence, newest first (E40/F01/S04). */
  readonly detailHistorySentences: Locator;
  /** The Assignments and Vendors pages' shared filter bar (E28/F02/S02). */
  readonly dateFilter: Locator;
  readonly choiceFilter: Locator;
  readonly dateFilterChip: Locator;
  readonly clearAllFilterButton: Locator;
  readonly summary: Locator;
  readonly unassignedOnly: Locator;
  readonly exportButton: Locator;
  /** Who is in the Discord server (E46/F01/S03): each row's state, the filter, and the check. */
  readonly discordStates: Locator;
  readonly discordFilter: Locator;
  readonly discordChecked: Locator;
  readonly checkDiscordButton: Locator;
  /** Giving the market's role (E46/F01/S04): the button, and the last run's report. */
  readonly giveRolesButton: Locator;
  readonly roleReport: Locator;

  constructor(page: Page) {
    this.page = page;

    this.searchInput = page.getByTestId('vendors-search-input');
    this.vendorListItems = page.getByTestId('vendors-list-item');
    this.detailCloseButton = page.getByTestId('vendors-detail-close');
    this.detailPanel = page.getByTestId('vendors-detail-panel');
    /** The scrim. Clicking it dismisses the drawer, and it is what holds the mouse out. */
    this.detailOverlay = page.getByTestId('vendors-detail-overlay');
    this.detailAssignmentItems = page.getByTestId('vendors-detail-assignment-item');
    this.detailHistorySentences = page
      .getByTestId('vendor-drawer-panel-history')
      .getByTestId('market-history-sentence');
    this.dateFilter = page.getByTestId('vendors-filter-date');
    this.choiceFilter = page.getByTestId('vendors-filter-choice');
    this.dateFilterChip = page.getByTestId('vendors-filter-chip-date');
    this.clearAllFilterButton = page.getByTestId('vendors-filter-chip-clear-all');
    this.summary = page.getByTestId('vendors-summary');
    this.unassignedOnly = page.getByTestId('vendors-filter-unassigned');
    this.exportButton = page.getByTestId('vendors-export-button');
    this.discordStates = page.getByTestId('vendors-list-discord');
    this.discordFilter = page.getByTestId('vendors-discord-filter');
    this.discordChecked = page.getByTestId('vendors-discord-checked');
    this.checkDiscordButton = page.getByTestId('vendors-discord-check');
    this.giveRolesButton = page.getByTestId('vendors-discord-give');
    this.roleReport = page.getByTestId('vendors-role-report');
  }

  async goto(marketId: string): Promise<void> {
    await this.page.goto(marketScreenPath(marketId, 'vendors'));
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
  }

  async clickVendor(index: number): Promise<void> {
    await this.vendorListItems.nth(index).click();
  }

  /** One of the drawer's tabs (E35/F01/S01): it opens on Application. */
  async openTab(tab: 'application' | 'assignments' | 'history'): Promise<void> {
    await this.page.getByTestId(`vendor-drawer-tab-${tab}`).click();
    await this.page.getByTestId(`vendor-drawer-panel-${tab}`).waitFor();
  }

  async closeDetail(): Promise<void> {
    await this.detailCloseButton.click();
  }
}
