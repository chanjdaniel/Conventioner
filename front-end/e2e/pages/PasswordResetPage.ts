import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the Password Reset Request and Password Reset views.
 * Encapsulates all selectors using data-testid attributes.
 */
export class PasswordResetPage {
  readonly page: Page;

  // Password Reset Request form
  readonly requestForm: Locator;
  readonly requestEmailInput: Locator;
  readonly requestErrorMessage: Locator;
  readonly requestSuccessMessage: Locator;
  readonly requestSubmitButton: Locator;
  readonly requestBackLink: Locator;

  // Password Reset (set new password) form
  readonly resetForm: Locator;
  readonly resetNewPasswordInput: Locator;
  readonly resetConfirmPasswordInput: Locator;
  readonly resetTogglePassword: Locator;
  readonly resetErrorMessage: Locator;
  readonly resetSuccessMessage: Locator;
  readonly resetSubmitButton: Locator;
  readonly resetBackLink: Locator;

  constructor(page: Page) {
    this.page = page;

    this.requestForm = page.getByTestId('password-reset-request-form');
    this.requestEmailInput = page.getByTestId('password-reset-request-email-input');
    this.requestErrorMessage = page.getByTestId('password-reset-request-error-message');
    this.requestSuccessMessage = page.getByTestId('password-reset-request-success-message');
    this.requestSubmitButton = page.getByTestId('password-reset-request-submit-button');
    this.requestBackLink = page.getByTestId('password-reset-request-back-link');

    this.resetForm = page.getByTestId('password-reset-form');
    this.resetNewPasswordInput = page.getByTestId('password-reset-new-password-input');
    this.resetConfirmPasswordInput = page.getByTestId('password-reset-confirm-password-input');
    this.resetTogglePassword = page.getByTestId('password-reset-toggle-password');
    this.resetErrorMessage = page.getByTestId('password-reset-error-message');
    this.resetSuccessMessage = page.getByTestId('password-reset-success-message');
    this.resetSubmitButton = page.getByTestId('password-reset-submit-button');
    this.resetBackLink = page.getByTestId('password-reset-back-link');
  }

  async gotoRequest(): Promise<void> {
    await this.page.goto('/reset-password-request');
  }

  async gotoReset(token: string): Promise<void> {
    await this.page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
  }

  async fillRequestEmail(email: string): Promise<void> {
    await this.requestEmailInput.fill(email);
  }

  async clickRequestSubmit(): Promise<void> {
    await this.requestSubmitButton.click();
  }

  async requestReset(email: string): Promise<void> {
    await this.gotoRequest();
    await this.fillRequestEmail(email);
    await this.clickRequestSubmit();
  }

  async fillNewPassword(password: string): Promise<void> {
    await this.resetNewPasswordInput.fill(password);
  }

  async fillConfirmPassword(password: string): Promise<void> {
    await this.resetConfirmPasswordInput.fill(password);
  }

  async clickResetSubmit(): Promise<void> {
    await this.resetSubmitButton.click();
  }

  async resetPassword(newPassword: string): Promise<void> {
    await this.fillNewPassword(newPassword);
    await this.fillConfirmPassword(newPassword);
    await this.clickResetSubmit();
  }
}
