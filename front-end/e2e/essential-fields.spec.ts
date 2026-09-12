import { test, expect, BACKEND_URL, TEST_USER, ApplicationFormPage, ApplyPage } from './fixtures';
import { ApplicantLoginPage } from './pages/ApplicantLoginPage';
import { ensureTestOrg, loginViaApi } from './helpers/seeds';
import {
  seedApplicantMarket,
  seedApplicationDoc,
  createApplicantLoginChallenge,
  planSetupObject,
  PLAN_DATES,
} from './helpers/seedApplicantMarket';
import type { APIRequestContext, Page } from '@playwright/test';

/**
 * The essential form fields: the answers the assignment solver reads directly, present in
 * every application form.
 *
 * Three user stories, driven through the real UI:
 *   1. The organizer customises what the essential questions offer by editing the market plan
 *      (dates and sections through the setup wizard; table types come from the floorplan), and
 *      cannot remove the questions themselves.
 *   2. The applicant states their available dates, at most how many they want, and ranks their
 *      section and table type preferences.
 *   3. The offering freezes with the first recorded answer: a later plan edit never reaches
 *      the form (the D9 principle extended to the offering).
 */

const APPLICANT_EMAIL = 'applicant-e2e@example.com';
const KNOWN_CODE = '123456';

/** Create a market via the API with the given plan, and land on the setup view. */
async function createMarketWithPlan(
  page: Page,
  setupObject: Record<string, unknown>,
): Promise<string> {
  const ctx = page.request;
  await loginViaApi(ctx, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const orgsRes = await ctx.get(`${BACKEND_URL}/organizations`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
  });
  const orgs = (await orgsRes.json()).organizations as { id: string }[];
  const orgId = orgs[0]?.id;
  if (!orgId) throw new Error('No organization found');

  const marketName = `Essential Fields E2E ${Date.now()}`;
  const createRes = await ctx.post(`${BACKEND_URL}/markets`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: {
      name: marketName,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      roles: { [TEST_USER.email]: 'owner' },
      modificationList: [],
      assignmentObject: {},
      setupObject,
    },
  });
  if (!createRes.ok()) {
    throw new Error(`Market creation failed: ${createRes.status()} ${await createRes.text()}`);
  }
  const { market_id: marketId } = (await createRes.json()) as { market_id: string };

  const marketRes = await ctx.get(`${BACKEND_URL}/markets/${marketId}`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
  });
  const { market } = (await marketRes.json()) as { market: Record<string, unknown> };

  await page.evaluate(
    ({ m, user }) => {
      localStorage.setItem('market', JSON.stringify(m));
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('setupPageIdx', '0');
    },
    { m: market, user: TEST_USER.email },
  );

  await page.goto('/market-setup');
  return marketId;
}

/**
 * Sign an applicant in through the real login UI with a seeded known-code challenge, landing
 * on the apply page. The applicant session lives in memory (deliberately - no persisted
 * token), so the flow must reach the form the way an applicant does: via the login redirect,
 * not a fresh page load.
 */
async function signInApplicant(page: Page, marketId: string, marketSlug: string): Promise<void> {
  seedApplicationDoc(marketId, APPLICANT_EMAIL);
  createApplicantLoginChallenge(marketId, APPLICANT_EMAIL, KNOWN_CODE);

  // The real request-code call would overwrite the seeded known-code challenge, so it is
  // fulfilled without reaching the back end (same pattern as applicant.spec.ts).
  await page.route('**/applicant-login/request-code', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: "If an account exists for this email, we've sent a code." }),
    });
  });

  const login = new ApplicantLoginPage(page);
  await page.goto(`/${marketSlug}/applicant-login?redirect=apply`);
  await login.requestCode(APPLICANT_EMAIL);
  await expect(login.codeInput).toBeVisible({ timeout: 5000 });
  await login.enterCode(KNOWN_CODE);
  await page.waitForURL(new RegExp(`/${marketSlug}/apply`), { timeout: 5000 });
  await page.unroute('**/applicant-login/request-code');
}

