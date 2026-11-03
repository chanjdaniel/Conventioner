import { test, expect, BACKEND_URL, TEST_USER, VendorPage } from './fixtures';
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
 *   a) Requesting a code returns the exact same response for any email -
 *      known applicant, stranger, nonexistent address - so an attacker cannot
 *      enumerate valid applicants.
 *
 *   b) A wrong try at a live code answers "retry", and every way a code
 *      cannot pass (the fifth wrong try, already used, expired, no challenge)
 *      collapses to one identical 401 "spent", so the wire says nothing of
 *      whether an address applied (T202).
 *
 *   c) A code takes five tries: after the fifth wrong one even the right
 *      code fails, with the same "spent" answer.
 *
 * All assertions are made through the real back end. No mocking of the
 * login endpoints. The one thing injected is a known-code challenge when
 * the test needs to verify the successful path - the 5d back end hashes
 * codes immediately on generation, so the test cannot read them from the
 * database after requesting one.
 */

const APPLICANT_EMAIL = 'applicant-e2e@example.com';
const UNKNOWN_EMAIL = 'nobody@example.com';
const KNOWN_CODE = '123456';

/** The exact body the back end returns on every request-code call. */
const REQUEST_CODE_MESSAGE = {
  message: "We've sent a code to this address.",
};

/** A wrong try at a code with tries left. */
const RETRY = {
  message: "That code isn't right. Check you typed the newest code and try again.",
  codeState: 'retry',
};

/** Every way a code cannot pass, one body for all. */
const SPENT = {
  message: 'That code no longer works. Send yourself a new code.',
  codeState: 'spent',
};

test.describe('Public applicant login - anti-oracle', () => {
  let market: ApplicantMarketSeed;

  test.beforeEach(async ({ request }) => {
    market = await seedApplicantMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
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

  test('(b) verify-code answers a wrong try "retry" and every dead code one identical "spent"', async ({
    request,
  }) => {
    const verify = (email: string, code: string) =>
      request.post(
        `${BACKEND_URL}/public/markets/${market.marketSlug}/applicant-login/verify-code`,
        { data: { email, code } },
      );
    createApplicantLoginChallenge(market.marketId, APPLICANT_EMAIL, KNOWN_CODE);

    const wrongRes = await verify(APPLICANT_EMAIL, '000001');
    expect(wrongRes.status()).toBe(401);
    expect(await wrongRes.json()).toEqual(RETRY);

    // Used: the right code signs in once, then answers as a code never asked for does.
    expect((await verify(APPLICANT_EMAIL, KNOWN_CODE)).status()).toBe(200);
    const usedRes = await verify(APPLICANT_EMAIL, KNOWN_CODE);
    const neverAskedRes = await verify(UNKNOWN_EMAIL, KNOWN_CODE);

    expect(usedRes.status()).toBe(401);
    expect(neverAskedRes.status()).toBe(401);
    expect(await usedRes.text()).toEqual(await neverAskedRes.text());
    expect(await usedRes.json()).toEqual(SPENT);
  });

  test('(c) after five wrong tries even the right code fails', async ({ request }) => {
    // An address of its own: six tries here would leave the others under the per-address limit's
    // ten in a quarter of an hour with too few to run.
    const vendor = `five-tries-${Date.now()}@example.com`;
    createApplicantLoginChallenge(market.marketId, vendor, KNOWN_CODE);
    const verify = (code: string) =>
      request.post(
        `${BACKEND_URL}/public/markets/${market.marketSlug}/applicant-login/verify-code`,
        { data: { email: vendor, code } },
      );

    for (const wrong of ['000001', '000002', '000003', '000004']) {
      expect(await (await verify(wrong)).json()).toEqual(RETRY);
    }
    expect(await (await verify('000005')).json()).toEqual(SPENT);

    const correctRes = await verify(KNOWN_CODE);
    expect(correctRes.status()).toBe(401);
    expect(await correctRes.json()).toEqual(SPENT);
  });

  // ── UI rendering and flow ─────────────────────────────────────────────

  test("the vendor page's sign-in goes from the email step to the code step", async ({ page }) => {
    const login = new VendorPage(page);

    await login.goto(market.marketSlug);
    await expect(login.emailInput).toBeVisible();
    await expect(login.requestButton).toBeVisible();

    await login.requestCode(APPLICANT_EMAIL);

    // After requesting a code the page transitions to the code input step, saying the same thing
    // to every address - and true of every address, since each is sent a code (E26/F07/S01).
    await expect(login.codeInput).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText(`We've sent a code to ${APPLICANT_EMAIL}. Only the newest one works.`),
    ).toBeVisible();
  });

  test('a wrong code says so through the UI, and the field is ready for another', async ({
    page,
  }) => {
    const login = new VendorPage(page);

    await login.goto(market.marketSlug);
    await login.requestCode(APPLICANT_EMAIL);
    await expect(login.codeInput).toBeVisible({ timeout: 5000 });

    // A wrong code, and another: each says the same, and neither says whether the address applied.
    await login.enterCode('000000');
    await expect(login.error).toHaveText(RETRY.message);
    await expect(login.codeInput).toHaveValue('');

    await login.enterCode('111111');
    await expect(login.error).toHaveText(RETRY.message);
  });

  test('a successful verification signs the vendor in on the page', async ({ page }) => {
    const login = new VendorPage(page);
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

    // On success the page signs them in where they are, at the market's own address.
    await expect(login.signedInAs).toContainText(APPLICANT_EMAIL, { timeout: 5000 });
    await expect(page).toHaveURL(new RegExp(`/${market.marketSlug}$`));
    await expect(login.status).toContainText('Submitted');
  });
});
