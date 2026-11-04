import { test, expect, LoginPage, PasswordResetPage } from './fixtures';
import { deleteUser } from './helpers/deleteUser';
import { mongoEval } from './helpers/mongo';

/**
 * The links an account email carries must work for the person they are sent to, who is signed
 * out (E26/F01/S01, bug 22).
 *
 * Nothing here stubs `/check-session`: a signed-out browser gets a 401 from it, and that is the
 * condition the pages must survive. The reset spec in `auth.spec.ts` used to answer 200 for it,
 * which is how a page that bounced every real recipient to sign-in stayed green.
 */

const PASSWORD = 'E2eLinks123!';
const NEW_PASSWORD = 'E2eLinksNew456!';

function uniqueEmail(): string {
  return `e2e-links-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** One field of the user's document, read straight from Mongo the way `auth.spec.ts` does. */
function userField(email: string, field: string): string {
  return mongoEval(`print(db.users.findOne({email: ${JSON.stringify(email)}}).${field})`);
}

test.describe('Account links, opened signed out', () => {
  test('a real reset link shows the form, and the new password signs in', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail();
    const created = await request.post('/api/register-user', {
      data: { email, password: PASSWORD },
    });
    expect(created.ok()).toBeTruthy();
    try {
      expect((await request.post('/api/request-password-reset', { data: { email } })).ok()).toBe(
        true,
      );
      const token = userField(email, 'password_reset_token');
      expect(token.length).toBeGreaterThanOrEqual(10);

      await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
      const reset = new PasswordResetPage(page);
      await expect(reset.resetForm).toBeVisible();
      // Still here after the shell's own session probe has had time to answer.
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(/\/reset-password\?token=/);

      await reset.resetPassword(NEW_PASSWORD);
      await expect(reset.resetSuccessMessage).toBeVisible();

      // `/register-user` leaves the account unverified; verify it so the new password can sign in.
      mongoEval(
        `db.users.updateOne({email: ${JSON.stringify(email)}}, {$set: {email_verified: true}})`,
      );
      await page.goto('/login');
      await new LoginPage(page).login(email, NEW_PASSWORD);
      await expect(page).toHaveURL(/\/markets$/);
    } finally {
      deleteUser(email);
    }
  });

  test('a real verification link shows its confirmation', async ({ page, request }) => {
    const email = uniqueEmail();
    const created = await request.post('/api/register', {
      data: { email, password: PASSWORD, captcha_token: 'e2e' },
    });
    expect(created.status(), await created.text()).toBe(201);
    try {
      const token = userField(email, 'verification_token');
      expect(token.length).toBeGreaterThanOrEqual(10);

      await page.goto(`/verify-email?token=${encodeURIComponent(token)}`);
      await expect(page.getByTestId('email-verification-success-message')).toBeVisible();
      await expect(page).toHaveURL(/\/verify-email\?token=/);
      expect(userField(email, 'email_verified')).toBe('true');
    } finally {
      deleteUser(email);
    }
  });

  test('the reset-request page loads directly, with the logo alone', async ({ page }) => {
    await page.goto('/reset-password-request');
    const reset = new PasswordResetPage(page);
    await expect(reset.requestForm).toBeVisible();
    await expect(reset.requestEmailInput).toHaveValue('');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/reset-password-request$/);
    const bar = page.getByTestId('app-bar');
    await expect(bar.getByAltText('Conventioner', { exact: true })).toBeVisible();
    await expect(bar.getByRole('link')).toHaveCount(0);
    await expect(bar.getByRole('button')).toHaveCount(0);
  });
});

test.describe('Changing a password, signed in', () => {
  test('the whole way from the account menu, in one browser, and the new password signs in', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const email = uniqueEmail();
    const created = await request.post('/api/register-user', {
      data: { email, password: PASSWORD },
    });
    expect(created.ok()).toBeTruthy();
    try {
      mongoEval(
        `db.users.updateOne({email: ${JSON.stringify(email)}}, {$set: {email_verified: true}})`,
      );
      const signIn = new LoginPage(page);
      const account = page.getByTestId('app-bar-account-button');
      await signIn.login(email, PASSWORD);
      await expect(account).toHaveText(email);

      await account.click();
      await page.getByRole('menuitem', { name: 'Change password' }).click();
      const reset = new PasswordResetPage(page);
      await expect(reset.requestEmailInput).toHaveValue(email);

      // The address already there is all the page needs.
      await reset.clickRequestSubmit();
      await expect(reset.requestSuccessMessage).toBeVisible();
      const token = userField(email, 'password_reset_token');
      expect(token.length).toBeGreaterThanOrEqual(10);

      // The emailed link, opened in the browser still signed in.
      await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
      await expect(reset.resetForm).toBeVisible();
      await expect(account).toHaveText(email);
      await expect(reset.resetBackLink).toHaveText('Back to Markets');

      await reset.resetPassword(NEW_PASSWORD);
      await expect(reset.resetSuccessMessage).toBeVisible();
      // The reset ended every session of the account, this one with it.
      await expect(reset.resetBackLink).toHaveText('Back to sign in');

      // Signed out by what they just did, so it lands on sign-in with nothing to tell them.
      await expect(page).toHaveURL(/\/login$/);
      await expect(signIn.submitButton).toBeVisible();
      await expect(page.getByTestId('login-session-ended')).toHaveCount(0);
      await expect(account).toHaveCount(0);

      await signIn.login(email, PASSWORD);
      await expect(page.getByTestId('login-error-message')).toBeVisible();

      await signIn.login(email, NEW_PASSWORD);
      await expect(account).toHaveText(email);
    } finally {
      deleteUser(email);
    }
  });
});
