import { test, expect, BACKEND_URL, TEST_USER, ApplicantLoginPage } from './fixtures';
import { seedApplicantMarket } from './helpers/seedApplicantMarket';

/**
 * Nobody can use the applicant sign-in to flood an address with codes (T12).
 *
 * An address may be sent five codes in a quarter of an hour; past that the back end answers 429
 * with a Retry-After and sends nothing, and the sign-in screen says so in words. The limit is per
 * address whoever asks, so the first five are asked for over the API and the one past it through
 * the screen, as a vendor would meet it.
 */

const ALLOWED_PER_ADDRESS = 5;

test('asking for codes past the limit says to wait, and sends nothing more', async ({
  page,
  request,
}) => {
  const market = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const address = `flooded-${Date.now()}@example.com`;
  const requestCode = () =>
    request.post(
      `${BACKEND_URL}/public/markets/${market.marketSlug}/applicant-login/request-code`,
      { data: { email: address } },
    );

  for (let i = 0; i < ALLOWED_PER_ADDRESS; i += 1) {
    expect((await requestCode()).status()).toBe(200);
  }

  const login = new ApplicantLoginPage(page);
  await login.goto(market.marketSlug);
  await login.emailInput.fill(address);
  await login.requestButton.click();

  await expect(login.error).toHaveText(
    /^Too many sign-in attempts\. Please try again in \d+ minutes?\.$/,
  );
  await expect(page.getByTestId('applicant-login-email-step')).toBeVisible();
  await expect(login.codeInput).toHaveCount(0);

  const refused = await requestCode();
  expect(refused.status()).toBe(429);
  expect(Number(refused.headers()['retry-after'])).toBeGreaterThan(0);
});
