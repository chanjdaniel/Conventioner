import type { Locator, Page } from '@playwright/test';
import { marketScreenPath } from '../helpers/marketScreens';

type AllViewFilter =
  'all' | 'undecided' | 'needs_follow_up' | 'reviewer_approved' | 'reviewer_rejected';
type Verdict = 'approve' | 'reject' | 'follow-up';

/**
 * Page object for the All view of a market's applications (E34/F04): every application at once,
 * filtered in the address, a row opening the vendor drawer, and a verdict on a ticked selection.
 */
export class ApplicationsAllPage {
  readonly page: Page;

  readonly rows: Locator;
  readonly mine: Locator;
  readonly selection: Locator;
  readonly selectAll: Locator;
  readonly selectAllSkipped: Locator;
  readonly confirmWindow: Locator;
  readonly confirmButton: Locator;
  readonly result: Locator;
  readonly skipped: Locator;
  readonly drawer: Locator;
  readonly drawerVerdict: Locator;
  readonly drawerHolder: Locator;
  readonly exportButton: Locator;
  /** Why a decided row has no tick, said once over the list (E38/F06/S01). */
  readonly changeReason: Locator;
  /** Why the drawer of a decided application offers no verdict (E38/F06/S01). */
  readonly drawerChangeReason: Locator;
  /** Whose share the opened application is, and the warning on deciding another's (E38/F07/S03). */
  readonly drawerReviewer: Locator;
  readonly drawerDealtWarning: Locator;
  /** What a selection's confirmation says of the ticked rows dealt to others (E38/F07/S03). */
  readonly confirmDealt: Locator;

  constructor(page: Page) {
    this.page = page;
    this.rows = page.getByTestId('applications-all-row');
    this.mine = page.getByTestId('applications-all-mine');
    this.selection = page.getByTestId('applications-all-selection');
    this.selectAll = page.getByTestId('applications-all-select-all');
    this.selectAllSkipped = page.getByTestId('applications-all-select-all-skipped');
    this.confirmWindow = page.getByTestId('applications-all-confirm-window');
    this.confirmButton = page.getByTestId('applications-all-confirm-submit-button');
    this.result = page.getByTestId('applications-all-result');
    this.skipped = page.getByTestId('applications-all-skipped');
    this.drawer = page.getByTestId('vendors-detail-panel');
    this.drawerVerdict = page.getByTestId('applications-all-drawer-verdict');
    this.drawerHolder = page.getByTestId('applications-all-drawer-holder');
    this.exportButton = page.getByTestId('applications-all-export-button');
    this.changeReason = page.getByTestId('applications-all-change-reason');
    this.drawerChangeReason = page.getByTestId('applications-all-drawer-change-reason');
    this.drawerReviewer = page.getByTestId('applications-all-drawer-reviewer');
    this.drawerDealtWarning = page.getByTestId('applications-all-drawer-dealt-warning');
    this.confirmDealt = page.getByTestId('applications-all-confirm-dealt');
  }

  /** Straight to the All view by a saved address, which still names it (E38/F05/S01). */
  async goto(marketId: string): Promise<void> {
    await this.page.goto(`${marketScreenPath(marketId, 'applications')}?view=all`);
  }

  /** Back from the one-by-one review, by its switch. */
  async switchTo(): Promise<void> {
    await this.page.getByTestId('applications-view-all').click();
  }

  row(email: string): Locator {
    return this.rows.filter({ hasText: email });
  }

  statusOf(email: string): Locator {
    return this.row(email).getByTestId('applications-all-status');
  }

  giverOf(email: string): Locator {
    return this.row(email).getByTestId('applications-all-giver');
  }

  reviewerOf(email: string): Locator {
    return this.row(email).getByTestId('applications-all-reviewer');
  }

  ownerOf(email: string): Locator {
    return this.row(email).getByTestId('applications-all-owner');
  }

  holders(): Locator {
    return this.page.getByTestId('applications-all-holder');
  }

  tickOf(email: string): Locator {
    return this.row(email).getByTestId('applications-all-tick');
  }

  async filter(by: AllViewFilter): Promise<void> {
    await this.page.getByTestId(`applications-all-filter-${by}`).click();
  }

  async open(email: string): Promise<void> {
    await this.row(email).getByRole('button').click();
    await this.drawer.waitFor();
  }

  /** A verdict from the drawer of the row opened. */
  drawerButton(verdict: Verdict): Locator {
    return this.page.getByTestId(`applications-all-${verdict}`);
  }

  /** A verdict on what is ticked, confirmed by its count. */
  async decideSelection(verdict: Verdict): Promise<void> {
    await this.page.getByTestId(`applications-all-selection-${verdict}`).click();
  }
}
