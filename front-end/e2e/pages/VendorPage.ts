import type { Locator, Page } from '@playwright/test';

/**
 * A market's vendor page, `/<slug>` (ADR 0022): signed out, the market's name and the sign-in (an
 * address, then a six-digit code mailed to it, no password); signed in, where the vendor stands
 * and their application.
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

  get error(): Locator {
    return this.page.getByTestId('vendor-sign-in-error');
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

  get applyLink(): Locator {
    return this.page.getByTestId('vendor-page-apply-link');
  }

  get editLink(): Locator {
    return this.page.getByTestId('vendor-page-edit-link');
  }

  get signOutButton(): Locator {
    return this.page.getByTestId('vendor-page-sign-out-btn');
  }
}
