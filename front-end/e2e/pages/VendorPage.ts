import type { Locator, Page } from '@playwright/test';

/**
 * A market's vendor page, `/<slug>` (ADR 0022): signed out, the market's name and the sign-in (an
 * address, then a six-digit code mailed to it, no password); signed in, where the vendor stands
 * and their application, which Apply and Edit open as a form on the page itself.
 *
 * The back end hashes the code before storing it, so a test cannot read it from the database: a
 * test that needs a valid code seeds a challenge with a known one through
 * `createApplicantLoginChallenge()` in the seed helper.
 */
export class VendorPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Open the page and wait for the market to answer: its name, or "page not found". */
  async goto(marketSlug: string) {
    await this.page.goto(`/${marketSlug}`);
    await this.page
      .getByTestId('vendor-page-market-name')
      .or(this.page.getByTestId('page-not-found'))
      .or(this.page.getByTestId('vendor-page-load-failed'))
      .waitFor();
  }

  get marketName(): Locator {
    return this.page.getByTestId('vendor-page-market-name');
  }

  get notFound(): Locator {
    return this.page.getByTestId('vendor-page-not-found');
  }

  get loadFailed(): Locator {
    return this.page.getByTestId('vendor-page-load-failed');
  }

  get retryButton(): Locator {
    return this.page.getByTestId('vendor-page-retry-button');
  }

  // ── Signed out: the sign-in ──────────────────────────────────────────────

  get emailStep(): Locator {
    return this.page.getByTestId('vendor-sign-in-email-step');
  }

  get emailInput(): Locator {
    return this.page.getByTestId('vendor-sign-in-email-input');
  }

  get requestButton(): Locator {
    return this.page.getByTestId('vendor-sign-in-request-btn');
  }

  get codeStep(): Locator {
    return this.page.getByTestId('vendor-sign-in-code-step');
  }

  get codeInput(): Locator {
    return this.page.getByTestId('vendor-sign-in-code-input');
  }

  get verifyButton(): Locator {
    return this.page.getByTestId('vendor-sign-in-verify-btn');
  }

  get resendButton(): Locator {
    return this.page.getByTestId('vendor-sign-in-resend-btn');
  }

  /** The code step's one action once its code no longer works. */
  get sendNewCodeButton(): Locator {
    return this.page.getByTestId('vendor-sign-in-send-new-code-btn');
  }

  get error(): Locator {
    return this.page.getByTestId('vendor-sign-in-error');
  }

  /** "Remember me on this device until <date>", under the code; shown while the market has a date left. */
  get rememberMe(): Locator {
    return this.page.getByTestId('vendor-sign-in-remember-me');
  }

  /** Fill email and click request to transition to the code step. */
  async requestCode(email: string) {
    await this.emailInput.fill(email);
    await this.requestButton.click();
    await this.codeInput.waitFor({ timeout: 5000 });
  }

  async enterCode(code: string) {
    await this.codeInput.fill(code);
    await this.verifyButton.click();
  }

  /** Request a code and enter `code`, which the test has planted, then wait to be signed in. */
  async signIn(email: string, code: string) {
    await this.requestCode(email);
    await this.enterCode(code);
    await this.signedInAs.waitFor({ timeout: 10000 });
  }

  // ── Signed in ────────────────────────────────────────────────────────────

  get signedInAs(): Locator {
    return this.page.getByTestId('vendor-page-signed-in-as');
  }

  /** "Submitted", or the outcome once results are published, with the date applied. */
  get status(): Locator {
    return this.page.getByTestId('vendor-page-status');
  }

  /** Each day's table, once results are published. */
  get seats(): Locator {
    return this.page.getByTestId('vendor-page-seats');
  }

  get answers(): Locator {
    return this.page.getByTestId('vendor-page-answers');
  }

  answer(key: string): Locator {
    return this.page.getByTestId(`vendor-page-answer-${key}`);
  }

  /** "You have not applied …" with Apply, or the sentence for a market no longer taking any. */
  get info(): Locator {
    return this.page.getByTestId('vendor-page-info');
  }

  /** On a Google Form market, a signed-in address with no vendor there: which address to use. */
  get noVendor(): Locator {
    return this.page.getByTestId('vendor-page-no-vendor');
  }

  /** Opens the form, on this page, for a vendor who has not applied. */
  get applyButton(): Locator {
    return this.page.getByTestId('vendor-page-apply-btn');
  }

  /** Opens the form on the vendor's saved answers, while the market takes applications. */
  get editButton(): Locator {
    return this.page.getByTestId('vendor-page-edit-btn');
  }

  get signOutButton(): Locator {
    return this.page.getByTestId('vendor-page-sign-out-btn');
  }

  // ── Check-in, on the market's days and in the record (ADR 0022) ────────

  /** Open the page as the door's QR code does, on `?door=<code>`. */
  async gotoWithDoorCode(marketSlug: string, code: string) {
    await this.page.goto(`/${marketSlug}?door=${encodeURIComponent(code)}`);
    await this.marketName.or(this.page.getByTestId('page-not-found')).waitFor();
  }

  /** Over the sign-in, while a scanned door code waits for it. */
  get doorCodeHeld(): Locator {
    return this.page.getByTestId('vendor-page-door-held');
  }

  /** The check-in section on the market's days. */
  get checkIn(): Locator {
    return this.page.getByTestId('vendor-check-in');
  }

  /** Today's seat, on top, with Check in or when they did. */
  get todayCard(): Locator {
    return this.page.getByTestId('vendor-check-in-today');
  }

  get otherDays(): Locator {
    return this.page.getByTestId('vendor-check-in-other-days');
  }

  get doorCodeInput(): Locator {
    return this.page.getByTestId('vendor-check-in-code-input');
  }

  get checkInButton(): Locator {
    return this.page.getByTestId('vendor-check-in-btn');
  }

  /** "Checked in at <time>", once they have. */
  get checkedIn(): Locator {
    return this.page.getByTestId('vendor-check-in-done');
  }

  get undoButton(): Locator {
    return this.page.getByTestId('vendor-check-in-undo-btn');
  }

  get checkInError(): Locator {
    return this.page.getByTestId('vendor-check-in-error');
  }

  /** What a scanned code came to when it checked nobody in. */
  get checkInNotice(): Locator {
    return this.page.getByTestId('vendor-check-in-notice');
  }

  /** Type the door code under the QR code, and check in. */
  async checkInWith(code: string) {
    await this.doorCodeInput.fill(code);
    await this.checkInButton.click();
  }

  /** Once the market has ended: each seat, and when they checked in. */
  get record(): Locator {
    return this.page.getByTestId('vendor-check-in-record');
  }

  get recordSeats(): Locator {
    return this.page.getByTestId('vendor-check-in-record-seat');
  }

  // ── The application form, open on the page ──────────────────────────────

  get form(): Locator {
    return this.page.getByTestId('apply-form');
  }

  input(key: string): Locator {
    return this.page.getByTestId(`apply-input-${key}`);
  }

  async fillField(key: string, value: string) {
    await this.input(key).fill(value);
  }

  get submitButton(): Locator {
    return this.page.getByTestId('apply-submit-button');
  }

  /** Save the form; it closes on the answers once the server has taken them. */
  async submit() {
    await this.submitButton.click();
  }

  get cancelButton(): Locator {
    return this.page.getByTestId('apply-cancel-button');
  }

  /** A save the server refused, in its own words. */
  get formError(): Locator {
    return this.page.getByTestId('apply-error');
  }

  get essentialFields(): Locator {
    return this.page.getByTestId('apply-essential-fields');
  }

  get essentialEmail(): Locator {
    return this.page.getByTestId('apply-essential-email');
  }

  /** Identity, asked of every applicant whatever the market plan offers (E13/F01/S01). */
  get fullNameInput(): Locator {
    return this.page.getByTestId('apply-essential-full-name-input');
  }

  /**
   * What the vendor is actually called, when that differs from their legal name (E19/F02/S01).
   *
   * Optional: left blank, `display_name` falls back to the full name, so nobody is nameless.
   */
  get preferredNameInput(): Locator {
    return this.page.getByTestId('apply-essential-preferred-name-input');
  }

  /**
   * The row for one offered market date.
   *
   * Availability is no longer its own question (E19/F01/S02): an organizer's own form has always
   * asked it as one grid - tiers per day, or "not available" - so availability is derived from the
   * tier answer rather than asked beside it.
   */
  dateRow(date: string): Locator {
    return this.page.getByTestId(`apply-essential-tier-day-${date}`);
  }

  /** Say that this is a day the applicant cannot attend. */
  notAvailableCheckbox(date: string): Locator {
    return this.page.getByTestId(`apply-essential-unavailable-${date}`);
  }

  /**
   * The words naming that day: the date as the applicant reads it. Asserted whole, so a second
   * year appended to it is a failure - which a `toContainText` on a substring is not
   * (E14/F01/S01).
   */
  dateLabel(date: string): Locator {
    return this.dateRow(date).locator('.essential-tier-day-label');
  }

  /**
   * Tier is a hard filter AND it sets the price, so it is answered per date (E01/F05): a checkbox
   * per (date, tier), in a row for each date the applicant ticked above.
   */
  tierCheckbox(date: string, tier: string): Locator {
    return this.page.getByTestId(`apply-essential-tier-${date}-${tier}`);
  }

  /** Table choice is a radio over the three fixed ways a table can be occupied. */
  tableChoiceRadio(value: 'full' | 'half' | 'either'): Locator {
    return this.page.getByTestId(`apply-essential-table-choice-${value}`);
  }

  get tableShareEmailInput(): Locator {
    return this.page.getByTestId('apply-essential-table-share-email-input');
  }

  get maxDatesInput(): Locator {
    return this.page.getByTestId('apply-essential-max-dates-input');
  }

  sectionRankName(index: number): Locator {
    return this.page.getByTestId(`apply-essential-section-rank-name-${index}`);
  }

  sectionRankUp(index: number): Locator {
    return this.page.getByTestId(`apply-essential-section-rank-up-${index}`);
  }

  sectionRankDown(index: number): Locator {
    return this.page.getByTestId(`apply-essential-section-rank-down-${index}`);
  }
}
