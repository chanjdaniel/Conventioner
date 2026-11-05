import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, VendorPage } from './fixtures';
import { MarketSetupPage } from './pages/MarketSetupPage';
import { OpenApplicationsDialog } from './pages/OpenApplicationsDialog';
import { ReviewersPanel } from './pages/ReviewersPanel';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
} from './helpers/seedApplicantMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { hideDevToolsPanel } from './helpers/hideDevToolsPanel';

/**
 * "Open applications" offers the reviewers (E38/F07/S02).
 *
 * On a market whose vendors apply on its own page, the owner presses the rail's "Open applications"
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
  await hideDevToolsPanel(context);
  try {
    const page = await context.newPage();
    const login = new VendorPage(page);
    await page.goto(`/${market.marketSlug}`);
    await login.requestCode(vendor);
    await expect(login.codeInput).toBeVisible();
    createApplicantLoginChallenge(market.marketId, vendor, CODE);
    await login.enterCode(CODE);
    await login.applyButton.click();
    await expect(login.form).toBeVisible({ timeout: 30000 });
    await login.fullNameInput.fill(`${name} Vendor`);
    await login.tierCheckbox(DATE, 'Gold').check();
    await login.maxDatesInput.fill('1');
    await login.tableChoiceRadio('full').check();
    await login.fillField('business_name', `${name} Prints`);
    await login.fillField('product_type', 'Letterpress cards');
    await login.submit();
    await expect(login.form).toHaveCount(0, { timeout: 10000 });
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
  const { currentPhase } = new MarketSetupPage(page);

  // Its keys are a dialog's: it opens on the picker's field, Escape closes the picker's list first
  // and then the dialog, writing nothing, and focus goes back to the rail's button.
  await opening.start();
  await expect(opening.dialog).toContainText('Open applications');
  await expect(opening.dialog).toContainText(
    'Choose no one and everyone reviews first come, first served.',
  );
  await expect(opening.chooser.field).toBeFocused();
  await expect(opening.chooser.chips).toHaveCount(0);
  await opening.chooser.choose(ANA);
  await page.keyboard.press('Escape');
  await expect(opening.chooser.list).toBeHidden();
  await expect(opening.dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(opening.dialog).toBeHidden();
  await expect(opening.opener).toBeFocused();
  await expect(currentPhase).toHaveText('Draft');

  // Cancel the same, and no one chosen then was kept.
  await opening.start();
  await expect(opening.chooser.chips).toHaveCount(0);
  await opening.cancel.click();
  await expect(opening.dialog).toBeHidden();
  await expect(opening.opener).toBeFocused();
  const untouched = await request.get(`${BACKEND_URL}/markets/${market.marketId}`);
  expect((await untouched.json()).market.reviewTeam.reviewers).toEqual([]);

  // Enter takes the match while the list is open; with it closed, Enter confirms, as the form's
  // submit.
  await opening.start();
  await opening.chooser.choose(ANA, BEN);
  await expect(opening.dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(opening.chooser.list).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(opening.dialog).toBeHidden();
  await expect(currentPhase).toHaveText('Applications', { timeout: 10000 });
  // It lands where the move always has.
  await expect(page).toHaveURL(/\/applications$/);
  await expect(new ReviewersPanel(page).line).toHaveText(`2 reviewers: ${ANA} and ${BEN}`);

  const first = await apply(browser, market, 'Iris');
  const second = await apply(browser, market, 'Jude');
  const dealt = await reviewerOf(page, market.marketId);
  expect([dealt[first], dealt[second]].sort()).toEqual([ANA, BEN]);
});

test('a second try after a move and a re-read that fail starts from the team written', async ({
  authenticatedPage: page,
  request,
}) => {
  const market = await draftWithPeople(request);
  await page.goto(marketScreenPath(market.marketId, 'setup'));
  const opening = new OpenApplicationsDialog(page);
  const { currentPhase } = new MarketSetupPage(page);
  await expect(opening.opener).toBeVisible();
  const out = /\/markets\/[^/]+(\/transition)?$/;
  await page.route(out, (route) => route.abort());
  const written: string[][] = [];
  page.on('request', (sent) => {
    if (sent.url().endsWith('/reviewers') && sent.method() === 'PUT') {
      written.push((sent.postDataJSON() as { reviewers: string[] }).reviewers);
    }
  });

  await opening.openWith(ANA);
  await expect(page.getByTestId('phase-rail-error')).toBeVisible();
  await expect(currentPhase).toHaveText('Draft');
  expect(written).toEqual([[ANA]]);

  await opening.start();
  await expect(opening.chooser.chips).toHaveCount(1);
  await expect(opening.chooser.chip(ANA)).toBeVisible();

  // Left as it is, nothing is written over the team; changed by one, it stands beside them.
  await page.unroute(out);
  await opening.chooser.choose(BEN);
  await opening.confirm.click();
  await expect(currentPhase).toHaveText('Applications', { timeout: 10000 });
  expect(written).toEqual([[ANA], [ANA, BEN]]);
});

test('opening with no one ticked opens as before: the first application is dealt to nobody', async ({
  authenticatedPage: page,
  request,
  browser,
}) => {
  const market = await draftWithPeople(request);
  await page.goto(marketScreenPath(market.marketId, 'setup'));
  await new OpenApplicationsDialog(page).openWith();
  await expect(new MarketSetupPage(page).currentPhase).toHaveText('Applications', {
    timeout: 10000,
  });
  await expect(new ReviewersPanel(page).none).toBeVisible();

  const vendor = await apply(browser, market, 'Kit');
  expect((await reviewerOf(page, market.marketId))[vendor]).toBeNull();
});
