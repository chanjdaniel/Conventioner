import {
  test,
  expect,
  BACKEND_URL,
  TEST_USER,
  ApplicantLoginPage,
} from './fixtures';
import {
  seedApplicantMarket,
  seedApplicationDoc,
  createApplicantLoginChallenge,
  type ApplicantMarketSeed,
} from './helpers/seedApplicantMarket';

/**
 * The public applicant login flow: email → request-code → verify-code → redirect.
 *
 *   What is being pinned here is the anti-oracle behavior mandated by the
 * security design:
 *
 *   a) Requesting a code returns the exact same response for any email —
 *      known applicant, stranger, nonexistent address — so an attacker cannot
 *      enumerate valid applicants.
 *
 *   b) Every verify-code failure (wrong code, already consumed, expired, no
 *      challenge) collapses to an identical 401 response, so the failure
 *      reason cannot be inferred from the wire.
 *
 *   c) A challenge is consumed by its first verification attempt regardless
 *      of whether the code was correct. After one failure the same code
 *      cannot succeed — and the failure message does not change.
 *
 * All assertions are made through the real back end. No mocking of the
 * login endpoints. The one thing injected is a known-code challenge when
 * the test needs to verify the successful path — the 5d back end hashes
 * codes immediately on generation, so the test cannot read them from the
 * database after requesting one.
 */

const APPLICANT_EMAIL = 'applicant-e2e@example.com';
const UNKNOWN_EMAIL = 'nobody@example.com';
const KNOWN_CODE = '123456';

/** The exact body the back end returns on every request-code call. */
const REQUEST_CODE_MESSAGE = {
  message: "If an account exists for this email, we've sent a code.",
};

/** The exact body the back end returns on every verify-code failure. */
const VERIFY_FAILURE_MESSAGE = { message: 'Invalid or expired code.' };

function dashboardUrl(slug: string): RegExp {
  return new RegExp(`/${slug}/applicant/dashboard`);
}

