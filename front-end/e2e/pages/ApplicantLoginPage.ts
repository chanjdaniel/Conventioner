import type { Locator, Page } from '@playwright/test';

/**
 * The applicant's sign-in screen: an address, a six-digit code mailed to it, and no password.
 *
 * The back end hashes the code before storing it, so the test cannot read it from the database.
 * Tests that need a valid code must seed a challenge with a known code via
 * `createApplicantLoginChallenge()` in the seed helper.
 */
export class ApplicantLoginPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(marketSlug: string) {
    await this.page.goto(`/${marketSlug}/applicant-login`);
    await this.emailInput.waitFor();
  }

  get emailInput(): Locator {
    return this.page.getByTestId('applicant-login-email-input');
  }

  get requestButton(): Locator {
    return this.page.getByTestId('applicant-login-request-btn');
  }

  get codeInput(): Locator {
    return this.page.getByTestId('applicant-login-code-input');
  }

  get verifyButton(): Locator {
    return this.page.getByTestId('applicant-login-verify-btn');
  }

  get error(): Locator {
    return this.page.getByTestId('applicant-login-error');
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
}
