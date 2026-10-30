import type { Locator, Page } from '@playwright/test';
import { test, expect, LoginPage, PasswordResetPage } from './fixtures';

/**
 * The way in fits a phone (T73).
 *
 * The door on market day is sometimes a phone, and the attendance page sits behind sign-in, so the
 * pages that get an organizer signed in have to fit one too. Each drew a fixed 600px card centred
 * in a 390px window: the page scrolled sideways by 98px and the card's left edge, with the start of
 * every field and tab, was cut off where no scrolling could reach it.
 */

const PHONE = { width: 390, height: 844 };

/** Each page, opened and settled: `ready` is something only that page shows once it has drawn. */
const PAGES: { name: string; open: (page: Page) => Promise<Locator> }[] = [
  {
    name: 'sign in',
    open: async (page) => {
      const login = new LoginPage(page);
      await login.goto();
      return login.loginForm;
    },
  },
  {
    name: 'create account',
    open: async (page) => {
      const login = new LoginPage(page);
      await login.goto();
      await login.switchToRegister();
      return login.registerForm;
    },
  },
  {
    name: 'sign in with a code',
    open: async (page) => {
      const login = new LoginPage(page);
      await login.goto();
      await login.switchToOtp();
      return login.otpForm;
    },
  },
  {
    name: 'ask for a reset link',
    open: async (page) => {
      const reset = new PasswordResetPage(page);
      await reset.gotoRequest();
      return reset.requestForm;
    },
  },
  {
    name: 'choose a new password',
    open: async (page) => {
      const reset = new PasswordResetPage(page);
      await reset.gotoReset('a-token-from-an-email');
      return reset.resetForm;
    },
  },
  {
    name: 'verify an email address',
    open: async (page) => {
      // An unknown token, so the page settles on its error and the buttons that answer it.
      await page.goto('/verify-email?token=a-token-from-an-email');
      return page.getByTestId('email-verification-error-message');
    },
  },
];

/** The page settled, with its card inside the window and nothing scrolling sideways. */
async function expectItFits(page: Page, ready: Locator): Promise<void> {
  await expect(ready).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the page scrolls sideways on a phone').toBeLessThanOrEqual(0);

  const card = await page.getByTestId('auth-card').boundingBox();
  expect(card, 'the card is drawn').not.toBeNull();
  expect(card!.x, 'the card starts inside the window').toBeGreaterThanOrEqual(0);
  expect(card!.x + card!.width, 'the card ends inside the window').toBeLessThanOrEqual(PHONE.width);
}

for (const { name, open } of PAGES) {
  test(`${name} fits a phone`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await expectItFits(page, await open(page));
  });
}

// The same card, met signed in: Discord sends the organizer back to it, in the tab Connect Discord
// opened (E46/F01/S02). Cancelled on Discord, so it settles with no request.
test('the page Discord returns to fits a phone', async ({ authenticatedPage: page }) => {
  await page.setViewportSize(PHONE);
  await page.goto('/discord/connected?error=access_denied&state=a-market.a-nonce');
  await expectItFits(page, page.getByTestId('discord-connected-error'));
});
