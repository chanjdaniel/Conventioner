import type { Locator, Page } from '@playwright/test';

/** Page object for the page a verification link opens (`/verify-email`). */
export class EmailVerificationPage {
  readonly page: Page;

  readonly errorMessage: Locator;
  readonly successMessage: Locator;
  readonly resendButton: Locator;
  readonly backLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.errorMessage = page.getByTestId('email-verification-error-message');
    this.successMessage = page.getByTestId('email-verification-success-message');
    this.resendButton = page.getByTestId('email-verification-resend-button');
    this.backLink = page.getByTestId('email-verification-back-link');
  }

  async goto(token: string): Promise<void> {
    await this.page.goto(`/verify-email?token=${encodeURIComponent(token)}`);
  }
}
