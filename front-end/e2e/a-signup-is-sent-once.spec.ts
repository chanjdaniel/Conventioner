import { test, expect, LoginPage, BACKEND_URL } from './fixtures';
import { mongoEval } from './helpers/mongo';

/**
 * A signup is sent once (E32/F03/S04).
 *
 * Production sent one address two "Verify your email address" emails 150 ms apart: the form sent
 * a second request while the first was in flight, and the server checked for the address and
 * inserted it as two steps, so both requests passed the check.
 */
const PASSWORD = 'e2epassword123';

function accountsFor(email: string): number {
  return Number(mongoEval(`db.users.countDocuments({ email: ${JSON.stringify(email)} })`));
}

async function fillRegistration(login: LoginPage, email: string) {
  await login.goto();
  await login.switchToRegister();
  await login.registerEmailInput.fill(email);
  await login.registerPasswordInput.fill(PASSWORD);
  await login.registerPasswordConfirmInput.fill(PASSWORD);
}

async function expectOneAccount(login: LoginPage, email: string) {
  await expect(login.registerSuccessMessage).toBeVisible({ timeout: 10000 });
  await expect.poll(() => accountsFor(email), { timeout: 5000 }).toBeGreaterThan(0);
  // Give a second request time to land, then count.
  await login.page.waitForTimeout(1500);
  expect(accountsFor(email)).toBe(1);
}

test('a double click on Register makes one account', async ({ page }) => {
  const email = `e2e-signup-${Date.now()}@example.com`;
  const login = new LoginPage(page);
  await fillRegistration(login, email);

  await login.registerSubmitButton.dblclick();

  await expectOneAccount(login, email);
});

test('Enter, then a click on Register, makes one account', async ({ page }) => {
  const email = `e2e-signup-enter-${Date.now()}@example.com`;
  const login = new LoginPage(page);
  await fillRegistration(login, email);

  await login.registerPasswordConfirmInput.press('Enter');
  // The click lands while the first request is in flight; force past the disabled state, as a
  // hand already on its way would.
  await login.registerSubmitButton.click({ force: true });

  await expectOneAccount(login, email);
});

test('two registrations racing for one address make one account', async ({ request }) => {
  // The server's half, past any button: only the unique index can settle this race.
  const email = `e2e-signup-race-${Date.now()}@example.com`;
  const register = (address: string) =>
    request.post(`${BACKEND_URL}/register`, {
      data: { email: address, password: PASSWORD, captcha_token: 'e2e-captcha' },
    });

  const answers = await Promise.all([register(email), register(email.toUpperCase())]);

  expect(answers.map((answer) => answer.status()).sort()).toEqual([201, 400]);
  expect(accountsFor(email)).toBe(1);
});
