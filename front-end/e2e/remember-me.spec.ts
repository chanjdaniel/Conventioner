import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect, APP_API, TEST_USER, LoginPage } from './fixtures';
import { plantSignInCode } from './helpers/accountSecrets';
import { hideDevToolsPanel } from './helpers/hideDevToolsPanel';

/**
 * Signing in offers "Remember me" (E38/F14/S01), and closing the browser keeps to the choice.
 *
 * A browser reopened keeps its lasting cookies and its storage and drops its session cookies, so
 * reopening is a fresh context given exactly that. Unticked, the sign-in sets the session cookie
 * only, and the reopened browser is signed out; ticked, it also sets the remember cookie, which
 * lasts 30 days and signs the reopened browser back in. The 12 hours and the 30 days the server
 * holds each to are pytest's (`test_the_remember_cookie.py`), which can move the clock.
 *
 * The sign-in is kept on the server (ADR 0028), so signing out ends it there: a copy of the
 * browser's cookies taken before is signed out with it.
 */

const REMEMBER_COOKIE = '__Host-organizer_remember';
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;
const SESSION_ENDED = 'Your session has ended. Sign in again.';

/** A fresh browser holding what this one would keep across a restart. */
async function reopened(browser: Browser, closing: BrowserContext): Promise<Page> {
  const state = await closing.storageState();
  state.cookies = state.cookies.filter((cookie) => cookie.expires !== -1);
  const context = await browser.newContext({ storageState: state });
  await hideDevToolsPanel(context);
  return context.newPage();
}

/** The lasting cookies the browser holds, by name. */
async function lastingCookies(context: BrowserContext) {
  return (await context.cookies()).filter((cookie) => cookie.expires !== -1);
}

async function signInByPassword(page: Page, remember: boolean) {
  const login = new LoginPage(page);
  await login.goto();
  await expect(login.rememberMe).not.toBeChecked();
  if (remember) await login.rememberMe.check();
  await login.signIn(TEST_USER.email, TEST_USER.password);
  await login.waitForMarkets();
}

async function signInByCode(page: Page, remember: boolean) {
  const login = new LoginPage(page);
  await login.goto();
  // No email leaves the stack: the code is asked for as usual, and set where the server keeps it.
  await page.route('**/request-otp', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ msg: 'A sign-in code has been sent to your email.' }),
    }),
  );
  await login.switchToOtp();
  await login.otpEmailInput.fill(TEST_USER.email);
  await login.otpSubmitButton.click();
  await expect(login.otpCodeInput).toBeVisible();
  await expect(login.otpRememberMe).not.toBeChecked();
  if (remember) await login.otpRememberMe.check();
  plantSignInCode(TEST_USER.email, '246810');
  await login.otpCodeInput.fill('246810');
  await login.otpSubmitButton.click();
  await login.waitForMarkets();
}

async function expectSignedIn(page: Page) {
  await page.goto('/markets');
  await expect(page.getByTestId('markets-result-count')).toBeVisible();
  // Past the request that signed it back in, too: that session is the browser's from then on.
  await page.reload();
  await expect(page.getByTestId('markets-result-count')).toBeVisible();
  for (let i = 0; i < 2; i += 1) {
    expect((await page.request.get(`${APP_API}/check-session`)).status()).toBe(200);
  }
  expect(new URL(page.url()).pathname).toBe('/markets');
  expect((await page.context().cookies()).map((cookie) => cookie.name)).toContain(REMEMBER_COOKIE);
}

async function expectSignedOut(page: Page) {
  await page.goto('/markets');
  await page.waitForURL(/\/login/);
  await expect(page.getByTestId('login-session-ended')).toHaveText(SESSION_ENDED);
}

for (const [how, signIn] of [
  ['password', signInByPassword],
  ['code', signInByCode],
] as const) {
  test.describe(`signing in by ${how}`, () => {
    test('unticked, a reopened browser is signed out', async ({ page, browser }) => {
      await signIn(page, false);
      expect(await lastingCookies(page.context())).toEqual([]);

      const again = await reopened(browser, page.context());
      try {
        await expectSignedOut(again);
      } finally {
        await again.context().close();
      }
    });

    test('ticked, a reopened browser is signed in, for 30 days', async ({ page, browser }) => {
      const before = Date.now() / 1000;
      await signIn(page, true);
      const kept = await lastingCookies(page.context());
      expect(kept.map((cookie) => cookie.name)).toEqual([REMEMBER_COOKIE]);
      expect(kept[0].expires).toBeGreaterThan(before + THIRTY_DAYS_S - 60);
      expect(kept[0].expires).toBeLessThanOrEqual(Date.now() / 1000 + THIRTY_DAYS_S);
      // Sent on the app's own requests, kept where no script on the page reads them.
      for (const name of ['session', REMEMBER_COOKIE]) {
        const cookie = (await page.context().cookies()).find((c) => c.name === name);
        expect(cookie, name).toMatchObject({ sameSite: 'Lax', secure: true, httpOnly: true });
      }

      const again = await reopened(browser, page.context());
      try {
        await expectSignedIn(again);
      } finally {
        await again.context().close();
      }
    });
  });
}

test('an unticked sign-in forgets a browser remembered before', async ({ page, browser }) => {
  await signInByPassword(page, true);
  // The next person at the same browser finds the sign-in page, the last one's cookie still held.
  await page.context().clearCookies({ name: 'session' });
  await page.evaluate(() => localStorage.clear());
  expect((await lastingCookies(page.context())).map((cookie) => cookie.name)).toEqual([
    REMEMBER_COOKIE,
  ]);
  await signInByPassword(page, false);
  expect(await lastingCookies(page.context())).toEqual([]);

  const again = await reopened(browser, page.context());
  try {
    await expectSignedOut(again);
  } finally {
    await again.context().close();
  }
});

/** A second browser holding a copy of every cookie this one holds, session cookies too. */
async function copied(browser: Browser, from: BrowserContext): Promise<Page> {
  const context = await browser.newContext({ storageState: await from.storageState() });
  await hideDevToolsPanel(context);
  return context.newPage();
}

for (const remember of [true, false]) {
  test(`${remember ? 'ticked' : 'unticked'}, a copy of the cookies is signed out by Sign out`, async ({
    page,
    browser,
  }) => {
    await signInByPassword(page, remember);
    const copy = await copied(browser, page.context());
    try {
      expect((await copy.request.get(`${APP_API}/check-session`)).status()).toBe(200);

      await page.getByTestId('app-bar-account-button').click();
      await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
      await page.waitForURL(/\/login/);

      expect((await copy.request.get(`${APP_API}/check-session`)).status()).toBe(401);
      await expectSignedOut(copy);
    } finally {
      await copy.context().close();
    }
  });
}

test('the choice is named, reached by the keyboard, and kept across the two forms', async ({
  page,
}) => {
  const login = new LoginPage(page);
  await login.goto();
  await expect(page.getByRole('checkbox', { name: 'Remember me' })).toBeVisible();

  await login.passwordInput.focus();
  await page.keyboard.press('Tab'); // the password's Show toggle
  await page.keyboard.press('Tab');
  await expect(login.rememberMe).toBeFocused();
  await page.keyboard.press('Space');
  await expect(login.rememberMe).toBeChecked();

  await page.route('**/request-otp', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"msg":"Sent."}' }),
  );
  await login.switchToOtp();
  await login.otpEmailInput.fill(TEST_USER.email);
  await login.otpSubmitButton.click();
  await expect(login.otpRememberMe).toBeChecked();
});
