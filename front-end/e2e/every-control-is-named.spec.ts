import { test, expect, TEST_USER, BACKEND_URL, LoginPage } from './fixtures';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { namelessControls } from './helpers/accessibleNames';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
} from './helpers/seedApplicantMarket';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { CsvImportPage } from './pages/CsvImportPage';
import { seedPhaseMarket } from './helpers/seedPhaseMarket';
import { savePlan } from './helpers/savePlan';

/**
 * Every control can be reached and named by assistive technology (bug 44; E26/F10/S03).
 *
 * The plan's name fields, the sign-in code and a form preview's checkbox were announced as nothing;
 * "More…" opened a list of plain buttons, not a menu; the sign-in page's tabs were buttons, not a
 * tab list; and the floorplan choice was not a dialog at all.
 */
const GOLD = { id: 1, name: 'Gold' };

test('every field on the plan, the rules and the form preview has a name', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    priority: [],
    marketDates: [{ date: '2099-05-01' }],
    tiers: [GOLD],
    locations: [{ name: 'Main Hall' }],
    sections: [{ name: 'Hall A', location: { name: 'Main Hall' }, tier: GOLD, count: 4 }],
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: 50 },
  });
  const form = await request.put(`${BACKEND_URL}/markets/${marketId}/application-form`, {
    data: {
      fields: [
        { key: 'business_name', label: 'Business name', type: 'text', required: true, order: 0 },
        { key: 'insured', label: 'I have insurance', type: 'checkbox', required: false, order: 1 },
      ],
    },
  });
  expect(form.ok(), await form.text()).toBeTruthy();

  for (const tab of ['setup', 'assignment', 'form']) {
    await page.goto(marketSetupPath(marketId, tab));
    await expect(page.getByTestId('market-bar-title')).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await namelessControls(page), `the ${tab} page`).toEqual([]);
  }
});

test('the sign-in page is a tab list, and every field on it has a name', async ({ page }) => {
  await page.goto('/login');
  const tabs = page.getByRole('tablist');
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  await expect(tabs.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toBeVisible();
  expect(await namelessControls(page), 'sign in').toEqual([]);

  await tabs.getByRole('tab', { name: 'Register' }).click();
  await expect(tabs.getByRole('tab', { name: 'Register' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await namelessControls(page), 'register').toEqual([]);

  const login = new LoginPage(page);
  await tabs.getByRole('tab', { name: 'Sign-in code' }).click();
  await login.otpEmailInput.fill(`nobody-${Date.now()}@example.com`);
  await login.otpSubmitButton.click();
  await expect(login.otpCodeInput).toBeVisible();
  expect(await namelessControls(page), 'sign-in code').toEqual([]);
});

test('every field a vendor meets has a name, from signing in to applying', async ({
  page,
  request,
}) => {
  const { marketId, marketSlug } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject() },
  );
  const vendor = `vendor-${Date.now()}@example.com`;
  await page.goto(`/${marketSlug}/applicant-login?redirect=apply`);
  await expect(page.getByTestId('applicant-login-email-input')).toBeVisible();
  expect(await namelessControls(page), 'email step').toEqual([]);

  await page.getByTestId('applicant-login-email-input').fill(vendor);
  await page.getByTestId('applicant-login-request-btn').click();
  await expect(page.getByTestId('applicant-login-code-input')).toBeVisible();
  expect(await namelessControls(page), 'code step').toEqual([]);

  // Email is off on this stack, so the code the vendor would read is planted in its place.
  createApplicantLoginChallenge(marketId, vendor, '135790');
  await page.getByTestId('applicant-login-code-input').fill('135790');
  await page.getByTestId('applicant-login-verify-btn').click();
  await page.waitForURL(new RegExp(`/${marketSlug}/apply`));
  await expect(page.getByTestId('apply-form')).toBeVisible();
  expect(await namelessControls(page), 'the application form').toEqual([]);
});

test('"More…" is a menu that opens into its items and closes back to its button', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await page.goto(marketSetupPath(marketId, 'applications'));
  const more = page.getByTestId('phase-rail-menu-button');
  await expect(more).toHaveAttribute('aria-haspopup', 'menu');
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  await more.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const items = menu.getByRole('menuitem');
  expect(await items.count()).toBeGreaterThan(0);
  await expect(items.first()).toBeFocused();

  // Arrow keys walk the items; Escape closes the menu and hands focus back.
  if ((await items.count()) > 1) {
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
});

test('every field on every other organizer screen and dialog has a name', async ({
  authenticatedPage: page,
  request,
}) => {
  const published = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const named = async (where: string) => expect(await namelessControls(page), where).toEqual([]);

  await page.goto('/markets');
  await expect(page.getByTestId('markets-create-button')).toBeVisible();
  await named('the markets list');
  await page.getByTestId('markets-create-button').click();
  await expect(page.getByTestId('new-market-name-input')).toBeVisible();
  await named('the new-market dialog');
  await page.keyboard.press('Escape');

  await page.goto(`/markets?q=${encodeURIComponent(published.marketName)}`);
  await page.getByTestId('market-card-manage-button').click();
  await page.getByTestId('manage-market-add-user-button').click();
  await expect(page.getByTestId('manage-market-add-user-input')).toBeVisible();
  await named('Manage market');
  await page.keyboard.press('Escape');

  await page.goto('/organizations');
  await page.getByTestId('organizations-manage-button').first().click();
  await expect(page.getByTestId('manage-org-window')).toBeVisible();
  await named('Manage organization');
  await page.keyboard.press('Escape');
  await page.getByTestId('organizations-create-button').click();
  await named('the new-organization dialog');
  await page.keyboard.press('Escape');

  for (const screen of ['result', 'vendors', 'attendance'] as const) {
    await page.goto(marketScreenPath(published.marketId, screen));
    await expect(page.getByTestId('market-bar-title')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await named(screen);
  }

  await page.goto(`/${published.marketSlug}/check-in`);
  await page.waitForLoadState('networkidle');
  await named('the public check-in page');
});

test('every field of the import has a name', async ({ authenticatedPage: page, request }) => {
  const { marketId } = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject() },
  );
  const importPage = new CsvImportPage(page);
  await page.goto(marketScreenPath(marketId, 'import'));
  await importPage.chooseFile(
    [
      'Timestamp,Email Address,Which days can you attend?,Rank the sections [Main Hall],Rank the sections [Garden]',
      '2026/05/02 9:14:03,nadia@ember.test,Saturday one,1st,2nd',
    ].join('\n'),
  );
  await expect(importPage.columnRows.first()).toBeVisible();
  await importPage.targetSelectAt(2).selectOption('essential_available_dates');
  expect(await namelessControls(page), 'the mapping step').toEqual([]);
});

test('the floorplan choice is a dialog', async ({ authenticatedPage: page, request }) => {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await page.goto(marketSetupPath(marketId, 'setup'));
  await page.getByTestId('market-setup-choose-path-button').click();
  const dialog = page.getByRole('dialog', { name: 'Choose your setup path' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByTestId('choose-path-manual')).toBeVisible();
  await expect(dialog.getByTestId('choose-path-floorplan')).toBeVisible();
});
