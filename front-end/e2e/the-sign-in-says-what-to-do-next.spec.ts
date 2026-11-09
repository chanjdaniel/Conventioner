import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, LoginPage } from './fixtures';
import { deleteUser } from './helpers/deleteUser';
import {
  detectLayout,
  gates,
  minTargetAt,
  SPACE_SCALE,
  TYPE_SCALE,
} from './helpers/layoutDetectors';
import { mongoEval } from './helpers/mongo';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * The sign-in screen's messages say what happened and what to do next (E38/F14/S02), on a phone
 * and on a desk:
 *
 * - a wrong password and an address with no account say the same, with "Forgot password?" in it;
 * - a right password on an account not yet verified says to verify first, and "Send the link
 *   again" makes a new link and says one is on its way;
 * - a wrong code replaces the "code sent" line: one line at a time;
 * - a few wrong passwords cost nothing, and past the limit the screen says how long to wait, with
 *   "Forgot password?" in it;
 * - past its limit, asking for a reset link says how long to wait too.
 *
 * No message says "log in", and none overflows its card.
 */

const DO_NOT_MATCH = 'That email and password do not match.';
const VERIFY_FIRST = 'Verify your email address first: we sent you a link when you registered.';
const RESENT = 'If that address needs verifying, a new link is on its way.';
const CODE_SENT = 'If an account exists for that address, a sign-in code has been sent to it.';
const WRONG_CODE = 'That code is not right.';
const PASSWORD = 'E2eSignInWords123!';
const TOO_MANY =
  /^Too many sign-in attempts\. Try again in \d+ minutes?, or reset your password\. Forgot password\?$/;
const ASKED_TOO_OFTEN = /^You have asked several times\. Try again in \d+ minutes?\.$/;

const WIDTHS = [
  { name: 'a phone', viewport: { width: 390, height: 844 } },
  { name: 'a desk', viewport: { width: 1440, height: 900 } },
];

