import { test, expect, TEST_USER, BACKEND_URL, CsvImportPage } from './fixtures';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { seedApplicantMarket, planSetupObject } from './helpers/seedApplicantMarket';
import { seedMarketWithVendors } from './helpers/seeds';
import { seedPhaseMarket, transitionMarket } from './helpers/seedPhaseMarket';

/** Two responses as a Google Form writes them, on the dates and tiers `planSetupObject` plans. */
const HEADERS = [
  'Timestamp',
  'Email Address',
  'Full Legal Name',
  'Which days can you attend?',
  'Which tiers will you accept?',
  'Full or half table?',
  'Rank the sections',
  'Business name',
  'What do you sell?',
];
const CSV = [
  HEADERS.join(','),
  '2026/05/02 9:14:03,nadia@ember.test,Nadia Okonkwo,2099-08-01,Gold,full,"Garden, Main Hall",Ember Ceramics,Pottery',
  '2026/05/02 11:40:22,theo@thistle.test,Theo Marchetti,2099-08-08,Silver,half,"Main Hall, Garden",Thorn & Thistle,Dried flowers',
].join('\n');
const MAPPING: Record<string, string> = {
  'Full Legal Name': 'essential_full_name',
  'Which days can you attend?': 'essential_available_dates',
  'Which tiers will you accept?': 'essential_tier_preference',
  'Full or half table?': 'essential_table_choice',
  'Rank the sections': 'essential_section_ranking',
  'Business name': 'business_name',
  'What do you sell?': 'product_type',
};

/**
 * A move on the rail lands where the next step's work is (E32/F01/S01).
 *
 * Each move used to change the phase and leave the organizer where they were: Begin Review left
 * the import and its result on screen, Begin Assignment left them on the applications, and Publish
 * never reached the door. The page each lands on is the guide's page for the phase entered.
 */
test.describe('Every move lands on its phase’s page', () => {
  test('Begin Review leaves the import and its result for the review', async ({
    authenticatedPage: page,
  }) => {
    const seed = await seedApplicantMarket(
      page.request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { setupObject: planSetupObject(), intakeMode: 'csv' },
    );
    await transitionMarket(
      page.request,
      BACKEND_URL,
      TEST_USER.email,
      seed.marketId,
      'applications_closed',
    );

    // The organizer's walk: import the last responses, read the result, then begin review.
    const importPage = new CsvImportPage(page);
    await page.goto(marketScreenPath(seed.marketId, 'import'));
    await importPage.chooseFile(CSV);
    await importPage.mapColumns(HEADERS, MAPPING);
    await expect(importPage.allMapped).toBeVisible();
    await importPage.clickPreview();
    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toContainText('2 new applications');

    await page.getByTestId('phase-transition-review').click();

    await expect(page).toHaveURL(/\/applications$/, { timeout: 15000 });
    await expect(page.getByTestId('phase-rail-current')).toHaveText(/Review/);
    await expect(importPage.resultSummary).toHaveCount(0);
    await expect(importPage.view).toHaveCount(0);
    await expect(page.getByTestId('app-monitor-progress')).toContainText('of 2 to review');
  });

  test('Begin Assignment lands on the assignment', async ({ authenticatedPage: page }) => {
    const seed = await seedMarketWithVendors(
      page.request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    for (const phase of ['applications_open', 'applications_closed', 'review']) {
      await transitionMarket(page.request, BACKEND_URL, TEST_USER.email, seed.marketId, phase);
    }

    await page.goto(marketSetupPath(seed.marketId, 'applications'));
    await page.getByTestId('phase-transition-assignment').click();

    await expect(page).toHaveURL(/\/assignment$/, { timeout: 15000 });
  });

  test('Publish lands at the door', async ({ authenticatedPage: page }) => {
    const seed = await seedAssignedMarket(
      page.request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );

    // Short enough that the result scrolls: the rail sticks, so Publish can be pressed from low on
    // the page, and the door must still open at its top.
    await page.setViewportSize({ width: 1440, height: 480 });
    await page.goto(marketScreenPath(seed.marketId, 'result'));
    await expect(page.getByTestId('phase-transition-market_days')).toBeVisible({ timeout: 15000 });
    await page.mouse.wheel(0, 2000);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    await page.getByTestId('phase-transition-market_days').click();
    await page.getByTestId('sweep-confirm-submit-button').click();

    await expect(page).toHaveURL(/\/attendance$/, { timeout: 15000 });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('a move back lands on its phase’s page too', async ({ authenticatedPage: page }) => {
    const seed = await seedPhaseMarket(
      page.request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'form' },
    );
    await transitionMarket(
      page.request,
      BACKEND_URL,
      TEST_USER.email,
      seed.marketId,
      'applications_open',
    );

    await page.goto(marketSetupPath(seed.marketId, 'applications'));
    await page.getByTestId('phase-rail-menu-button').click();
    await page.getByTestId('phase-transition-draft').click();

    await expect(page).toHaveURL(/\/setup$/, { timeout: 15000 });
  });
});
