import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, MarketSetupPage, VendorPage } from './fixtures';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
} from './helpers/seedApplicantMarket';
import { transitionMarket } from './helpers/seedPhaseMarket';
import { marketSetupPath } from './helpers/marketScreens';

/**
 * A Google Form market's vendor page opens with its results (T202 ticket 05, ADR 0022).
 *
 * Its vendors are the organizer's form responses, imported. Until the organizer publishes results
 * in Assignment, its address reads exactly as a market that does not exist; Publish market waits
 * for them; then an imported vendor signs in with the address their response gave and reads their
 * table, with no application on the page. An address with no vendor there is told which to use.
 */
const DATE = '2099-08-01';
const CODE = '730146';
const UNKNOWN_SLUG = 'no-such-market-at-all';

const FIELDS = [
  { key: 'business_name', label: 'Business Name', type: 'text', required: true, options: [] },
].map((field, order) => ({ ...field, order }));

const HEADERS = [
  'Timestamp',
  'Email Address',
  'Full Legal Name',
  'Business name',
  'Which days can you attend?',
  'Which tiers will you accept?',
  'Full or half table?',
  'Rank the sections',
];

const MAPPING = {
  submitted_at: 0,
  applicant_email: 1,
  essential_full_name: 2,
  business_name: 3,
  essential_available_dates: 4,
  essential_tier_preference: 5,
  essential_table_choice: 6,
  essential_section_ranking: 7,
};

/** A Google Form market with one imported vendor, approved and allocated a table. */
async function allocated(request: APIRequestContext, vendor: string) {
  const market = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject([DATE]), intakeMode: 'csv', fields: FIELDS },
  );
  const row = [
    '2026/05/02 9:14:03',
    vendor,
    'Riley Fixture',
    'Fixture Prints',
    DATE,
    'Gold',
    'full',
    '"Main Hall, Garden"',
  ].join(',');
  const imported = await request.post(
    `${BACKEND_URL}/markets/${market.marketId}/applications/import`,
    { data: { csvContent: [HEADERS.join(','), row].join('\n'), mapping: MAPPING } },
  );
  expect(imported.ok(), await imported.text()).toBeTruthy();

  const listed = await request.get(`${BACKEND_URL}/markets/${market.marketId}/applications`);
  const [application] = (await listed.json()).applications as { id: string }[];
  const approved = await request.put(
    `${BACKEND_URL}/markets/${market.marketId}/applications/${application.id}/review`,
    { data: { status: 'reviewer_approved' } },
  );
  expect(approved.ok(), await approved.text()).toBeTruthy();
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, market.marketId, 'assignment');
  const ran = await request.post(`${BACKEND_URL}/markets/${market.marketId}/assignment`);
  expect(ran.ok(), await ran.text()).toBeTruthy();
  return market;
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

    test('an imported vendor reads absent, then their table once the organizer publishes results', async ({
      authenticatedPage: organizer,
      browser,
      request,
    }) => {
      const vendor = `google-form-${viewport.width}-${Date.now()}@example.com`;
      const market = await allocated(request, vendor);

      // In a browser of their own, the vendor's page reads as a market that does not exist.
      const vendorContext = await browser.newContext({ viewport });
      const page = await vendorContext.newPage();
      const vendorPage = new VendorPage(page);
      expect(await vendorPage.renderedText(market.marketSlug)).toBe(
        await vendorPage.renderedText(UNKNOWN_SLUG),
      );
      await vendorPage.goto(market.marketSlug);
      await expect(vendorPage.notFound).toBeVisible();
      await expect(vendorPage.emailInput).toHaveCount(0);

      // The organizer is led to Publish results: the market cannot go live before it.
      await organizer.setViewportSize({ width: 1440, height: 900 });
      await organizer.goto(marketSetupPath(market.marketId, 'applications'));
      await expect(organizer.getByTestId('phase-rail-next')).toContainText(
        'Vendors have not been told whether they have a table.',
      );
      await expect(organizer.getByTestId('phase-rail-vendor-page')).toHaveCount(0);
      await expect(organizer.getByTestId('applications-publish-button')).toBeEnabled();
      const setup = new MarketSetupPage(organizer);
      const confirm = await setup.openPublishResults(market.marketId);
      await expect(confirm).toContainText('1 vendor will read "You have a table"');
      await expect(confirm.getByTestId('publish-results-address-url')).toHaveText(
        new RegExp(`/${market.marketSlug}$`),
      );
      await setup.confirmPublishResults();
      // Its address is now one to share, on the rail.
      await expect(organizer.getByTestId('phase-rail-vendor-page-link')).toHaveAttribute(
        'href',
        new RegExp(`/${market.marketSlug}$`),
      );

      // The vendor signs in with the address their response gave, and reads their table.
      await vendorPage.goto(market.marketSlug);
      await expect(vendorPage.marketName).toHaveText(market.marketName);
      await vendorPage.requestCode(vendor);
      // Email is off on this stack, so the code the vendor would read is planted in its place.
      createApplicantLoginChallenge(market.marketId, vendor, CODE);
      await vendorPage.enterCode(CODE);
      await expect(vendorPage.signedInAs).toContainText('Riley Fixture');
      await expect(vendorPage.status).toContainText('You have a table');
      await expect(vendorPage.seats).toContainText('August 1, 2099');
      // Nobody applies on a Google Form market's page: no answers, no Apply.
      await expect(vendorPage.answers).toHaveCount(0);
      await expect(vendorPage.applyButton).toHaveCount(0);
      await expect(vendorPage.info).toHaveCount(0);
      await fitsTheWindow(page);

      // Another address proves itself and is told to use the one the form response gave.
      await vendorPage.signOutButton.click();
      await expect(vendorPage.emailInput).toBeVisible();
      const other = `not-on-the-form-${viewport.width}-${Date.now()}@example.com`;
      await vendorPage.requestCode(other);
      createApplicantLoginChallenge(market.marketId, other, CODE);
      await vendorPage.enterCode(CODE);
      await expect(vendorPage.noVendor).toHaveText(
        `There's no application from this address at ${market.marketName}. Use the address you gave on the market's form, or ask the organizer.`,
      );
      await expect(vendorPage.status).toHaveCount(0);
      await fitsTheWindow(page);

      await vendorContext.close();
    });
  });
}
