import type { Browser, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

/**
 * Log a user in inside their own browser context, so no two users in a test ever share a
 * session cookie or the persisted `user` in localStorage. The context is closed afterwards.
 */
export async function withUser<T>(
  browser: Browser,
  email: string,
  password: string,
  body: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const loginPage = new LoginPage(page);
    await loginPage.login(email, password);
    await loginPage.waitForDashboardRedirect();
    return await body(page);
  } finally {
    await context.close();
  }
}
