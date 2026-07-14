import {
  test,
  expect,
  TEST_USER,
  LoginPage,
  PasswordResetPage,
  AssignmentResultsPage,
} from './fixtures';
import { execSync } from 'child_process';
import { mongoContainer } from './helpers/containerNames';

const REGISTER_PASSWORD = 'E2eRegister123!';
const NEW_PASSWORD = 'E2eNewPass456!';
function uniqueEmail(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `e2e-auth-${ts}-${rand}@example.com`;
}

test.describe('Authentication journeys', () => {
  // ── Journey 1: Register new user ───────────────────────────────────
  test.describe('Register new user', () => {
    test('registers with valid credentials and shows success message', async ({
      page,
    }) => {
      const email = uniqueEmail();

      await page.route('**/register', async (route) => {
        const body = route.request().postDataJSON();
        expect(body.email).toBe(email);
        expect(body.password).toBe(REGISTER_PASSWORD);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            msg: 'User registered successfully. Please check your email to verify your account.',
          }),
        });
      });

      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.switchToRegister();
      await expect(loginPage.registerForm).toBeVisible();

      await loginPage.registerEmailInput.fill(email);
      await loginPage.registerPasswordInput.fill(REGISTER_PASSWORD);
      await loginPage.registerPasswordConfirmInput.fill(REGISTER_PASSWORD);
      await loginPage.registerSubmitButton.click();

      await expect(loginPage.registerSuccessMessage).toBeVisible({
        timeout: 10000,
      });
      await expect(loginPage.registerSuccessMessage).toContainText(
        'registered successfully',
      );
    });

    test('shows error when passwords do not match', async ({ page }) => {
      const email = uniqueEmail();

      // Intercept to prevent real API call (CAPTCHA key not set)
      await page.route('**/register', async (route) => {
        await route.abort();
      });

      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.switchToRegister();

      await loginPage.registerEmailInput.fill(email);
      await loginPage.registerPasswordInput.fill(REGISTER_PASSWORD);
      await loginPage.registerPasswordConfirmInput.fill('DifferentPass1!');
      await loginPage.registerSubmitButton.click();

      await expect(loginPage.registerErrorMessage).toBeVisible();
      await expect(loginPage.registerErrorMessage).toContainText(
        'do not match',
      );
    });
  });

  // ── Journey 2: Password reset full flow ────────────────────────────
  test.describe('Password reset', () => {
    test('requests password reset and shows success message', async ({
      page,
    }) => {
      const email = uniqueEmail();

      // Navigate via login page's "Forgot password?" link.
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.forgotPasswordLink.click();
      await page.waitForURL('**/reset-password-request', { timeout: 5000 });

      const resetPage = new PasswordResetPage(page);
      await expect(resetPage.requestForm).toBeVisible();

      // Intercept the API call so we can proceed without a real email service.
      await page.route('**/request-password-reset', async (route) => {
        const body = route.request().postDataJSON();
        expect(body.email).toBe(email);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            msg: 'If an account exists, a password reset email has been sent.',
          }),
        });
      });

      await resetPage.fillRequestEmail(email);
      await resetPage.clickRequestSubmit();

      await expect(resetPage.requestSuccessMessage).toBeVisible({
        timeout: 10000,
      });
    });

    test('completes full reset flow using real token from DB', async ({
      page,
      request,
    }) => {
      const email = uniqueEmail();

      // Step 1: Create a user via the back-end API (no CAPTCHA).
      const regRes = await request.post('/api/register-user', {
        data: { email, password: REGISTER_PASSWORD, organizations: [] },
        headers: { 'Content-Type': 'application/json' },
      });
      expect(regRes.ok()).toBeTruthy();

      try {
        // Step 2: Request a password reset via the back-end API to
        // store a real token in MongoDB.
        const resetReqRes = await request.post(
          '/api/request-password-reset',
          {
            data: { email },
            headers: { 'Content-Type': 'application/json' },
          },
        );
        expect(resetReqRes.ok()).toBeTruthy();

        // Step 3: Read the reset token directly from MongoDB.
        const token = execSync(
          `docker exec ${mongoContainer()} mongosh --quiet ` +
            `-u admin -p secret --authenticationDatabase admin ` +
            `--eval "db.getSiblingDB('conventioner').users.findOne({email:'${email}'}).password_reset_token"`,
          { encoding: 'utf-8', timeout: 10000 },
        )
          .trim()
          .replace(/^"/, '')
          .replace(/"$/, '');
        expect(token).toBeTruthy();
        expect(token.length).toBeGreaterThanOrEqual(10);

        // Step 4: Navigate to the reset page with the real token.
        // App.vue's onMounted calls /check-session and redirects on
        // failure; intercept it so the reset page can render.
        await page.route('**/check-session', async (route) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ email }),
          });
        });

        // Intercept the reset-password API call to verify the correct
        // payload is sent and to return success.
        let resetPayload: Record<string, unknown> | null = null;
        await page.route('**/reset-password', async (route) => {
          resetPayload = route.request().postDataJSON();
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ msg: 'Password reset successfully!' }),
          });
        });

        await page.goto(
          `/reset-password?token=${encodeURIComponent(token)}`,
        );

        const resetPage = new PasswordResetPage(page);
        await expect(resetPage.resetForm).toBeVisible({ timeout: 10000 });
        await resetPage.resetPassword(NEW_PASSWORD);

        await expect(resetPage.resetSuccessMessage).toBeVisible({
          timeout: 10000,
        });
        await expect(resetPage.resetSuccessMessage).toContainText(
          'successfully',
        );

        expect(resetPayload).toBeDefined();
        expect(resetPayload!.token).toBe(token);
        expect(resetPayload!.new_password).toBe(NEW_PASSWORD);
      } finally {
        await request.post('/api/delete-user', {
          data: { email },
          headers: { 'Content-Type': 'application/json' },
        });
      }
    });
  });

  // ── Journey 3: Post assignment to Discord ─────────────────────────
  test.describe('Discord posting', () => {
    test('sends assignment to Discord and shows success toast', async ({
      authenticatedPage: page,
    }) => {
      const webhookUrl = 'https://discord.com/api/webhooks/test/e2e';
      const marketId = `e2e-discord-${Date.now()}`;

      // Set market data in localStorage AFTER login (so App.vue session
      // check succeeds and doesn't clear our data).
      await page.evaluate(
        ({ market }) => {
          localStorage.setItem('market', JSON.stringify(market));
        },
        {
          market: {
            id: marketId,
            name: 'E2E Discord Market',
            creationDate: new Date().toISOString(),
            roles: {},
            roleEmails: {},
            phase: 'draft',
            isDraft: true,
            setupObject: null,
            modificationList: [],
            assignmentObject: {
              vendorAssignments: [],
              assignmentDate: new Date().toISOString(),
              totalVendorsAssigned: 2,
              totalTablesAssigned: 2,
              assignmentStatistics: null,
            },
            discordWebhookUrl: webhookUrl,
          },
        },
      );

      // Mock the assignment-statistics endpoint.
      await page.route('**/assignment-statistics', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            totalAssignments: 2,
            totalAssignedVendors: 2,
            totalAssignedTables: 2,
            totalVendors: 2,
            totalTables: 2,
            satisfactionScore: 1.0,
            assignmentsPerDate: { '2025-01-01': 2 },
            assignmentsPerSection: { A: 2 },
            assignmentsPerTier: { Gold: 2 },
            assignmentsPerTableChoice: { 'Full table': 2 },
            unassignedVendors: [],
            unassignedTables: {},
          }),
        });
      });

      // Intercept the Discord notify API call.
      await page.route('**/discord/notify-assignment', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Posted to Discord', status: 'ok' }),
        });
      });

      await page.goto('/assignment-results');

      const resultsPage = new AssignmentResultsPage(page);

      await expect(resultsPage.summaryStats).toBeVisible({ timeout: 10000 });
      await expect(resultsPage.sendToDiscordButton).toBeEnabled({
        timeout: 5000,
      });

      await resultsPage.clickSendToDiscord();

      await expect(resultsPage.discordToast).toBeVisible({ timeout: 5000 });
      await expect(resultsPage.discordToast).toContainText('Posted to Discord');
    });
  });

  // ── Journey 4: Login error states + session expiry ─────────────────
  test.describe('Login error states', () => {
    test('shows error for wrong password', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      await loginPage.fillEmail(TEST_USER.email);
      await loginPage.fillPassword('wrong-password-123');
      await loginPage.clickSubmit();

      await expect(loginPage.errorMessage).toBeVisible({ timeout: 10000 });
      await expect(loginPage.errorMessage).toContainText('Invalid credentials');
    });

    test('redirects to login when session is absent', async ({ page }) => {
      // Clear any stored user data to simulate expired/absent session
      await page.goto('/dashboard');
      // If no user in localStorage, the router guard redirects to /login
      await expect(page).toHaveURL(/login/, { timeout: 10000 });
    });

    test('redirects to login from protected route with no session', async ({
      page,
    }) => {
      await page.goto('/markets');
      await expect(page).toHaveURL(/login/, { timeout: 10000 });
    });

    test('shows error for invalid OTP code', async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();
      await loginPage.switchToOtp();
      await expect(loginPage.otpForm).toBeVisible();

      // Intercept the request-otp call so we can proceed without a real email
      await page.route('**/request-otp', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ msg: 'OTP sent' }),
        });
      });

      // Request OTP for the test user
      await loginPage.otpEmailInput.fill(TEST_USER.email);
      await loginPage.otpSubmitButton.click();

      // Wait for the OTP code input to appear
      await expect(loginPage.otpCodeInput).toBeVisible({ timeout: 10000 });

      // Submit with a wrong OTP
      await loginPage.otpCodeInput.fill('000000');
      await loginPage.otpSubmitButton.click();

      await expect(loginPage.otpErrorMessage).toBeVisible({ timeout: 10000 });
      await expect(loginPage.otpErrorMessage).toContainText(/Invalid OTP|Too many failed attempts/);
    });
  });
});
