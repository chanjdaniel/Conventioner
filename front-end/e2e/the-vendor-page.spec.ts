import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, VendorPage } from './fixtures';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
  type ApplicantMarketSeed,
} from './helpers/seedApplicantMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { marketSetupPath } from './helpers/marketScreens';

/**
 * One vendor page per market, at the market's own address (T202, ADR 0022).
 *
 * The vendor opens `/<slug>`, sees the market's name and the sign-in, signs in with the code sent to
 * them, and reads "Submitted" until results are published, then their table, on one page; the
 * organizer's Publish results says that is where they read it, and that no email is sent.
 */
const DATE = '2099-08-01';
const CODE = '642097';

async function post(request: APIRequestContext, path: string, data: object = {}) {
  const res = await request.post(`${BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data,
  });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
}

/** A market taking applications on its page, with one vendor who has applied. */
async function marketWithAVendor(request: APIRequestContext, vendor: string) {
  const market = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject([DATE]) },
  );
  seedApprovedVendor(market.marketId, vendor, {
    dates: [DATE],
    tiers: ['Gold'],
    sections: ['Main Hall', 'Garden'],
    fullName: 'Riley Fixture',
    extra: { business_name: 'Fixture Prints', product_type: 'Prints' },
  });
  return market;
}

async function signIn(page: Page, market: ApplicantMarketSeed, vendor: string) {
  const vendorPage = new VendorPage(page);
  await vendorPage.goto(market.marketSlug);
  await expect(vendorPage.marketName).toHaveText(market.marketName);
  await expect(vendorPage.emailStep).toBeVisible();
  await vendorPage.requestCode(vendor);
  // Email is off on this stack, so the code the vendor would read is planted in its place.
  createApplicantLoginChallenge(market.marketId, vendor, CODE);
  await vendorPage.enterCode(CODE);
  return vendorPage;
}

/** Nothing on the page runs past the window's right edge. */
async function fitsTheWindow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, 'the page runs past the window').toBeLessThanOrEqual(0);
}

for (const [label, viewport] of [
  ['a laptop', { width: 1280, height: 800 }],
  ['a phone', { width: 390, height: 844 }],
] as const) {
  test.describe(`on ${label}`, () => {
    test.use({ viewport });

    test('a vendor signs in at the market\'s address, reads "Submitted", then their table once published', async ({
      page,
      request,
    }) => {
      const vendor = `vendor-page-${viewport.width}-${Date.now()}@example.com`;
      const market = await marketWithAVendor(request, vendor);

      const vendorPage = await signIn(page, market, vendor);
      await expect(page).toHaveURL(new RegExp(`/${market.marketSlug}$`));
      await expect(vendorPage.signedInAs).toContainText('Riley Fixture');
      await expect(vendorPage.signedInAs).toContainText(vendor);
      await expect(vendorPage.status).toContainText('Submitted');
      await expect(vendorPage.answers).toContainText('Fixture Prints');
      await expect(vendorPage.editLink).toBeVisible();
      await fitsTheWindow(page);

      // Whatever the review decided, nothing is told before publishing; then the table is.
      await post(request, `/markets/${market.marketId}/transition`, { toPhase: 'assignment' });
      await post(request, `/markets/${market.marketId}/assignment`);
      await page.reload();
      await expect(vendorPage.status).toContainText('Submitted');
      await expect(vendorPage.status).not.toContainText('table');
      await expect(vendorPage.editLink).toHaveCount(0);

      await post(request, `/markets/${market.marketId}/publish-results`);
      await page.reload();
      await expect(vendorPage.status).toContainText('You have a table');
      await expect(vendorPage.seats).toContainText('August 1, 2099');
      await expect(vendorPage.answers).toContainText('Fixture Prints');
      await fitsTheWindow(page);

      // Sign out leaves a shared device asking for an address again.
      await vendorPage.signOutButton.click();
      await expect(vendorPage.emailInput).toBeVisible();
      await page.reload();
      await expect(vendorPage.emailInput).toBeVisible();
      await expect(vendorPage.status).toHaveCount(0);
    });
  });
}

test('Publish results says vendors read it on the vendor page, and gives its address', async ({
  authenticatedPage: page,
  request,
}) => {
  const market = await marketWithAVendor(request, `publish-telling-${Date.now()}@example.com`);
  await post(request, `/markets/${market.marketId}/transition`, { toPhase: 'assignment' });
  await post(request, `/markets/${market.marketId}/assignment`);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(marketSetupPath(market.marketId, 'applications'));
  await expect(page.getByTestId('applications-publish-hint')).toHaveText(
    "Vendors read whether they have a table on the market's vendor page. No email is sent.",
  );
  // The rail's one address for vendors, the market's own.
  const chip = page.getByTestId('phase-rail-vendor-page');
  await expect(chip).toContainText('Vendor page');
  await expect(chip.locator('a')).toHaveAttribute('href', new RegExp(`/${market.marketSlug}$`));

  await page.getByTestId('applications-publish-button').click();
  const confirm = page.getByTestId('publish-results-window');
  await expect(confirm.getByTestId('publish-results-telling')).toHaveText(
    "Vendors read their result on the market's vendor page. No email is sent, so share the page's address with them.",
  );
  const address = confirm.getByTestId('publish-results-address-url');
  await expect(address).toHaveText(new RegExp(`/${market.marketSlug}$`));

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await confirm.getByTestId('publish-results-address-copy').click();
  await expect(confirm.getByTestId('publish-results-address-copy')).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    await address.textContent(),
  );

  await confirm.getByTestId('publish-results-submit-button').click();
  await expect(page.getByTestId('applications-published-badge')).toBeVisible();
});