/** An applicant JWT obtained through the real login endpoints, for API-level saves. */
async function applicantToken(
  request: APIRequestContext,
  marketId: string,
  marketSlug: string,
): Promise<string> {
  createApplicantLoginChallenge(marketId, APPLICANT_EMAIL, KNOWN_CODE);
  const verifyRes = await request.post(
    `${BACKEND_URL}/public/markets/${marketSlug}/applicant-login/verify-code`,
    { data: { email: APPLICANT_EMAIL, code: KNOWN_CODE } },
  );
  expect(verifyRes.ok()).toBeTruthy();
  const { token } = (await verifyRes.json()) as { token: string };
  expect(token).toBeTruthy();
  return token;
}

test.describe('Essential form fields', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  /**
   * Story 1: the essential questions are always in the form and cannot be removed; the
   * organizer customises what they offer by editing the market plan, and the form follows.
   */
  test('the organizer customises the essential offering through the market plan', async ({
    authenticatedPage: page,
  }, testInfo) => {
    const formPage = new ApplicationFormPage(page);
    // The plan starts with a floorplan (table types) but no dates and no sections yet.
    await createMarketWithPlan(page, {
      ...planSetupObject([]),
      sections: [],
    });

    // The essential questions are present before the organizer builds anything.
    await formPage.openFormTab();
    await expect(formPage.essentialPanel).toBeVisible();
    await expect(formPage.essentialBadge).toHaveText('Always included');
    await expect(formPage.essentialItem('email')).toContainText('signs in');
    // Offering not configured yet: the panel says so instead of showing empty questions.
    await expect(formPage.essentialDatesEmpty).toBeVisible();
    await expect(formPage.essentialSectionsEmpty).toBeVisible();
    // Table types already come from the plan's floorplan.
    await expect(formPage.essentialTableTypeChips).toHaveCount(2);
    await expect(formPage.essentialTableTypeChips.nth(0)).toContainText('Full Table');
    // Purpose-built, not custom fields: the panel offers no remove/reorder/edit controls.
    await expect(formPage.essentialPanel.locator('button')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('01-essential-panel-before-plan.png'),
      fullPage: true,
    });

    // The organizer adds market dates in the setup wizard...
    await formPage.openSetupTab();
    await page.getByTestId('setup-dates-add-button').click();
    await page.getByTestId('setup-dates-date-input-0').fill('2026-08-01');
    await page.getByTestId('setup-dates-add-button').click();
    await page.getByTestId('setup-dates-date-input-1').fill('2026-08-08');

    // ...and sections on the next wizard page (Next also persists the plan).
    await page.getByTestId('market-setup-next-button').click();
    await page.getByTestId('setup-section-add-button').click();
    await page.getByTestId('setup-section-name-input-0').fill('Main Hall');
    await page.getByTestId('setup-section-count-input-0').fill('4');
    await page.getByTestId('setup-section-add-button').click();
    await page.getByTestId('setup-section-name-input-1').fill('Garden');
    await page.getByTestId('setup-section-count-input-1').fill('2');
    await page.getByTestId('market-setup-back-button').click();

    // The essential questions now offer exactly what the plan defines.
    await formPage.openFormTab();
    await expect(formPage.essentialDateChips).toHaveCount(2);
    await expect(formPage.essentialDateChips.nth(0)).toContainText('August 1, 2026');
    await expect(formPage.essentialSectionChips).toHaveCount(2);
    await expect(formPage.essentialSectionChips.nth(0)).toContainText('Main Hall');
    await expect(formPage.essentialSectionChips.nth(1)).toContainText('Garden');
    // The applicant preview shows them exactly as the applicant will get them.
    await expect(formPage.previewEssential).toBeVisible();
    await expect(
      formPage.previewEssential.getByTestId('form-preview-essential-date-2026-08-01'),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('02-essential-panel-offering-from-plan.png'),
      fullPage: true,
    });

    // Custom fields may not squat on the essential namespace.
    await formPage.addField();
    await formPage.fillLabel(0, 'Business Name');
    await formPage.keyInput(0).fill('essential_business');
    await expect(formPage.validationError).toContainText('reserved "essential_" prefix');
    await formPage.keyInput(0).fill('business_name');
    await expect(formPage.saveButton).toBeEnabled();
    await formPage.save();
    await expect(formPage.saveSuccess).toBeVisible();

    // Everything survives a reload: the offering is derived server-side from the saved plan.
    await page.reload();
    await formPage.openFormTab();
    await expect(formPage.essentialDateChips).toHaveCount(2);
    await expect(formPage.essentialSectionChips).toHaveCount(2);
    await expect(formPage.essentialTableTypeChips).toHaveCount(2);
    await expect(formPage.previewField('business_name')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('03-essential-panel-after-reload.png'),
      fullPage: true,
    });
  });

  /**
   * Story 2: the applicant states available dates, at most how many they want, and ranks
   * section and table type preferences - and the persisted answers are exactly the shape the
   * solver will read.
   */
  test('the applicant answers the essential questions and the answers persist', async ({
    page,
    request,
  }, testInfo) => {
    const market = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { setupObject: planSetupObject() },
    );
    await signInApplicant(page, market.marketId, market.marketSlug);

    const apply = new ApplyPage(page);
    await expect(apply.form).toBeVisible();

    // Identity is settled before the form: the email rides along read-only.
    await expect(apply.essentialEmail).toContainText(APPLICANT_EMAIL);

    // Available dates: capability.
    await expect(apply.dateCheckbox(PLAN_DATES[0])).toBeVisible();
    await apply.dateCheckbox('2026-08-01').check();
    await apply.dateCheckbox('2026-08-08').check();

    // Max dates: appetite - available on two dates, wants at most two.
    await apply.maxDatesInput.fill('2');

    // Rankings arrive seeded in the plan's order; the applicant reorders with the arrows.
    await expect(apply.sectionRankName(0)).toHaveText('Main Hall');
    await apply.sectionRankUp(1).click();
    await expect(apply.sectionRankName(0)).toHaveText('Garden');
    await expect(apply.sectionRankName(1)).toHaveText('Main Hall');

    await expect(apply.tableTypeRankName(0)).toHaveText('Full Table');
    await apply.tableTypeRankDown(0).click();
    await expect(apply.tableTypeRankName(0)).toHaveText('Half Table');

    await apply.fillField('business_name', 'Vermilion Ceramics');
    await apply.fillField('product_type', 'Hand-thrown pottery');

    await page.screenshot({
      path: testInfo.outputPath('04-applicant-essential-fields.png'),
      fullPage: true,
    });

    // A first-time applicant is likelier on a phone; the essential block must read there too.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath('05-applicant-essential-fields-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });

    await apply.submit();
    await page.waitForURL(new RegExp(`/${market.marketSlug}/applicant/dashboard`), {
      timeout: 5000,
    });

    // The dashboard reads the answers back with the questions' own labels.
    const answers = page.getByTestId('applicant-dashboard-answers');
    await expect(
      answers.getByTestId('applicant-dashboard-answer-essential_available_dates'),
    ).toContainText('August 1, 2026');
    await expect(
      answers.getByTestId('applicant-dashboard-answer-essential_max_dates'),
    ).toContainText('2');
    await expect(
      answers.getByTestId('applicant-dashboard-answer-essential_section_ranking'),
    ).toContainText('1. Garden');
    await expect(
      answers.getByTestId('applicant-dashboard-answer-essential_table_type_ranking'),
    ).toContainText('1. Half Table');
    await page.screenshot({
      path: testInfo.outputPath('06-applicant-dashboard-answers.png'),
      fullPage: true,
    });

    // The persisted shape is the contract the solver task consumes - pin it exactly.
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const appsRes = await request.get(`${BACKEND_URL}/markets/${market.marketId}/applications`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { applications } = (await appsRes.json()) as {
      applications: Array<{ applicantEmail: string; formData: Record<string, unknown> }>;
    };
    const app = applications.find((a) => a.applicantEmail === APPLICANT_EMAIL);
    expect(app).toBeTruthy();
    expect(app!.formData).toEqual({
      business_name: 'Vermilion Ceramics',
      product_type: 'Hand-thrown pottery',
      essential_available_dates: ['2026-08-01', '2026-08-08'],
      essential_max_dates: 2,
      essential_section_ranking: ['Garden', 'Main Hall'],
      essential_table_type_ranking: ['Half Table', 'Full Table'],
    });
  });

  /**
   * Story 3: the first recorded answer freezes the offering. A market plan edit afterwards
   * never reaches the form - there is no fourth date after applications arrive.
   */
  test('the essential offering freezes once an applicant has answered', async ({
    authenticatedPage: page,
    request,
  }, testInfo) => {
    const market = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { setupObject: planSetupObject() },
    );
    seedApplicationDoc(market.marketId, APPLICANT_EMAIL);
    const token = await applicantToken(request, market.marketId, market.marketSlug);

    // The applicant records answers against the three offered dates.
    const saveRes = await request.put(
      `${BACKEND_URL}/public/markets/${market.marketSlug}/applicant/application`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          formData: {
            business_name: 'Vermilion Ceramics',
            product_type: 'Pottery',
            essential_available_dates: ['2026-08-01'],
            essential_max_dates: 1,
            essential_section_ranking: ['Main Hall', 'Garden'],
            essential_table_type_ranking: ['Full Table', 'Half Table'],
          },
        },
      },
    );
    expect(saveRes.status()).toBe(200);

    // The organizer now wants a fourth date - the plan accepts it...
    const marketRes = await request.get(`${BACKEND_URL}/markets/${market.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market: marketDoc } = (await marketRes.json()) as {
      market: { setupObject: { marketDates: Array<{ date: string }> } } & Record<string, unknown>;
    };
    marketDoc.setupObject.marketDates.push({ date: '2026-08-22' });
    const putRes = await request.put(`${BACKEND_URL}/markets/${market.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
      data: marketDoc,
    });
    expect(putRes.ok()).toBeTruthy();

    // ...but the form's offering is frozen: the public form still offers the original three.
    const publicForm = await (
      await request.get(`${BACKEND_URL}/public/markets/${market.marketSlug}/application-form`)
    ).json();
    expect(publicForm.essential_options.dates).toEqual(PLAN_DATES);

    // An answer naming the new date is refused - it was never offered.
    const staleToken = await applicantToken(request, market.marketId, market.marketSlug);
    const sneakyRes = await request.put(
      `${BACKEND_URL}/public/markets/${market.marketSlug}/applicant/application`,
      {
        headers: { Authorization: `Bearer ${staleToken}` },
        data: {
          formData: {
            business_name: 'Vermilion Ceramics',
            product_type: 'Pottery',
            essential_available_dates: ['2026-08-22'],
            essential_max_dates: 1,
            essential_section_ranking: ['Main Hall', 'Garden'],
            essential_table_type_ranking: ['Full Table', 'Half Table'],
          },
        },
      },
    );
    expect(sneakyRes.status()).toBe(422);
    expect((await sneakyRes.json()).error).toContain('does not offer');

    // The builder tells the organizer the same story: locked form, frozen offering - the
    // panel shows three dates even though the local plan now carries four.
    await page.evaluate(
      ({ m, user }) => {
        localStorage.setItem('market', JSON.stringify(m));
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.setItem('setupPageIdx', '0');
      },
      { m: marketDoc, user: TEST_USER.email },
    );
    await page.goto('/market-setup');
    const formPage = new ApplicationFormPage(page);
    await formPage.openFormTab();
    await expect(formPage.lockBanner).toBeVisible();
    await expect(formPage.essentialDateChips).toHaveCount(3);
    await page.screenshot({
      path: testInfo.outputPath('07-essential-offering-frozen.png'),
      fullPage: true,
    });
  });
});
