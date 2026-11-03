import { test, expect, TEST_USER, BACKEND_URL, VendorPage } from './fixtures';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
} from './helpers/seedApplicantMarket';
import { mongoEval } from './helpers/mongo';

/**
 * A vendor who has never applied can apply online (bug 6, E26/F07/S01).
 *
 * The "Vendors apply on this market's page" option could not take a single new application: a
 * code went only to an address that already had one, and signing in issued a token only when it
 * found one - so a new address was sent nothing and, with a code in hand, was returned to "Sign
 * In" with no word. Every other spec seeds the application before signing in, so none met this.
 */
const DATE = '2099-08-01';
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
  const login = new VendorPage(page);
  await page.goto(`/${market.marketSlug}`);
  await login.requestCode(NEW_VENDOR);
  await expect(login.codeInput).toBeVisible();

  // Email is off on this stack, so the code the vendor would read is planted in its place.
  createApplicantLoginChallenge(market.marketId, NEW_VENDOR, CODE);
  await login.enterCode(CODE);

  // Signed in with nothing to load: "Apply", not "Sign In" again, then the empty form, on the
  // market's own address (ADR 0022).
  await expect(login.info).toContainText('You have not applied to this market yet.');
  await login.applyButton.click();
  await expect(login.form).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(new RegExp(`/${market.marketSlug}$`));
  await expect(login.essentialEmail).toContainText(NEW_VENDOR);

  await login.fullNameInput.fill('Ada Newcomer');
  await login.tierCheckbox(DATE, 'Gold').check();
  await login.maxDatesInput.fill('1');
  await login.tableChoiceRadio('full').check();
  await login.fillField('business_name', 'Newcomer Prints');
  await login.fillField('product_type', 'Letterpress cards');
  await login.submit();

  await expect(login.form).toHaveCount(0, { timeout: 10000 });
  await expect(login.status).toContainText('Submitted');
  await expect(login.answers).toContainText('Newcomer Prints');
});

/**
 * "Submitted" until results are published, whatever happened (E36/F05/S01). The rules judge an
 * application as it is saved, so "Under Review" beside "Submitted" told this vendor a rule had
 * rejected them the moment they pressed Submit.
 */
test('a vendor a rule rejects as they apply reads "Submitted", as anyone would', async ({
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
  const rule = await request.put(`${BACKEND_URL}/markets/${market.marketId}/rejection-rules`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
    data: { rules: [{ key: 'essential_table_choice', answers: ['full'] }] },
  });
  expect(rule.ok(), await rule.text()).toBeTruthy();

  const vendor = 'turned-away-vendor@example.com';
  const login = new VendorPage(page);
  await page.goto(`/${market.marketSlug}`);
  await login.requestCode(vendor);
  createApplicantLoginChallenge(market.marketId, vendor, CODE);
  await login.enterCode(CODE);
  await login.applyButton.click();

  await login.fullNameInput.fill('Turned Away');
  await login.tierCheckbox(DATE, 'Gold').check();
  await login.maxDatesInput.fill('1');
  await login.tableChoiceRadio('full').check();
  await login.fillField('business_name', 'Turned Away Goods');
  await login.fillField('product_type', 'Candles');
  await login.submit();

  await expect(login.form).toHaveCount(0, { timeout: 10000 });
  const status = page.getByTestId('vendor-page-status');
  await expect(status).toContainText('Submitted');
  await expect(status).not.toContainText('Review');
  // And the rule did reject them: the organizer reads it, the vendor does not.
  expect(
    mongoEval(
      `db.applications.findOne({market_id: ${JSON.stringify(market.marketId)}, applicant_email: '${vendor}'}).status`,
    ).trim(),
  ).toBe('reviewer_rejected');
});

test('signing in does not assume the vendor has applied', async ({ page, request }) => {
  const market = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const login = new VendorPage(page);
  await page.goto(`/${market.marketSlug}`);

  await expect(page.getByTestId('vendor-sign-in-email-step')).not.toContainText('used to apply');
  await login.requestCode(NEW_VENDOR);
  // The same words for every address - and true for every address, since every one is sent a code.
  await expect(page.getByTestId('vendor-sign-in-code-step')).toContainText(
    "We've sent a code to first-time-vendor@example.com.",
  );
});
