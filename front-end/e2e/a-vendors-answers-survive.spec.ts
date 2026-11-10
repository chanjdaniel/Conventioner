import type { Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, VendorPage } from './fixtures';
import { planSetupObject, seedApplicantMarket } from './helpers/seedApplicantMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { signInOnThePage } from './helpers/vendorSignIn';

/**
 * A vendor's typed answers survive a reload, and the form reopens on them (T271, T244 R10).
 *
 * The application form is the product's longest, and usually filled in on a phone, but every
 * answer lived only in the open form: a reload, or a phone discarding the tab, opened the page on
 * Apply with no form and nothing typed. The answers are kept in the tab now, as the sign-in is,
 * and the form opens on them by itself, saying they are back and not sent.
 */
const DATE = '2099-08-01';
const RESTORED = 'Your unsaved answers are back. They reach the market when you save.';

/** The answers kept in the tab, as the page keeps them. */
function keptAnswers(page: Page): Promise<string | null> {
  return page.evaluate(() => sessionStorage.getItem('conventioner.applicationDraft'));
}

test('answers typed into Apply come back after a reload, with the note, until they are saved', async ({
  page,
  request,
  expectAccessible,
}) => {
  const market = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject([DATE]) },
  );
  const vendor = new VendorPage(page);
  await vendor.goto(market.marketSlug);
  await signInOnThePage(vendor, market.marketId, 'answers-survive-apply@example.com');

  await vendor.applyButton.click();
  await expect(vendor.form).toBeVisible({ timeout: 30000 });
  // The form's own defaults (a section ranking seeded in the plan's order) are not answers typed.
  expect(await keptAnswers(page)).toBeNull();
  await vendor.fullNameInput.fill('Ada Reloaded');
  await vendor.fillField('business_name', 'Reloaded Prints');

  await page.reload();

  // The form is open again by itself, on what was typed, saying so.
  await expect(vendor.form).toBeVisible({ timeout: 30000 });
  await expect(vendor.fullNameInput).toHaveValue('Ada Reloaded');
  await expect(vendor.input('business_name')).toHaveValue('Reloaded Prints');
  await expect(page.getByTestId('apply-draft-restored')).toHaveText(RESTORED);
  await expectAccessible('the application form, restored after a reload');

  // Saved, the kept answers go: a reload opens on what the market holds, with no form.
  await vendor.tierCheckbox(DATE, 'Gold').check();
  await vendor.maxDatesInput.fill('1');
  await vendor.tableChoiceRadio('full').check();
  await vendor.fillField('product_type', 'Letterpress cards');
  await vendor.submit();
  await expect(vendor.form).toHaveCount(0, { timeout: 10000 });
  await expect(vendor.answers).toContainText('Reloaded Prints');

  await page.reload();
  await expect(vendor.answers).toContainText('Reloaded Prints', { timeout: 30000 });
  await expect(vendor.form).toHaveCount(0);
  await expect(page.getByTestId('apply-draft-restored')).toHaveCount(0);
});

test('a change typed into Edit comes back after a reload, and Cancel drops it', async ({
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
  const email = 'answers-survive-edit@example.com';
  seedApprovedVendor(market.marketId, email, {
    dates: [DATE],
    tiers: ['Gold'],
    maxDates: 1,
    sections: ['Main Hall', 'Garden'],
    fullName: 'Rowan Returning',
    extra: { business_name: 'Returning Ceramics', product_type: 'Mugs' },
  });
  const vendor = new VendorPage(page);
  await vendor.goto(market.marketSlug);
  await signInOnThePage(vendor, market.marketId, email);

  await vendor.editButton.click();
  await expect(vendor.form).toBeVisible({ timeout: 30000 });
  await vendor.fillField('product_type', 'Mugs and bowls');

  await page.reload();

  await expect(vendor.form).toBeVisible({ timeout: 30000 });
  await expect(vendor.input('product_type')).toHaveValue('Mugs and bowls');
  await expect(vendor.input('business_name')).toHaveValue('Returning Ceramics');
  await expect(page.getByTestId('apply-draft-restored')).toHaveText(RESTORED);

  // Cancel drops them: the answers read as saved, and a reload brings nothing back.
  await vendor.cancelButton.click();
  await expect(vendor.form).toHaveCount(0);
  await expect(vendor.answer('product_type')).toContainText('Mugs');
  await expect(vendor.answers).not.toContainText('Mugs and bowls');

  await page.reload();
  await expect(vendor.answer('product_type')).toContainText('Mugs', { timeout: 30000 });
  await expect(vendor.form).toHaveCount(0);
});

test('Sign out drops the kept answers, so the next sign-in on the tab opens on none', async ({
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
  const email = 'answers-survive-sign-out@example.com';
  const vendor = new VendorPage(page);
  await vendor.goto(market.marketSlug);
  await signInOnThePage(vendor, market.marketId, email);

  await vendor.applyButton.click();
  await vendor.fullNameInput.fill('Shared Device');
  await vendor.signOutButton.click();
  await expect(vendor.emailInput).toBeVisible();
  expect(await keptAnswers(page)).toBeNull();

  await signInOnThePage(vendor, market.marketId, email);
  await expect(vendor.info).toContainText('You have not applied to this market yet.');
  await expect(vendor.form).toHaveCount(0);
});
