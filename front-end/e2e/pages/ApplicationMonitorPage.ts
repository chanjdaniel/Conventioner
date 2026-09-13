import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page object for the application monitor: the Applications tab of Market Setup, where an
 * organizer reviews who has applied and decides who gets a table.
 *
 * This surface decides the solver's entire input. `assign_market` reads `reviewer_approved`
 * applications and nothing else, so an application nobody approves here takes no part in
 * assignment, however complete its answers are.
 */
export class ApplicationMonitorPage {
  readonly page: Page;

  readonly panel: Locator;
  readonly list: Locator;
  readonly loading: Locator;
  readonly empty: Locator;
  readonly cards: Locator;
  readonly emails: Locator;
  readonly statuses: Locator;

  constructor(page: Page) {
    this.page = page;

    this.panel = page.getByTestId('app-monitor-panel');
    this.list = page.getByTestId('app-monitor-list');
    this.loading = page.getByTestId('app-monitor-loading');
    this.empty = page.getByTestId('app-monitor-empty');
    this.cards = page.getByTestId('app-monitor-card');
    this.emails = page.getByTestId('app-monitor-email');
    this.statuses = page.getByTestId('app-monitor-status');
  }

  /** Wait for the list to settle, so a count is a count and not a race with the fetch. */
  async waitForLoaded(): Promise<void> {
    await expect(this.panel).toBeVisible();
    await expect(this.loading).toHaveCount(0);
  }

  /** The card for one applicant, found by the address they applied with. */
  card(applicantEmail: string): Locator {
    return this.cards.filter({ has: this.page.getByText(applicantEmail, { exact: true }) });
  }

  /** The status badge as the organizer reads it, for one applicant. */
  statusOf(applicantEmail: string): Locator {
    return this.card(applicantEmail).getByTestId('app-monitor-status');
  }

  /** Approve one applicant, and wait for the badge to agree before moving on. */
  async approve(applicantEmail: string): Promise<void> {
    await this.card(applicantEmail).getByTestId('app-monitor-approve-button').click();
    await expect(this.statusOf(applicantEmail)).toHaveText('Approved');
  }

  /** Reject one applicant, and wait for the badge to agree before moving on. */
  async reject(applicantEmail: string): Promise<void> {
    await this.card(applicantEmail).getByTestId('app-monitor-reject-button').click();
    await expect(this.statusOf(applicantEmail)).toHaveText('Rejected');
  }

  /** The addresses currently listed, in the order the monitor shows them. */
  async listedEmails(): Promise<string[]> {
    return (await this.emails.allTextContents()).map((text) => text.trim());
  }
}
