import { test, expect, TEST_USER, BACKEND_URL, VendorPage } from './fixtures';
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
 * in memory: a reload, a direct link or a new page load signed the vendor out mid-form. The form
 * is on the vendor page itself now (ADR 0022), and Edit opens it on the saved answers.
 */
const DATE = '2099-08-01';
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

  const login = new VendorPage(page);
  await page.goto(`/${market.marketSlug}`);
  await login.requestCode(VENDOR);
  createApplicantLoginChallenge(market.marketId, VENDOR, CODE);
  await login.enterCode(CODE);
  await expect(login.signedInAs).toBeVisible();

  // Edit opens the form on the page while applications are open.
  await login.editButton.click();
  await expect(login.form).toBeVisible({ timeout: 30000 });

  // The saved answers, ready to change - not an empty form.
  await expect(login.fullNameInput).toHaveValue('Rowan Returning');
  await expect(login.input('business_name')).toHaveValue('Returning Ceramics');
  await expect(login.tierCheckbox(DATE, 'Gold')).toBeChecked();
  await expect(login.notAvailableCheckbox(DATE)).not.toBeChecked();

  // Cancel changes nothing: the answers stand as saved.
  await login.fillField('product_type', 'Never saved');
  await login.cancelButton.click();
  await expect(login.form).toHaveCount(0);
  await expect(login.answer('product_type')).toContainText('Mugs');
  await expect(login.answers).not.toContainText('Never saved');

  // A reload keeps them signed in, and keeps the answers.
  await page.reload();
  await expect(login.answer('business_name')).toContainText('Returning Ceramics', {
    timeout: 30000,
  });
  await login.editButton.click();
  await expect(login.input('business_name')).toHaveValue('Returning Ceramics');

  await login.fillField('product_type', 'Mugs and bowls');
  await login.submit();
  await expect(login.form).toHaveCount(0, { timeout: 10000 });
  await expect(login.answers).toContainText('Mugs and bowls');
  await expect(page).toHaveURL(new RegExp(`/${market.marketSlug}$`));

  // Once the market stops taking applications the answers are read, not changed (E38/F04/S02) -
  // and a direct link still finds the vendor signed in.
  const closed = await request.post(
    `${BACKEND_URL}/markets/${market.marketId}/applications-stopped`,
    {
      headers: { 'Content-Type': 'application/json' },
      data: { stopped: true },
    },
  );
  expect(closed.ok(), await closed.text()).toBeTruthy();
  await page.goto(`/${market.marketSlug}`);
  await expect(page.getByTestId('vendor-page-answers')).toContainText('Mugs and bowls', {
    timeout: 30000,
  });
  await expect(login.editButton).toHaveCount(0);
  await expect(login.form).toHaveCount(0);
});

test('a saved application that does not arrive is said so, never shown as none, and a retry brings it', async ({
  page,
  request,
}) => {
  // Loading the saved answers (bug 21) added a second request to the form page of old with no time
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
  const login = new VendorPage(page);
  await page.goto(`/${market.marketSlug}`);
  await login.requestCode('stalled-vendor@example.com');
  createApplicantLoginChallenge(market.marketId, 'stalled-vendor@example.com', CODE);

  // Your Application: the read fails outright.
  await page.route(saved, (route) =>
    route.request().method() === 'GET' ? route.abort('failed') : route.continue(),
  );
  await login.enterCode(CODE);
  await expect(page.getByTestId('vendor-page-load-failed')).toBeVisible();
  await expect(page.getByTestId('vendor-page-info')).toHaveCount(0);
  await page.unroute(saved);
  await page.getByTestId('vendor-page-retry-button').click();
  await expect(page.getByTestId('vendor-page-answers')).toContainText('Stalled Prints');

  // A reload, and this time the read never answers, as on a stalled stack: the page says so
  // within its bound, never "loading" for ever, and a retry brings the answers and the form.
  const held: Array<{ abort: () => Promise<void> }> = [];
  await page.route(saved, (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    held.push(route);
  });
  await page.reload();
  await expect(page.getByTestId('vendor-page-load-failed')).toBeVisible({ timeout: 25_000 });
  await page.unroute(saved);
  await Promise.all(held.map((route) => route.abort().catch(() => undefined)));
  await page.getByTestId('vendor-page-retry-button').click();
  await login.editButton.click();
  await expect(login.input('business_name')).toHaveValue('Stalled Prints');
});