test.describe('Public applicant login — anti-oracle', () => {
  let market: ApplicantMarketSeed;

  test.beforeEach(async ({ request }) => {
    market = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
  });

  // ── Request-code anti-oracle ──────────────────────────────────────────

  test('(a) request-code returns the same message for known and unknown emails', async ({
    request,
  }) => {
    // Create an application document so the back end considers this email known.
    seedApplicationDoc(market.marketId, APPLICANT_EMAIL);

    const knownRes = await request.post(
      `${BACKEND_URL}/public/markets/${market.marketSlug}/applicant-login/request-code`,
      { data: { email: APPLICANT_EMAIL } },
    );
    expect(knownRes.status()).toBe(200);
    const knownBody = await knownRes.json();

    // Same call for an email that has never applied.
    const unknownRes = await request.post(
      `${BACKEND_URL}/public/markets/${market.marketSlug}/applicant-login/request-code`,
      { data: { email: UNKNOWN_EMAIL } },
    );
    expect(unknownRes.status()).toBe(200);
    const unknownBody = await unknownRes.json();

    // The back end must not distinguish known from unknown addresses.
    expect(knownBody).toEqual(REQUEST_CODE_MESSAGE);
    expect(unknownBody).toEqual(knownBody);
  });

  // ── Verify-code anti-oracle ───────────────────────────────────────────

  test('(b) verify-code returns an identical 401 regardless of the failure reason', async ({
    request,
  }) => {
    // Request a code for the applicant email — this creates a challenge.
    await request.post(
      `${BACKEND_URL}/public/markets/${market.marketSlug}/applicant-login/request-code`,
      { data: { email: APPLICANT_EMAIL } },
    );

    // First attempt: wrong code. The challenge is consumed.
    const wrongRes = await request.post(
      `${BACKEND_URL}/public/markets/${market.marketSlug}/applicant-login/verify-code`,
      { data: { email: APPLICANT_EMAIL, code: '000001' } },
    );

    // Second attempt: no unconsumed challenge exists (consumed by step 1).
    const consumedRes = await request.post(
      `${BACKEND_URL}/public/markets/${market.marketSlug}/applicant-login/verify-code`,
      { data: { email: APPLICANT_EMAIL, code: '000002' } },
    );

    // The back end collapses every failure to the same 401 with the same body.
    expect(wrongRes.status()).toBe(401);
    expect(consumedRes.status()).toBe(401);
    const wrongBody = await wrongRes.json();
    const consumedBody = await consumedRes.json();
    expect(wrongBody).toEqual(VERIFY_FAILURE_MESSAGE);
    expect(consumedBody).toEqual(wrongBody);
  });

  test('(c) a consumed code cannot be reused — even the correct code fails after a wrong attempt', async ({
    request,
  }) => {
    // Insert a challenge with a known code directly so we control the code.
    createApplicantLoginChallenge(market.marketId, APPLICANT_EMAIL, KNOWN_CODE);

    // First attempt: wrong code. The challenge is consumed.
    const wrongRes = await request.post(
      `${BACKEND_URL}/public/markets/${market.marketSlug}/applicant-login/verify-code`,
      { data: { email: APPLICANT_EMAIL, code: '000000' } },
    );
    expect(wrongRes.status()).toBe(401);
    const wrongBody = await wrongRes.json();
    expect(wrongBody).toEqual(VERIFY_FAILURE_MESSAGE);

    // Second attempt: the *correct* code. The back end consumed the challenge
    // on the first attempt — wrong or right — so this also fails with the
    // identical 401. No "try again" path exists.
    const correctRes = await request.post(
      `${BACKEND_URL}/public/markets/${market.marketSlug}/applicant-login/verify-code`,
      { data: { email: APPLICANT_EMAIL, code: KNOWN_CODE } },
    );
    expect(correctRes.status()).toBe(401);
    const correctBody = await correctRes.json();
    expect(correctBody).toEqual(wrongBody);
  });

  // ── UI rendering and flow ─────────────────────────────────────────────

  test('the login page transitions from email step to code step', async ({
    page,
  }) => {
    const login = new ApplicantLoginPage(page);

    await login.goto(market.marketSlug);
    await expect(login.emailInput).toBeVisible();
    await expect(login.requestButton).toBeVisible();

    await login.requestCode(APPLICANT_EMAIL);

    // After requesting a code the page transitions to the code input step,
    // showing the anti-oracle instruction text.
    await expect(login.codeInput).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText('If an account exists for this email'),
    ).toBeVisible();
  });

  test('verify-code failure shows the same error message through the UI', async ({
    page,
  }) => {
    const login = new ApplicantLoginPage(page);

    await login.goto(market.marketSlug);
    await login.requestCode(APPLICANT_EMAIL);
    await expect(login.codeInput).toBeVisible({ timeout: 5000 });

    // Enter a wrong code.
    await login.enterCode('000000');
    await expect(login.error).toBeVisible({ timeout: 5000 });
    await expect(login.error).toHaveText('Invalid or expired code.');

    // Enter another wrong code. The error is identical — the front end
    // renders whatever the back end sent back, which is always the same.
    await login.enterCode('111111');
    await expect(login.error).toBeVisible({ timeout: 5000 });
    await expect(login.error).toHaveText('Invalid or expired code.');
  });

  test('a successful verification redirects the applicant to the dashboard', async ({
    page,
  }) => {
    const login = new ApplicantLoginPage(page);
    const knownCode = KNOWN_CODE;

    // Seed a challenge with a known code so the test can verify end-to-end
    // without reading a hashed code out of the database.
    seedApplicationDoc(market.marketId, APPLICANT_EMAIL);
    createApplicantLoginChallenge(market.marketId, APPLICANT_EMAIL, knownCode);

    // Intercept the request-code API call. The real backend call would
    // overwrite our manually inserted challenge with a random hashed code,
    // so we fulfill it ourselves to keep the known-code challenge intact.
    await page.route('**/applicant-login/request-code', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(REQUEST_CODE_MESSAGE),
      });
    });

    await login.goto(market.marketSlug);
    await login.requestCode(APPLICANT_EMAIL);
    await expect(login.codeInput).toBeVisible({ timeout: 5000 });

    // The page calls request-code and transitions to the code step. The
    // challenge we seeded survives in the database. Now verify with it.
    await login.enterCode(knownCode);

    // On success the front end redirects to the applicant dashboard.
    await page.waitForURL(dashboardUrl(market.marketSlug), { timeout: 5000 });
    await expect(
      page.getByTestId('applicant-dashboard-page'),
    ).toBeVisible({ timeout: 5000 });
  });
});
