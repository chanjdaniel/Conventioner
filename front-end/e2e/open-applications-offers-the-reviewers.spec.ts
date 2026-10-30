import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, ApplicantLoginPage } from './fixtures';
import { ApplyPage } from './pages/ApplyPage';
import { OpenApplicationsDialog } from './pages/OpenApplicationsDialog';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
} from './helpers/seedApplicantMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';

/**
 * "Open Applications" offers the reviewers (E38/F07/S02).
 *
 * On a market whose vendors apply on its own page, the owner presses the rail's "Open Applications"
 * and chooses two reviewers in the dialog it opens; two vendors then apply, and each application is
 * dealt to a different reviewer. Another market opens with no one ticked, as markets always have,
 * and its first application is dealt to nobody.
 */
const PASSWORD = 'e2epassword123';
const DATE = '2099-08-01';
const CODE = '246813';
const ANA = 'e2e-opening-ana@example.com';
const BEN = 'e2e-opening-ben@example.com';

/** A draft market of the owner's whose vendors apply on its page, with Ana and Ben on it. */
async function draftWithPeople(request: APIRequestContext) {
  for (const email of [ANA, BEN]) ensureVerifiedUser(email, PASSWORD);
  const market = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject([DATE]), draft: true },
  );
  for (const email of [ANA, BEN]) {
    const res = await request.post(`${BACKEND_URL}/markets/${market.marketId}/roles`, {
      data: { user_email: email, role: 'viewer' },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  return market;
}

/** A vendor applies on the market's own page, in a browser of their own. */
async function apply(
  browser: Browser,
  market: { marketId: string; marketSlug: string },
  name: string,
) {
  const vendor = `${name.toLowerCase()}-${Date.now()}@moss.test`;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const login = new ApplicantLoginPage(page);
    await page.goto(`/${market.marketSlug}/applicant-login?redirect=apply`);
    await login.requestCode(vendor);
    await expect(login.codeInput).toBeVisible();
    createApplicantLoginChallenge(market.marketId, vendor, CODE);
    await login.enterCode(CODE);
    const form = new ApplyPage(page);
    await expect(form.form).toBeVisible({ timeout: 30000 });
    await form.fullNameInput.fill(`${name} Vendor`);
    await form.tierCheckbox(DATE, 'Gold').check();
    await form.maxDatesInput.fill('1');
    await form.tableChoiceRadio('full').check();
    await form.fillField('business_name', `${name} Prints`);
    await form.fillField('product_type', 'Letterpress cards');
    await form.submit();
    await page.waitForURL(new RegExp(`/${market.marketSlug}/applicant/dashboard`));
  } finally {
    await context.close();
  }
  return vendor;
}

/** Each application's reviewer, by vendor, from the list the Applications tab reads. */
async function reviewerOf(page: Page, marketId: string) {
  const listed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.request().resourceType() !== 'document' &&
      response.url().endsWith(`/markets/${marketId}/applications`),
  );
  await page.goto(marketScreenPath(marketId, 'applications'));
  const body = (await (await listed).json()) as {
    applications: Array<{ applicantEmail: string; reviewer: { email: string } | null }>;
  };
  return Object.fromEntries(
    body.applications.map((row) => [row.applicantEmail, row.reviewer?.email ?? null]),
  );
}

test('an Admin opens applications choosing two reviewers, and each new application is dealt to one of them', async ({
  authenticatedPage: page,
  request,
  browser,
}) => {
  const market = await draftWithPeople(request);
  await page.goto(marketScreenPath(market.marketId, 'setup'));
  const opening = new OpenApplicationsDialog(page);

  // Its keys are a dialog's: it opens on its first control, Escape closes it writing nothing, and
  // focus goes back to the rail's button.
  await opening.start();
  await expect(opening.dialog).toContainText('Open applications');
  await expect(opening.dialog).toContainText(
    'Choose no one and everyone reviews first come, first served.',
  );
  // The organization's other people are offered too, so the first control is whoever sorts first.
  await expect(opening.dialog.getByRole('checkbox').first()).toBeFocused();
  await expect(opening.choice(ANA)).not.toBeChecked();
  await opening.choice(ANA).check();
  await page.keyboard.press('Escape');
  await expect(opening.dialog).toBeHidden();
  await expect(opening.opener).toBeFocused();
  await expect(page.getByTestId('phase-rail-current')).toHaveText('Draft');

  // Cancel the same, and nothing ticked then was kept.
  await opening.start();
  await expect(opening.choice(ANA)).not.toBeChecked();
  await opening.cancel.click();
  await expect(opening.dialog).toBeHidden();
  await expect(opening.opener).toBeFocused();
  const untouched = await request.get(`${BACKEND_URL}/markets/${market.marketId}`);
  expect((await untouched.json()).market.reviewTeam.reviewers).toEqual([]);

  // Enter confirms, as the form's submit.
  await opening.start();
  await opening.choice(ANA).check();
  await opening.choice(BEN).check();
  await opening.choice(BEN).focus();
  await page.keyboard.press('Enter');
  await expect(opening.dialog).toBeHidden();
  await expect(page.getByTestId('phase-rail-current')).toHaveText('Applications', {
    timeout: 10000,
  });
  // It lands where the move always has.
  await expect(page).toHaveURL(/\/applications$/);
  await expect(page.getByTestId('reviewers-person')).toHaveText([ANA, BEN]);

  const first = await apply(browser, market, 'Iris');
  const second = await apply(browser, market, 'Jude');
  const dealt = await reviewerOf(page, market.marketId);
  expect([dealt[first], dealt[second]].sort()).toEqual([ANA, BEN]);
});

test('opening with no one ticked opens as before: the first application is dealt to nobody', async ({
  authenticatedPage: page,
  request,
  browser,
}) => {
  const market = await draftWithPeople(request);
  await page.goto(marketScreenPath(market.marketId, 'setup'));
  await new OpenApplicationsDialog(page).openWith();
  await expect(page.getByTestId('phase-rail-current')).toHaveText('Applications', {
    timeout: 10000,
  });
  await expect(page.getByTestId('reviewers-none')).toBeVisible();

  const vendor = await apply(browser, market, 'Kit');
  expect((await reviewerOf(page, market.marketId))[vendor]).toBeNull();
});
