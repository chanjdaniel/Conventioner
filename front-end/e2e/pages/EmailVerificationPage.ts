import type { Locator, Page } from '@playwright/test';

/** Page object for the page a verification link opens (`/verify-email`). */
export class EmailVerificationPage {
  readonly page: Page;

  /** Why the link failed, or that "Send the link again" did not send. */
  readonly errorMessage: Locator;
  /** The server's line for a link that worked. */
  readonly successMessage: Locator;
  /** "Redirecting to sign in…", under a link that worked. */
  readonly redirecting: Locator;
  /** The form a failed link offers: the address and "Send the link again". */
  readonly resendForm: Locator;
  readonly emailInput: Locator;
  /** The field's own message, for an empty address. */
  readonly emailError: Locator;
  readonly resendButton: Locator;
  /** "If that address needs verifying, a new link is on its way." */
  readonly resentMessage: Locator;
  readonly backLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.errorMessage = page.getByTestId('email-verification-error-message');
    this.successMessage = page.getByTestId('email-verification-success-message');
    this.redirecting = page.getByTestId('email-verification-redirecting');
    this.resendForm = page.getByTestId('email-verification-resend-form');
    this.emailInput = page.getByTestId('email-verification-email-input');
    this.emailError = page.getByTestId('email-verification-email-error');
    this.resendButton = page.getByTestId('email-verification-resend-button');
    this.resentMessage = page.getByTestId('email-verification-resent-message');
    this.backLink = page.getByTestId('email-verification-back-link');
  }

  async goto(token: string): Promise<void> {
    await this.page.goto(`/verify-email?token=${encodeURIComponent(token)}`);
  }

  /** Type `address` and press "Send the link again". */
  async sendTheLinkAgain(address: string): Promise<void> {
    await this.emailInput.fill(address);
    await this.resendButton.click();
  }
}
