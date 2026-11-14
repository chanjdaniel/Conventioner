import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { deleteUser } from './helpers/deleteUser';
import {
  detectLayout,
  gates,
  minTargetAt,
  SPACE_SCALE,
  TYPE_SCALE,
} from './helpers/layoutDetectors';
import { newAccountLink, plantAccountLink, storedAccountLinkHash } from './helpers/accountSecrets';
import { mongoEval } from './helpers/mongo';
import { EmailVerificationPage } from './pages/EmailVerificationPage';

/**
 * A verification link that fails asks for the address on the page itself (T181), never in a
 * browser prompt, and says what really happens next:
 *
 * - "Send the link again" makes a new link and says one is on its way, in the sign-in page's words,
 *   and the page stays where it is: "Redirecting" follows only a link that worked;
 * - a server's fault keeps the form and the address typed;
 * - an empty address is refused under the field, and nothing is sent;
 * - "Back to sign in" is a link to `/login`.
 *
 * Every test fails on a browser dialog: the page used to ask in a `prompt()`.
 */

const RESENT = 'If that address needs verifying, a new link is on its way.';
const SERVER_FAULT = 'Something went wrong on our side. Try again in a moment.';
const PASSWORD = 'E2eVerifyAgain123!';
/** The page's pause before it goes to sign in, and some. */
const PAST_THE_PAUSE_MS = 5000;

const WIDTHS = [
  { name: 'a phone', viewport: { width: 390, height: 844 } },
  { name: 'a desk', viewport: { width: 1440, height: 900 } },
];

function uniqueEmail(): string {
  return `e2e-verify-again-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** One field of the user's document, read straight from Mongo. */
function userField(email: string, field: string): string {
  return mongoEval(`print(db.users.findOne({email: ${JSON.stringify(email)}}).${field})`);
}

/** The card as drawn: nothing past the window, clipped or drawn over. */
async function expectItIsDrawnWell(page: Page): Promise<void> {
  const { width } = page.viewportSize()!;
  const findings = await page.evaluate(detectLayout, {
    spaceScale: SPACE_SCALE,
    textScale: TYPE_SCALE,
    minTarget: minTargetAt(width),
  });
  expect(findings.filter((f) => gates(f, width))).toEqual([]);
}

/** The page's own clock, so its pause runs on demand. */
async function onTheVerificationPage(page: Page): Promise<EmailVerificationPage> {
  await page.clock.install();
  return new EmailVerificationPage(page);
}

for (const { name, viewport } of WIDTHS) {
  test.describe(`the verification page, on ${name}`, () => {
    test.use({ viewport });

    // Any browser dialog fails the test: dismissed, so it cannot hold the page, and named after.
    let dialogs: string[] = [];
    test.beforeEach(({ page }) => {
      dialogs = [];
      page.on('dialog', async (dialog) => {
        dialogs.push(`${dialog.type()}: ${dialog.message()}`);
        await dialog.dismiss();
      });
    });
    test.afterEach(() => {
      expect(dialogs, 'the page opened a browser dialog').toEqual([]);
    });

    test('a failed link asks for the address, sends a new link, and stays put; the new link verifies and goes to sign in', async ({
      page,
      request,
    }) => {
      const email = uniqueEmail();
      // The sign-up leaves the account unverified and makes a link of its own, whose hash is read
      // below before the resend so the resend's new link tells from it.
      const created = await request.post('/api/register', {
        data: { email, password: PASSWORD, captcha_token: 'e2e' },
      });
      expect(created.status(), await created.text()).toBe(201);
      try {
        const verification = await onTheVerificationPage(page);
        await verification.goto('a-token-from-an-email');

        await expect(verification.errorMessage).toHaveText('Invalid verification token');
        await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
        await expect(verification.resendButton).toHaveText('Send the link again');
        await expect(page.getByText(/Redirecting/)).toHaveCount(0);
        await expectItIsDrawnWell(page);

        const before = storedAccountLinkHash(email, 'verify');
        await verification.sendTheLinkAgain(email);
        await expect(verification.resentMessage).toHaveText(RESENT);
        await expect(verification.errorMessage).toBeHidden();
        await expect(verification.resendForm).toHaveCount(0);
        await expect(verification.backLink).toBeVisible();
        // The form held focus; it goes to the one control left, never to the page itself.
        await expect(verification.backLink).toBeFocused();
        await expectItIsDrawnWell(page);

        // A new link was made for the address, which the stack's mail would have carried; it is
        // kept only as its hash, so a link the spec knows stands in for it.
        const after = storedAccountLinkHash(email, 'verify');
        expect(after).toMatch(/^[0-9a-f]{64}$/);
        expect(after).not.toBe(before);
        const token = newAccountLink();
        plantAccountLink(email, 'verify', token);

        // Past the pause a verification takes, the page has not moved and never said it would.
        await page.clock.runFor(PAST_THE_PAUSE_MS);
        await expect(page).toHaveURL(/\/verify-email\?token=a-token-from-an-email$/);
        await expect(page.getByText(/Redirecting/)).toHaveCount(0);

        // The new link works, says so, and goes to sign in after its pause.
        await verification.goto(token);
        await expect(verification.successMessage).toBeVisible();
        await expect(verification.redirecting).toHaveText('Redirecting to sign in…');
        await expect(verification.resendForm).toHaveCount(0);
        expect(userField(email, 'email_verified')).toBe('true');
        await expectItIsDrawnWell(page);
        await page.clock.runFor(PAST_THE_PAUSE_MS);
        await expect(page).toHaveURL(/\/login$/);
      } finally {
        deleteUser(email);
      }
    });

    test("a server's fault keeps the form and the address, and says so", async ({ page }) => {
      const verification = await onTheVerificationPage(page);
      await page.route('**/resend-verification', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal server error' }),
        }),
      );
      await verification.goto('a-token-from-an-email');

      const email = uniqueEmail();
      await verification.sendTheLinkAgain(email);
      await expect(verification.errorMessage).toHaveText(SERVER_FAULT);
      await expect(verification.resentMessage).toBeHidden();
      await expect(verification.emailInput).toHaveValue(email);
      await expect(verification.resendButton).toBeEnabled();
      await expectItIsDrawnWell(page);
    });

    test('an empty address is refused under the field, and nothing is sent', async ({ page }) => {
      const verification = await onTheVerificationPage(page);
      const sent: string[] = [];
      page.on('request', (r) => {
        if (r.url().endsWith('/resend-verification')) sent.push(r.url());
      });
      await verification.goto('a-token-from-an-email');
      await expect(verification.errorMessage).toBeVisible();

      await verification.resendButton.click();
      await expect(verification.emailError).toHaveText('Type your email address.');
      await expect(verification.emailInput).toBeFocused();
      await expect(verification.emailInput).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByRole('textbox', { name: 'Email' })).toHaveAccessibleDescription(
        'Type your email address.',
      );
      await expectItIsDrawnWell(page);
      expect(sent).toEqual([]);

      await verification.emailInput.fill('someone@example.com');
      await expect(verification.emailError).toHaveCount(0);
    });

    test('"Back to sign in" is a link to /login', async ({ page }) => {
      const verification = await onTheVerificationPage(page);
      await verification.goto('a-token-from-an-email');

      await expect(page.locator("a[href='/login']")).toHaveText('Back to sign in');
      await verification.backLink.click();
      await expect(page).toHaveURL(/\/login$/);
    });
  });
}
