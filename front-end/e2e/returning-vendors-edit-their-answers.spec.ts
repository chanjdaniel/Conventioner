import { test, expect, TEST_USER, BACKEND_URL, ApplicantLoginPage } from './fixtures';
import { ApplyPage } from './pages/ApplyPage';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
} from './helpers/seedApplicantMarket';
import { seedApprovedVendor } from './helpers/seedApplication';

/**
 * A returning vendor changes their answers without retyping them, and a reload does not sign them
 * out (bugs 21 and 36, E26/F07/S03).
 *
 * The apply page started from an empty form and never loaded the stored application, so a vendor
 * had to answer every required question again - and "Not available" came pre-ticked on days they
 * had answered. Your Application had no way to the apply page at all. And the sign-in lived only
 * in memory: a reload, a direct link or a new page load signed the vendor out mid-form.
 */
const DATE = '2026-08-01';
const VENDOR = 'editing-vendor@example.com';
const CODE = '975310';

test('a returning vendor sees their answers, changes one, and stays signed in through reloads', async ({
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
  seedApprovedVendor(market.marketId, VENDOR, {
    dates: [DATE],
    tiers: ['Gold'],
    maxDates: 1,
    sections: ['Main Hall', 'Garden'],
    fullName: 'Rowan Returning',
    extra: { business_name: 'Returning Ceramics', product_type: 'Mugs' },
  });

  const login = new ApplicantLoginPage(page);
  await page.goto(`/${market.marketSlug}/applicant-login`);
  await login.requestCode(VENDOR);
  createApplicantLoginChallenge(market.marketId, VENDOR, CODE);
  await login.enterCode(CODE);
  await page.waitForURL(new RegExp(`/${market.marketSlug}/applicant/dashboard`));

  // Your Application leads to the form while applications are open.
  await page.getByTestId('applicant-dashboard-edit-link').click();
  const apply = new ApplyPage(page);
  await expect(apply.form).toBeVisible({ timeout: 30000 });

  // The saved answers, ready to change - not an empty form.
  await expect(apply.fullNameInput).toHaveValue('Rowan Returning');
  await expect(apply.input('business_name')).toHaveValue('Returning Ceramics');
  await expect(apply.tierCheckbox(DATE, 'Gold')).toBeChecked();
  await expect(apply.notAvailableCheckbox(DATE)).not.toBeChecked();

  // A reload keeps them signed in, and keeps the answers.
  await page.reload();
  await expect(apply.input('business_name')).toHaveValue('Returning Ceramics', { timeout: 30000 });

  await apply.fillField('product_type', 'Mugs and bowls');
  await apply.submit();
  await page.waitForURL(new RegExp(`/${market.marketSlug}/applicant/dashboard`));
  await expect(page.getByTestId('applicant-dashboard-answers')).toContainText('Mugs and bowls');

  // Once applications close the answers are read, not changed - and a direct link still finds
  // the vendor signed in.
  const closed = await request.post(`${BACKEND_URL}/markets/${market.marketId}/transition`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: { toPhase: 'applications_closed' },
  });
  expect(closed.ok(), await closed.text()).toBeTruthy();
  await page.goto(`/${market.marketSlug}/applicant/dashboard`);
  await expect(page.getByTestId('applicant-dashboard-answers')).toContainText('Mugs and bowls', {
    timeout: 30000,
  });
  await expect(page.getByTestId('applicant-dashboard-edit-link')).toHaveCount(0);
  await page.goto(`/${market.marketSlug}/apply`);
  await expect(page.getByTestId('apply-closed')).toBeVisible({ timeout: 30000 });
});

test('a saved application that does not arrive is said so, never shown as none, and a retry brings it', async ({
  page,
  request,
}) => {
  // Loading the saved answers (bug 21) added a second request to the apply page with no time
  // limit beside the form's 15 s one, so a stalled stack left the page loading for ever - the
  // state E06/F01/S01 had removed - and the same failure on Your Application read as "You have
  // not applied to this market yet." (E26, found as a CI flake on #88).
  test.setTimeout(90_000);
  const market = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject([DATE]) },
  );
  seedApprovedVendor(market.marketId, 'stalled-vendor@example.com', {
    dates: [DATE],
    tiers: ['Gold'],
    maxDates: 1,
    sections: ['Main Hall', 'Garden'],
    fullName: 'Sam Stalled',
    extra: { business_name: 'Stalled Prints', product_type: 'Prints' },
  });
  const saved = `**/public/markets/${market.marketSlug}/applicant/application`;
  const login = new ApplicantLoginPage(page);
  await page.goto(`/${market.marketSlug}/applicant-login`);
  await login.requestCode('stalled-vendor@example.com');
  createApplicantLoginChallenge(market.marketId, 'stalled-vendor@example.com', CODE);

  // Your Application: the read fails outright.
  await page.route(saved, (route) =>
    route.request().method() === 'GET' ? route.abort('failed') : route.continue(),
  );
  await login.enterCode(CODE);
  await page.waitForURL(new RegExp(`/${market.marketSlug}/applicant/dashboard`));
  await expect(page.getByTestId('applicant-dashboard-load-failed')).toBeVisible();
  await expect(page.getByTestId('applicant-dashboard-info')).toHaveCount(0);
  await page.unroute(saved);
  await page.getByTestId('applicant-dashboard-retry-button').click();
  await expect(page.getByTestId('applicant-dashboard-answers')).toContainText('Stalled Prints');

  // The apply page: the read never answers, as on a stalled stack.
  const held: Array<{ abort: () => Promise<void> }> = [];
  await page.route(saved, (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    held.push(route);
  });
  await page.goto(`/${market.marketSlug}/apply`);
  await expect(page.getByTestId('apply-load-failed')).toBeVisible({ timeout: 25_000 });
  await page.unroute(saved);
  await Promise.all(held.map((route) => route.abort().catch(() => undefined)));
  await page.getByTestId('apply-retry-button').click();
  await expect(new ApplyPage(page).input('business_name')).toHaveValue('Stalled Prints');
});
