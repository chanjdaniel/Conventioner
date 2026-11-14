import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect, APP_API, LoginPage } from './fixtures';
import { deleteUser } from './helpers/deleteUser';
import { hideDevToolsPanel } from './helpers/hideDevToolsPanel';
import { PHONE_AND_DESK, inTheWindow, type PhoneOrDesk } from './helpers/phoneWindow';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * Sign out everywhere (T311): the account menu's last entry at a desk, and the sheet's on a phone,
 * asks first in a dialog, then ends every sign-in of the account on the server, this browser's with
 * it, and lands on sign-in saying so.
 *
 * Another browser signed in to the account, remembered, finds sign-in at its next page, saying its
 * session has ended, and a copy of its cookies taken before answers 401. A request that fails leaves
 * the dialog saying so, and every browser signed in.
 *
 * Each test signs in an account of its own: ending every sign-in of the shared fixture organizer
 * would sign out every other worker's pages.
 */

const PASSWORD = 'e2epassword123';
const SESSION_ENDED = 'Your session has ended. Sign in again.';
const SIGNED_OUT_EVERYWHERE = 'You are signed out on every device.';
const COULD_NOT = 'Could not sign out everywhere. Try again.';

function uniqueEmail(): string {
  return `e2e-everywhere-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function signIn(page: Page, email: string, remember: boolean) {
  const login = new LoginPage(page);
  await login.goto();
  if (remember) await login.rememberMe.check();
  await login.signIn(email, PASSWORD);
  await login.waitForMarkets();
}

/** Another browser, at a desk, signed in to the account with "Remember me". */
async function anotherBrowser(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  await hideDevToolsPanel(context);
  const page = await context.newPage();
  await signIn(page, email, true);
  return page;
}

/** A browser holding a copy of every cookie `from` holds, session cookies too. */
async function copied(browser: Browser, from: BrowserContext): Promise<Page> {
  const context = await browser.newContext({ storageState: await from.storageState() });
  return context.newPage();
}

/** A browser holding only the cookies `from` would keep across a restart. */
async function reopened(browser: Browser, from: BrowserContext): Promise<Page> {
  const state = await from.storageState();
  state.cookies = state.cookies.filter((cookie) => cookie.expires !== -1);
  const context = await browser.newContext({ storageState: state });
  return context.newPage();
}

const signedIn = async (page: Page) =>
  (await page.request.get(`${APP_API}/check-session`)).status();

function theDialog(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Sign out everywhere?' });
  return {
    dialog,
    confirm: page.getByTestId('sign-out-everywhere-submit-button'),
    cancel: page.getByTestId('sign-out-everywhere-cancel-button'),
    error: page.getByTestId('sign-out-everywhere-error'),
  };
}

/** Open Sign out everywhere as a person does: from the sheet on a phone, the account menu at a desk. */
async function openSignOutEverywhere(page: Page, size: PhoneOrDesk) {
  const window = inTheWindow(size);
  if (size.phone) {
    await window.press(page.getByRole('button', { name: 'Open menu' }));
    await window.press(page.getByTestId('app-bar-sheet-sign-out-everywhere'));
    await expect(page.getByTestId('app-bar-sheet')).toHaveCount(0);
  } else {
    await page.getByTestId('app-bar-account-button').click();
    await page.getByRole('menuitem', { name: 'Sign out everywhere' }).click();
  }
  const { dialog, cancel } = theDialog(page);
  await expect(dialog).toBeVisible();
  // It asks before it acts, and a stray Enter cancels.
  await expect(cancel).toBeFocused();
}

/** What gave the dialog its focus, which gets it back as it closes. */
const opener = (page: Page, size: PhoneOrDesk) =>
  size.phone
    ? page.getByRole('button', { name: 'Open menu' })
    : page.getByTestId('app-bar-account-button');

for (const size of PHONE_AND_DESK) {
  test.describe(`Sign out everywhere, ${size.name}`, () => {
    test.use(size.use);

    let email: string;
    let others: Page[];

    test.beforeEach(() => {
      email = uniqueEmail();
      ensureVerifiedUser(email, PASSWORD);
      others = [];
    });

    test.afterEach(async () => {
      for (const other of others) await other.context().close();
      deleteUser(email);
    });

    test('asks first, then signs out every browser, a remembered one and a copy of its cookies too', async ({
      page,
      browser,
      expectAccessible,
    }) => {
      const window = inTheWindow(size);
      const elsewhere = await anotherBrowser(browser, email);
      others.push(elsewhere);
      const copy = await copied(browser, elsewhere.context());
      const kept = await reopened(browser, elsewhere.context());
      others.push(copy, kept);
      await signIn(page, email, false);
      expect([await signedIn(elsewhere), await signedIn(copy), await signedIn(kept)]).toEqual([
        200, 200, 200,
      ]);

      // Cancel changes nothing.
      await openSignOutEverywhere(page, size);
      const { dialog, confirm, cancel } = theDialog(page);
      await expect(dialog).toContainText(
        'This signs out every device and browser, including this one.',
      );
      await expect(confirm).toHaveText('Sign out everywhere');
      if (size.phone) await window.expectInside(dialog, 'the dialog');
      await expectAccessible(`the Sign out everywhere dialog, ${size.name}`);
      await window.press(cancel);
      await expect(dialog).toHaveCount(0);
      await expect(opener(page, size)).toBeFocused();
      expect(await signedIn(page)).toBe(200);
      expect(await signedIn(elsewhere)).toBe(200);

      await openSignOutEverywhere(page, size);
      await window.press(confirm);

      await page.waitForURL((url) => url.pathname === '/login');
      expect(new URL(page.url()).searchParams.get('everywhere')).toBe('1');
      await expect(page.getByTestId('login-signed-out-everywhere')).toHaveText(
        SIGNED_OUT_EVERYWHERE,
      );
      await expect(page.getByTestId('login-session-ended')).toHaveCount(0);
      await expect(page.getByTestId('app-bar-account-button')).toHaveCount(0);
      expect(await signedIn(page)).toBe(401);

      // The other browser's next page is sign-in, saying its session has ended.
      await elsewhere.goto('/markets');
      await elsewhere.waitForURL((url) => url.pathname === '/login');
      await expect(elsewhere.getByTestId('login-session-ended')).toHaveText(SESSION_ENDED);
      // A copy of its cookies taken before, and its remember cookie alone, are signed out too.
      expect(await signedIn(copy)).toBe(401);
      expect(await signedIn(kept)).toBe(401);

      // Signing in again works at once.
      await signIn(page, email, false);
      expect(await signedIn(page)).toBe(200);
    });

    test('a request that fails leaves the dialog saying so, and every browser signed in', async ({
      page,
      browser,
    }) => {
      const window = inTheWindow(size);
      const elsewhere = await anotherBrowser(browser, email);
      others.push(elsewhere);
      await signIn(page, email, false);
      await page.route('**/logout-everywhere', (route) => route.abort());

      await openSignOutEverywhere(page, size);
      const { dialog, confirm, error } = theDialog(page);
      await window.press(confirm);

      await expect(error).toHaveText(COULD_NOT);
      await expect(dialog).toBeVisible();
      await expect(confirm).toBeEnabled();
      if (size.phone) await window.expectInside(dialog, 'the dialog with its failure');
      expect(new URL(page.url()).pathname).toBe('/markets');
      expect(await signedIn(page)).toBe(200);
      expect(await signedIn(elsewhere)).toBe(200);

      // Try again, the request answered this time.
      await page.unroute('**/logout-everywhere');
      await window.press(confirm);
      await page.waitForURL((url) => url.pathname === '/login');
      await expect(page.getByTestId('login-signed-out-everywhere')).toHaveText(
        SIGNED_OUT_EVERYWHERE,
      );
      expect(await signedIn(elsewhere)).toBe(401);
    });
  });
}