function uniqueEmail(): string {
  return `e2e-sign-in-words-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** One field of the user's document, read straight from Mongo. */
function userField(email: string, field: string): string {
  return mongoEval(`print(db.users.findOne({email: ${JSON.stringify(email)}}).${field})`);
}

/** The sign-in card as drawn: nothing past the window, clipped or drawn over, and no "log in". */
async function expectItSaysItWell(page: Page): Promise<void> {
  const { width } = page.viewportSize()!;
  const findings = await page.evaluate(detectLayout, {
    spaceScale: SPACE_SCALE,
    textScale: TYPE_SCALE,
    minTarget: minTargetAt(width),
  });
  expect(findings.filter((f) => gates(f, width))).toEqual([]);
  await expect(page.getByTestId('auth-card')).not.toContainText(/log ?in/i);
}

for (const { name, viewport } of WIDTHS) {
  test.describe(`the sign-in's messages, on ${name}`, () => {
    test.use({ viewport });

    test('a wrong password and an address with no account say the same, and offer a reset', async ({
      page,
    }) => {
      const login = new LoginPage(page);
      await login.goto();

      await login.login(TEST_USER.email, 'not-the-password-123');
      await expect(login.errorMessage).toHaveText(`${DO_NOT_MATCH} Forgot password?`);
      await expectItSaysItWell(page);

      await login.login(uniqueEmail(), 'not-the-password-123');
      await expect(login.errorMessage).toHaveText(`${DO_NOT_MATCH} Forgot password?`);

      await login.errorForgotPasswordLink.click();
      await expect(page).toHaveURL(/\/reset-password-request$/);
    });

    test('an address that needs verifying offers the link again, and sends it', async ({
      page,
      request,
    }) => {
      const email = uniqueEmail();
      // `/register-user` leaves the account unverified and makes no link of its own.
      const created = await request.post('/api/register-user', {
        data: { email, password: PASSWORD },
      });
      expect(created.ok()).toBeTruthy();
      try {
        const login = new LoginPage(page);
        await login.goto();

        await login.login(email, PASSWORD);
        await expect(login.errorMessage).toHaveText(VERIFY_FIRST);
        await expect(login.resendVerificationButton).toHaveText('Send the link again');
        await expectItSaysItWell(page);

        const before = userField(email, 'verification_token');
        await login.resendVerificationButton.click();
        await expect(login.successMessage).toHaveText(RESENT);
        await expect(login.errorMessage).toBeHidden();
        await expect(login.resendVerificationButton).toHaveCount(0);
        // A new link was made for the address, which the stack's mail would have carried.
        const after = userField(email, 'verification_token');
        expect(after).not.toBe(before);
        expect(after.length).toBeGreaterThanOrEqual(10);
        await expectItSaysItWell(page);
      } finally {
        deleteUser(email);
      }
    });

    test('a few wrong passwords cost nothing: the right one signs in', async ({ page }) => {
      const email = uniqueEmail();
      ensureVerifiedUser(email, PASSWORD);
      try {
        const login = new LoginPage(page);
        for (let i = 0; i < 3; i++) {
          await login.login(email, `not-the-password-${i}`);
          await expect(login.errorMessage).toHaveText(`${DO_NOT_MATCH} Forgot password?`);
        }

        await login.login(email, PASSWORD);

        await login.waitForMarkets();
      } finally {
        deleteUser(email);
        // The serial run is one caller, and these tries counted against it.
        mongoEval('db.sign_in_attempts.deleteMany({})');
      }
    });

    test('past the limit the screen says how long to wait, and offers a reset', async ({
      page,
      request,
      expectAccessible,
    }) => {
      const email = uniqueEmail();
      ensureVerifiedUser(email, PASSWORD);
      try {
        for (let i = 0; i < 10; i++) {
          const wrong = await request.post('/api/login', {
            data: { email, password: `not-the-password-${i}` },
          });
          expect(wrong.status()).toBe(401);
        }
        const login = new LoginPage(page);

        await login.login(email, PASSWORD);

        await expect(login.errorMessage).toHaveText(TOO_MANY);
        await expect(login.errorForgotPasswordLink).toHaveText('Forgot password?');
        await expectItSaysItWell(page);
        await expectAccessible('the sign-in, past its limit');
        await login.errorForgotPasswordLink.click();
        await expect(page).toHaveURL(/\/reset-password-request$/);
      } finally {
        deleteUser(email);
        // The serial run is one caller, and these tries counted against it.
        mongoEval('db.sign_in_attempts.deleteMany({})');
      }
    });

    test('past its limit, asking for a reset link says how long to wait', async ({
      page,
      request,
      expectAccessible,
    }) => {
      const email = uniqueEmail();
      ensureVerifiedUser(email, PASSWORD);
      try {
        for (let i = 0; i < 5; i++) {
          const asked = await request.post('/api/request-password-reset', { data: { email } });
          expect(asked.status()).toBeLessThan(500);
        }
        await page.goto('/reset-password-request');

        await page.getByTestId('password-reset-request-email-input').fill(email);
        await page.getByTestId('password-reset-request-submit-button').click();

        await expect(page.getByTestId('password-reset-request-error-message')).toHaveText(
          ASKED_TOO_OFTEN,
        );
        await expect(page.getByTestId('password-reset-request-success-message')).toBeHidden();
        await expectItSaysItWell(page);
        await expectAccessible('asking for a reset link, past its limit');
      } finally {
        deleteUser(email);
        // The serial run is one caller, and these requests counted against it.
        mongoEval('db.sign_in_attempts.deleteMany({})');
      }
    });

    test('a wrong code replaces the "code sent" line', async ({ page }) => {
      const login = new LoginPage(page);
      await login.goto();
      // No email leaves the stack: the code is asked for as usual, and set where the server keeps
      // it, so a wrong one is wrong whatever ran before.
      await page.route('**/request-otp', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ msg: CODE_SENT }),
        }),
      );
      await login.switchToOtp();
      await login.otpEmailInput.fill(TEST_USER.email);
      await login.otpSubmitButton.click();
      await expect(login.otpSuccessMessage).toHaveText(CODE_SENT);
      const setCode = (code: string | null, expires: string | null) =>
        mongoEval(
          `db.users.updateOne({ email: ${JSON.stringify(TEST_USER.email)} }, ` +
            `{ $set: { otp: ${JSON.stringify(code)}, otp_expires: ${JSON.stringify(expires)}, ` +
            `otp_attempts: 0 } })`,
        );
      setCode('246810', new Date(Date.now() + 5 * 60_000).toISOString());
      try {
        await login.otpCodeInput.fill('135791');
        await login.otpSubmitButton.click();

        await expect(login.otpErrorMessage).toHaveText(WRONG_CODE);
        await expect(login.otpSuccessMessage).toBeHidden();
        await expectItSaysItWell(page);
      } finally {
        // No code left behind for the next spec to be refused by.
        setCode(null, null);
      }
    });
  });
}
