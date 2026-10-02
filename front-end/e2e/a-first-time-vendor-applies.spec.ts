import { test, expect, TEST_USER, BACKEND_URL, ApplicantLoginPage } from './fixtures';
import { ApplyPage } from './pages/ApplyPage';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
} from './helpers/seedApplicantMarket';

/**
 * A vendor who has never applied can apply online (bug 6, E26/F07/S01).
 *
 * The "Vendors apply on this market's page" option could not take a single new application: a
 * code went only to an address that already had one, and signing in issued a token only when it
 * found one - so a new address was sent nothing and, with a code in hand, was returned to "Sign
 * In" with no word. Every other spec seeds the application before signing in, so none met this.
 */
const DATE = '2026-08-01';
const NEW_VENDOR = 'first-time-vendor@example.com';
const CODE = '246810';

test('a brand-new address requests a code, signs in, applies and sees it submitted', async ({
  page,
  request,
}) => {
  const market = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject([DATE]) },
  );

  // The real request, through the page.
  const login = new ApplicantLoginPage(page);
  await page.goto(`/${market.marketSlug}/applicant-login?redirect=apply`);
  await login.requestCode(NEW_VENDOR);
  await expect(login.codeInput).toBeVisible();

  // Email is off on this stack, so the code the vendor would read is planted in its place.
  createApplicantLoginChallenge(market.marketId, NEW_VENDOR, CODE);
  await login.enterCode(CODE);

  // Signed in with nothing to load: the empty form, not "Sign In" again.
  const apply = new ApplyPage(page);
  await page.waitForURL(new RegExp(`/${market.marketSlug}/apply`));
  await expect(apply.form).toBeVisible({ timeout: 30000 });
  await expect(apply.essentialEmail).toContainText(NEW_VENDOR);

  await apply.fullNameInput.fill('Ada Newcomer');
  await apply.tierCheckbox(DATE, 'Gold').check();
  await apply.maxDatesInput.fill('1');
  await apply.tableChoiceRadio('full').check();
  await apply.fillField('business_name', 'Newcomer Prints');
  await apply.fillField('product_type', 'Letterpress cards');
  await apply.submit();

  await page.waitForURL(new RegExp(`/${market.marketSlug}/applicant/dashboard`));
  await expect(page.getByTestId('applicant-dashboard-status')).toContainText('Submitted');
  await expect(page.getByTestId('applicant-dashboard-answers')).toContainText('Newcomer Prints');
});

test('signing in does not assume the vendor has applied', async ({ page, request }) => {
  const market = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const login = new ApplicantLoginPage(page);
  await page.goto(`/${market.marketSlug}/applicant-login`);

  await expect(page.getByTestId('applicant-login-email-step')).not.toContainText('used to apply');
  await login.requestCode(NEW_VENDOR);
  // The same words for every address - and true for every address, since every one is sent a code.
  await expect(page.getByTestId('applicant-login-code-step')).toContainText(
    "We've sent a code to first-time-vendor@example.com.",
  );
});
