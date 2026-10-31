import { test, expect, TEST_USER, BACKEND_URL, ApplicantLoginPage } from './fixtures';
import { ApplyPage } from './pages/ApplyPage';
import { VendorsPage } from './pages/VendorsPage';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
} from './helpers/seedApplicantMarket';
import { seedApplicationWithStatus } from './helpers/seedPhaseMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';

/**
 * Each new application is dealt to the next reviewer as it arrives (E38/F07/S03).
 *
 * Three reviewers are chosen on an own-form market holding three open applications, one each; a
 * fourth vendor applies on the market's page, and their application is dealt to the first reviewer
 * again, which the organizer's list answers and the vendor's own History tab says.
 */
const PASSWORD = 'e2epassword123';
const DATE = '2099-08-01';
const CODE = '135790';
const REVIEWERS = [
  'e2e-reviewers-ana@example.com',
  'e2e-reviewers-ben@example.com',
  'e2e-reviewers-cat@example.com',
];

test('a vendor who applies after the deal goes to the next reviewer in turn', async ({
  page,
  request,
  browser,
}) => {
  for (const email of REVIEWERS) ensureVerifiedUser(email, PASSWORD);
  const market = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    {
      setupObject: planSetupObject([DATE]),
    },
  );
  const api = `${BACKEND_URL}/markets/${market.marketId}`;
  for (const email of ['v1@moss.test', 'v2@moss.test', 'v3@moss.test']) {
    seedApplicationWithStatus(market.marketId, 'open', email);
  }
  for (const email of REVIEWERS) {
    const res = await request.post(`${api}/roles`, { data: { user_email: email, role: 'viewer' } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  const chosen = await request.put(`${api}/reviewers`, { data: { reviewers: REVIEWERS } });
  expect(chosen.ok(), await chosen.text()).toBeTruthy();
  expect((await chosen.json()).dealt).toBe(3);

  // A fourth vendor applies on the market's own page, an address of this run's own.
  const vendor = `v4-${Date.now()}@moss.test`;
  const login = new ApplicantLoginPage(page);
  await page.goto(`/${market.marketSlug}/applicant-login?redirect=apply`);
  await login.requestCode(vendor);
  await expect(login.codeInput).toBeVisible();
  createApplicantLoginChallenge(market.marketId, vendor, CODE);
  await login.enterCode(CODE);
  const apply = new ApplyPage(page);
  await expect(apply.form).toBeVisible({ timeout: 30000 });
  await apply.fullNameInput.fill('Vera Fourth');
  await apply.tierCheckbox(DATE, 'Gold').check();
  await apply.maxDatesInput.fill('1');
  await apply.tableChoiceRadio('full').check();
  await apply.fillField('business_name', 'Fourth Prints');
  await apply.fillField('product_type', 'Letterpress cards');
  await apply.submit();
  await page.waitForURL(new RegExp(`/${market.marketSlug}/applicant/dashboard`));

  await withUser(browser, TEST_USER.email, TEST_USER.password, async (organizer) => {
    const listed = organizer.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        response.request().resourceType() !== 'document' &&
        response.url().endsWith(`/markets/${market.marketId}/applications`),
    );
    await organizer.goto(marketScreenPath(market.marketId, 'applications'));
    const body = (await (await listed).json()) as {
      applications: Array<{ applicantEmail: string; reviewer: { email: string } | null }>;
    };
    const reviewerOf = Object.fromEntries(
      body.applications.map((row) => [row.applicantEmail, row.reviewer?.email ?? null]),
    );
    expect(
      ['v1@moss.test', 'v2@moss.test', 'v3@moss.test', vendor].map((v) => reviewerOf[v]),
    ).toEqual([...REVIEWERS, REVIEWERS[0]]);

    // Their own history says so, and nobody is named as having dealt it.
    await organizer.goto(
      `${marketScreenPath(market.marketId, 'vendors')}?vendor=${encodeURIComponent(vendor)}&vendorTab=history`,
    );
    await expect(new VendorsPage(organizer).detailHistorySentences.first()).toHaveText(
      `The application was dealt to ${REVIEWERS[0]} as it arrived`,
    );
  });
});
