import { test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { attachWhatTheBrowserSaid, watchTheBrowser } from './browserSaid';
import { hideDevToolsPanel } from './hideDevToolsPanel';

/**
 * Log a user in inside their own browser context, so no two users in a test ever share a
 * session cookie or the persisted `user` in localStorage. The context is closed afterwards.
 * `options` are the context's own, a phone's emulation say. When the sign-in or `body` throws, the
 * test gains what this page's browser said, as the fixture's own page does (T263).
 */
export async function withUser<T>(
  browser: Browser,
  email: string,
  password: string,
  body: (page: Page) => Promise<T>,
  options: BrowserContextOptions = {},
): Promise<T> {
  const context = await browser.newContext(options);
  await hideDevToolsPanel(context);
  try {
    const page = await context.newPage();
    const said = watchTheBrowser(page);
    try {
      const loginPage = new LoginPage(page);
      await loginPage.login(email, password);
      await loginPage.waitForMarkets();
      return await body(page);
    } catch (error) {
      await attachWhatTheBrowserSaid(test.info(), said(), `the page of withUser(${email})`);
      throw error;
    }
  } finally {
    await context.close();
  }
}
