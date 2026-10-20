import type { Locator, Page } from '@playwright/test';
import { marketScreenPath } from '../helpers/marketScreens';

type AllViewFilter = 'all' | 'open' | 'needs_follow_up' | 'reviewer_approved' | 'reviewer_rejected';
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
  readonly confirmWindow: Locator;
  readonly confirmButton: Locator;
  readonly result: Locator;
  readonly skipped: Locator;
  readonly drawer: Locator;
  readonly drawerVerdict: Locator;
  readonly drawerHolder: Locator;

  constructor(page: Page) {
    this.page = page;
    this.rows = page.getByTestId('applications-all-row');
    this.mine = page.getByTestId('applications-all-mine');
    this.selection = page.getByTestId('applications-all-selection');
    this.confirmWindow = page.getByTestId('applications-all-confirm-window');
    this.confirmButton = page.getByTestId('applications-all-confirm-submit-button');
    this.result = page.getByTestId('applications-all-result');
    this.skipped = page.getByTestId('applications-all-skipped');
    this.drawer = page.getByTestId('vendors-detail-panel');
    this.drawerVerdict = page.getByTestId('applications-all-drawer-verdict');
    this.drawerHolder = page.getByTestId('applications-all-drawer-holder');
  }

  /** Straight to the All view by its address, as a bookmark would. */
  async goto(marketId: string): Promise<void> {
    await this.page.goto(`${marketScreenPath(marketId, 'applications')}?view=all`);
  }

  /** From the one-by-one review, by its switch. */
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
