import { execFileSync } from 'node:child_process';
import { test, expect, LoginPage, PasswordResetPage } from './fixtures';
import { mongoContainer } from './helpers/containerNames';
import { deleteUser } from './helpers/deleteUser';

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
  return execFileSync(
    'docker',
    [
      'exec',
      mongoContainer(),
      'mongosh',
      '--quiet',
      '-u',
      'admin',
      '-p',
      'secret',
      '--authenticationDatabase',
      'admin',
      '--eval',
      `print(db.getSiblingDB('conventioner').users.findOne({email: ${JSON.stringify(email)}}).${field})`,
    ],
    { encoding: 'utf-8', timeout: 10_000 },
  ).trim();
}

test.describe('Account links, opened signed out', () => {
  test('a real reset link shows the form, and the new password signs in', async ({
    page,
    request,
  }) => {
    const email = uniqueEmail();
    const created = await request.post('/api/register-user', {
      data: { email, password: PASSWORD, organizations: [] },
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
      execFileSync('docker', [
        'exec',
        mongoContainer(),
        'mongosh',
        '--quiet',
        '-u',
        'admin',
        '-p',
        'secret',
        '--authenticationDatabase',
        'admin',
        '--eval',
        `db.getSiblingDB('conventioner').users.updateOne({email: ${JSON.stringify(email)}}, {$set: {email_verified: true}})`,
      ]);
      await page.goto('/login');
      await new LoginPage(page).login(email, NEW_PASSWORD);
      await expect(page).toHaveURL(/\/dashboard/);
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

  test('the reset-request page loads directly, with no navigation menu', async ({ page }) => {
    await page.goto('/reset-password-request');
    await expect(new PasswordResetPage(page).requestForm).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/reset-password-request$/);
    await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveCount(0);
  });
});
