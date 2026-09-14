import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page object for the application monitor: the Applications tab of Market Setup, where an
 * organizer reviews who has applied and decides who gets a table.
 *
 * This surface decides the solver's entire input. `assign_market` reads `reviewer_approved`
 * applications and nothing else, so an application nobody approves here takes no part in
 * assignment, however complete its answers are.
 *
 * It is a **triage queue** (E08/F04): one application at a time, every answer shown, Approve /
 * Reject / Skip by keyboard or click. There is no list of every applicant to click into, so
 * acting on a named applicant means skipping the queue around until their card is up.
 */
export class ApplicationMonitorPage {
  readonly page: Page;

  readonly panel: Locator;
  readonly loading: Locator;
  readonly empty: Locator;
  readonly done: Locator;
  readonly progress: Locator;
  readonly tally: Locator;
  readonly card: Locator;
  readonly answers: Locator;
  readonly email: Locator;
  readonly status: Locator;
  readonly approveButton: Locator;
  readonly rejectButton: Locator;
  readonly skipButton: Locator;
  readonly decidedToggle: Locator;
  readonly decidedRows: Locator;
  readonly decidedEmails: Locator;

  constructor(page: Page) {
    this.page = page;

    this.panel = page.getByTestId('app-monitor-panel');
    this.loading = page.getByTestId('app-monitor-loading');
    this.empty = page.getByTestId('app-monitor-empty');
    this.done = page.getByTestId('app-monitor-done');
    this.progress = page.getByTestId('app-monitor-progress');
    this.tally = page.getByTestId('app-monitor-tally');
    this.card = page.getByTestId('app-monitor-card');
    this.answers = page.getByTestId('app-monitor-answers');
    this.email = this.card.getByTestId('app-monitor-email');
    this.status = this.card.getByTestId('app-monitor-status');
    this.approveButton = page.getByTestId('app-monitor-approve-button');
    this.rejectButton = page.getByTestId('app-monitor-reject-button');
    this.skipButton = page.getByTestId('app-monitor-skip-button');
    this.decidedToggle = page.getByTestId('app-monitor-decided-toggle');
    this.decidedRows = page.getByTestId('app-monitor-decided-row');
    this.decidedEmails = page.getByTestId('app-monitor-decided-email');
  }

  /** Wait for the queue to settle, so a count is a count and not a race with the fetch. */
  async waitForLoaded(): Promise<void> {
    await expect(this.panel).toBeVisible();
    await expect(this.loading).toHaveCount(0);
  }

  /** How many still await a verdict, read off the progress line the organizer reads. */
  async remaining(): Promise<number> {
    const text = (await this.progress.textContent()) ?? '';
    return Number(text.match(/of (\d+) to review/)?.[1] ?? 0);
  }

  /**
   * Bring one applicant's card up by skipping past the others.
   *
   * Bounded by the queue length: the cursor wraps, so an applicant who is not in the queue would
   * otherwise loop forever rather than fail.
   */
  async advanceTo(applicantEmail: string): Promise<void> {
    const remaining = await this.remaining();
    for (let seen = 0; seen < remaining; seen += 1) {
      if ((await this.email.textContent())?.trim() === applicantEmail) return;
      await this.skipButton.click();
    }
    await expect(this.email).toHaveText(applicantEmail);
  }

  /** Approve one applicant, and wait for the queue to shrink before moving on. */
  async approve(applicantEmail: string): Promise<void> {
    await this.advanceTo(applicantEmail);
    const before = await this.remaining();
    await this.approveButton.click();
    await this.waitForReviewed(applicantEmail, 'Approved', before);
  }

  /** Reject one applicant, and wait for the queue to shrink before moving on. */
  async reject(applicantEmail: string): Promise<void> {
    await this.advanceTo(applicantEmail);
    const before = await this.remaining();
    await this.rejectButton.click();
    await this.waitForReviewed(applicantEmail, 'Rejected', before);
  }

  /** The verdict recorded for one applicant, read from the reviewed list. */
  decidedStatusOf(applicantEmail: string): Locator {
    return this.decidedRows
      .filter({ has: this.page.getByTestId('app-monitor-decided-email').getByText(applicantEmail) })
      .getByTestId('app-monitor-decided-status');
  }

  /** The applicants still awaiting a verdict, gathered by walking the queue once. */
  async queuedEmails(): Promise<string[]> {
    const remaining = await this.remaining();
    const seen: string[] = [];
    for (let i = 0; i < remaining; i += 1) {
      seen.push(((await this.email.textContent()) ?? '').trim());
      if (i < remaining - 1) await this.skipButton.click();
    }
    return seen;
  }

  /** The verdict landed: the applicant has left the queue and the reviewed list agrees. */
  private async waitForReviewed(
    applicantEmail: string,
    verdict: string,
    before: number,
  ): Promise<void> {
    if (before > 1) {
      await expect(this.progress).toContainText(`of ${before - 1} to review`);
    } else {
      await expect(this.done).toBeVisible();
    }
    await expect(this.decidedToggle).toBeVisible();
    if (!(await this.decidedRows.first().isVisible())) await this.decidedToggle.click();
    await expect(this.decidedStatusOf(applicantEmail)).toHaveText(verdict);
  }
}
