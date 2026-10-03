import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, NO_ORG_USER, BACKEND_URL, LoginPage } from './fixtures';
import { marketSetupPath } from './helpers/marketScreens';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { seedPhaseMarket, transitionMarket } from './helpers/seedPhaseMarket';
import { seedMarketWithVendors } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';

/**
 * Every sentence says what is true (bugs 16, 17 and 42; E26/F10/S02).
 *
 * Each of these was said to a real organizer on the usage run, and each was false where it was
 * said: a form with 21 questions invited them to "Build the application form", a CSV market
 * promised applications would arrive by themselves, the essential questions left out the two
 * every form asks, an import refusal sent a market in Assignment back to a phase it cannot reach,
 * and the sign-in code was an "OTP".
 */

const PLAN = {
  priority: [],
  marketDates: [{ date: '2099-05-01' }],
  tiers: [],
  locations: [],
  sections: [],
  assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: null },
};

async function planned(request: APIRequestContext, marketId: string) {
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, PLAN);
}

test('the plan says what the application form is, not only what it could be', async ({
  authenticatedPage: page,
  request,
}) => {
  const empty = await seedDraftMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  await planned(request, empty.marketId);
  await page.goto(marketSetupPath(empty.marketId, 'setup'));
  await expect(page.getByTestId('plan-form-ready')).toContainText('Build the application form');

  const built = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  await planned(request, built.marketId);
  await page.goto(marketSetupPath(built.marketId, 'setup'));
  await expect(page.getByTestId('plan-form-built')).toContainText(
    'Your application form asks 2 questions of your own',
  );
  await expect(page.getByTestId('plan-form-ready')).toHaveCount(0);

  const open = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    {
      setupObject: planSetupObject(),
    },
  );
  await page.goto(marketSetupPath(open.marketId, 'setup'));
  await expect(page.getByTestId('plan-form-locked')).toContainText('can only be edited');
  await expect(page.getByTestId('plan-form-locked')).toContainText('See the application form');
});

test('an open market says where its applications come from', async ({
  authenticatedPage: page,
  request,
}) => {
  for (const [intakeMode, says] of [
    ['form', 'New ones will keep arriving here.'],
    ['csv', "Import them from your form's responses as they come in."],
  ] as const) {
    const { marketId } = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode },
    );
    await page.goto(marketSetupPath(marketId, 'applications'));
    await expect(page.getByTestId('market-setup-applications-condition')).toContainText(says);
  }
});

test('the essential questions list both names every form asks', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await planned(request, marketId);
  await page.goto(marketSetupPath(marketId, 'form'));
  const panel = page.getByTestId('essential-fields-panel');
  await expect(panel.getByTestId('essential-item-full-name')).toContainText('Full name');
  await expect(panel.getByTestId('essential-item-preferred-name')).toContainText('Preferred name');
  // And no essential answer is said to be asked by every market: some are a market's to drop.
  const highlights = page.getByTestId('review-highlights');
  await expect(highlights).not.toContainText('asked by every market');
  await expect(highlights.getByTestId('review-highlight-essential_full_name')).toContainText(
    'essential question',
  );
});

test('a market past review is not sent back to a phase it cannot reach to import', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await planned(request, marketId);
  for (const phase of ['applications_open', 'applications_closed', 'review', 'assignment']) {
    await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, phase);
  }
  await page.goto(marketSetupPath(marketId, 'applications'));
  const reason = page.getByTestId('market-setup-import-blocked-reason');
  await expect(reason).toContainText('past review, so it takes no more applications');
  await expect(reason).not.toContainText('Applications Closed');
});

test('a proposal does not call the dates unasked beside the tier grid that answers them', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedDraftMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const grid = 'For each day, choose all table tiers';
  const headers = [
    'Timestamp',
    'Email Address',
    `${grid} [Saturday, October 3]`,
    `${grid} [Saturday, October 10]`,
  ];
  const rows = Array.from(
    { length: 6 },
    (_, i) => `2026/05/0${i + 1} 9:14:03,v${i}@example.test,"Gold, Silver",${i % 2 ? 'Gold' : ''}`,
  );
  await page.goto(`/markets/${marketId}/start-from-csv`);
  await page.getByTestId('start-from-csv-file-input').setInputFiles({
    name: 'responses.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([headers.map((h) => `"${h}"`).join(','), ...rows].join('\n')),
  });
  // The grid's days name no year, so the proposal asks for one first.
  await page.getByTestId('start-from-csv-year-dialog-submit-button').click();
  await expect(page.getByTestId('proposal-row').first()).toBeVisible();
  const unasked = page.getByTestId('proposal-not-asked');
  await expect(unasked.filter({ hasText: 'Tier preference' })).toHaveCount(0);
  await expect(unasked.filter({ hasText: 'Available dates' })).toHaveCount(0);
});

test('the dashboard says where an organization comes from', async ({ page }) => {
  const login = new LoginPage(page);
  await login.login(NO_ORG_USER.email, NO_ORG_USER.password);
  await login.waitForDashboardRedirect();
  await expect(page.getByTestId('dashboard-no-market-yet')).toContainText(
    'create it under Organizations first',
  );
  await expect(page.getByTestId('dashboard-no-market-yet')).not.toContainText('the next screen');
});

test('a sign-in code is called a code', async ({ page }) => {
  const login = new LoginPage(page);
  await page.goto('/login');
  await login.tabOtp.click();
  // An address with no account is answered exactly as one with an account, and is never held by
  // the resend cooldown a real organizer's address is.
  await login.otpEmailInput.fill(`nobody-${Date.now()}@example.com`);
  await login.otpSubmitButton.click();
  await expect(login.otpSuccessMessage).toContainText('sign-in code');
  await expect(login.otpSuccessMessage).not.toContainText('OTP');
});
