import type { Locator, Page } from '@playwright/test';

/**
 * Page object for the Login, Register, and OTP authentication views.
 * Encapsulates all selectors using data-testid attributes.
 */
export class LoginPage {
  readonly page: Page;

  // Mode tabs
  readonly tabLogin: Locator;
  readonly tabRegister: Locator;
  readonly tabOtp: Locator;

  // Login form
  readonly loginForm: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly togglePassword: Locator;
  readonly errorMessage: Locator;
  readonly submitButton: Locator;
  readonly forgotPasswordLink: Locator;

  // Register form
  readonly registerForm: Locator;
  readonly registerEmailInput: Locator;
  readonly registerPasswordInput: Locator;
  readonly registerPasswordConfirmInput: Locator;
  readonly registerTogglePassword: Locator;
  readonly registerErrorMessage: Locator;
  readonly registerSuccessMessage: Locator;
  readonly registerSubmitButton: Locator;

  // OTP form
  readonly otpForm: Locator;
  readonly otpEmailInput: Locator;
  readonly otpCodeInput: Locator;
  readonly otpErrorMessage: Locator;
  readonly otpSuccessMessage: Locator;
  readonly otpSubmitButton: Locator;
  readonly otpDifferentEmailLink: Locator;

  constructor(page: Page) {
    this.page = page;

    this.tabLogin = page.getByTestId('login-tab-login');
    this.tabRegister = page.getByTestId('login-tab-register');
    this.tabOtp = page.getByTestId('login-tab-otp');

    this.loginForm = page.getByTestId('login-form');
    this.emailInput = page.getByTestId('login-email-input');
    this.passwordInput = page.getByTestId('login-password-input');
    this.togglePassword = page.getByTestId('login-toggle-password');
    this.errorMessage = page.getByTestId('login-error-message');
    this.submitButton = page.getByTestId('login-submit-button');
    this.forgotPasswordLink = page.getByTestId('login-forgot-password-link');

    this.registerForm = page.getByTestId('login-register-form');
    this.registerEmailInput = page.getByTestId('login-register-email-input');
    this.registerPasswordInput = page.getByTestId('login-register-password-input');
    this.registerPasswordConfirmInput = page.getByTestId('login-register-password-confirm-input');
    this.registerTogglePassword = page.getByTestId('login-register-toggle-password');
    this.registerErrorMessage = page.getByTestId('login-register-error-message');
    this.registerSuccessMessage = page.getByTestId('login-register-success-message');
    this.registerSubmitButton = page.getByTestId('login-register-submit-button');

    this.otpForm = page.getByTestId('login-otp-form');
    this.otpEmailInput = page.getByTestId('login-otp-email-input');
    this.otpCodeInput = page.getByTestId('login-otp-code-input');
    this.otpErrorMessage = page.getByTestId('login-otp-error-message');
    this.otpSuccessMessage = page.getByTestId('login-otp-success-message');
    this.otpSubmitButton = page.getByTestId('login-otp-submit-button');
    this.otpDifferentEmailLink = page.getByTestId('login-otp-different-email-link');
  }

  async goto(): Promise<void> {
    await this.page.goto('/login');
  }

  async switchToLogin(): Promise<void> {
    await this.tabLogin.click();
  }

  async switchToRegister(): Promise<void> {
    await this.tabRegister.click();
  }

  async switchToOtp(): Promise<void> {
    await this.tabOtp.click();
  }

  async fillEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
  }

  async fillPassword(password: string): Promise<void> {
    await this.passwordInput.fill(password);
  }

  async clickSubmit(): Promise<void> {
    await this.submitButton.click();
  }

  async login(email: string, password: string): Promise<void> {
    await this.goto();
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.clickSubmit();
  }

  async waitForDashboardRedirect(): Promise<void> {
    await this.page.waitForURL('**/dashboard', { timeout: 10000 });
  }
}
