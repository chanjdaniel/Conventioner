import { upcomingSaturday } from './helpers/upcoming';
import { getFormattedDate } from '../src/utils/utils';
import {
  test,
  expect,
  TEST_USER,
  BACKEND_URL,
  NewMarketPage,
  MarketSetupPage,
  CsvImportPage,
  ApplicationMonitorPage,
  ResultPage,
  ApplicantLoginPage,
} from './fixtures';
import { ensureTestOrg, marketNameToSlug } from './helpers/seeds';
import { ApplyPage } from './pages/ApplyPage';
import { createApplicantLoginChallenge } from './helpers/seedApplicantMarket';

/**
 * The MVP journey, walked once, by one organizer, in one session (E04/F01/S02).
 *
 * Every other suite covers a slice of this and meets no other slice. The market pipeline suite
 * begins at "approved vendors exist" - it creates the market over the API and seeds applications
 * already at `reviewer_approved`. The CSV import suite ends at "rows are applications awaiting
 * review", asserted over the API. Nothing joined them, and nothing in the entire e2e suite had
 * ever clicked Approve, though approval is what decides the solver's input.
 *
 * So this spec seeds only what precedes the journey - a verified user and an organization - and
 * does everything else the way an organizer does: through the UI.
 */

/**
 * The days this market runs. Two, so "which days can you attend" is a real question - and still to
 * come whenever this runs, since a market leaves draft only with such dates (E31/F01/S01).
 */
const MARKET_DATES = [upcomingSaturday(0), upcomingSaturday(1)];
const TIER = 'Gold';
const LOCATION = 'Main Hall';
/** Two sections, because a ranking question needs something to rank. */
const SECTIONS = ['Riverside', 'Courtyard'];

/**
 * The organizer's Google Form, exported.
 *
 * Its columns are only the essential questions, because this organizer never built a custom form -
 * which is the ordinary case, and the case that used to be blocked: the phase guard demanded a
 * custom field before applications could open (fixed in E03/F01/S01).
 */
const CSV_HEADERS = [
  'Timestamp',
  'Email Address',
  'Full Legal Name',
  'Which days can you attend?',
  'How many days do you want?',
  'Which tiers will you accept?',
  'Full or half table?',
  "Partner's email if sharing",
  'Rank the sections',
];

const CSV_MAPPING: Record<string, string> = {
  'Full Legal Name': 'essential_full_name',
  'Which days can you attend?': 'essential_available_dates',
  'How many days do you want?': 'essential_max_dates',
  'Which tiers will you accept?': 'essential_tier_preference',
  'Full or half table?': 'essential_table_choice',
  "Partner's email if sharing": 'essential_table_share_email',
  'Rank the sections': 'essential_section_ranking',
};

const WANTED = 'mira@kiln.test';
const ALSO_WANTED = 'sam@saltandpine.test';
/** Applies, is reviewed, and is turned down. The solver must not place them. */
const REJECTED = 'drew@offcuts.test';

const CSV = [
  CSV_HEADERS.join(','),
  `2026/05/02 9:14:03,${WANTED},Mira Kaplan,"${MARKET_DATES[0]}, ${MARKET_DATES[1]}",2,${TIER},full,,"${SECTIONS[0]}, ${SECTIONS[1]}"`,
  `2026/05/02 10:02:51,${ALSO_WANTED},Sam Oyelaran,${MARKET_DATES[0]},1,${TIER},full,,"${SECTIONS[1]}, ${SECTIONS[0]}"`,
  `2026/05/03 8:40:12,${REJECTED},Drew Whitfield,${MARKET_DATES[1]},1,${TIER},full,,"${SECTIONS[0]}, ${SECTIONS[1]}"`,
].join('\n');

test.describe('The MVP journey', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('an organizer creates a market, imports their vendors, approves them, and assigns tables', async ({
    authenticatedPage: page,
  }, testInfo) => {
    const marketName = `Journey E2E ${Date.now()}`;
    const newMarket = new NewMarketPage(page);
    const setup = new MarketSetupPage(page);
    const importPage = new CsvImportPage(page);
    const monitor = new ApplicationMonitorPage(page);
    const results = new ResultPage(page);

    // --- 1. Create the market ------------------------------------------------------------
    await page.goto('/markets');
    await page.getByTestId('markets-create-button').click();
    await newMarket.waitForOverlay();
    await newMarket.selectFirstOrg();
    await newMarket.fillMarketName(marketName);
    // Their vendors apply on the organizer's own Google Form (E31/F03/S01). That opens on its Upload
    // step; this organizer plans by hand and imports later, so they leave it for Market Setup.
    await newMarket.choosePath('csv');
    await newMarket.clickSubmit();
    await page.getByTestId('start-from-csv-upload').getByRole('button', { name: 'Cancel' }).click();
    await newMarket.waitForSetupRedirect();

    await setup.waitForWizard();
    await expect(setup.currentPhase).toHaveText('Draft');

    // --- 2. Plan the market --------------------------------------------------------------
    // What the market offers is what it can ask an applicant about, so this comes first.
    await setup.addMarketDate(MARKET_DATES[0]);
    await setup.addMarketDate(MARKET_DATES[1]);
    // Both days read back as days, in order: dates are chosen on a calendar now (E18/F01/S02),
    // and what the organizer sees is each date spelled out rather than an input's value.
    await expect(page.getByTestId('setup-dates-date-display-1')).toHaveAttribute(
      'title',
      getFormattedDate(MARKET_DATES[1]) as string,
    );

    // One page, no paging (E10/F02/S01): dates, then tiers and sections, then the options, all in
    // view at once.
    await setup.selectManualPath();
    await setup.addTier(TIER, 0);
    await setup.addLocation(LOCATION, 0);
    await setup.addSection(SECTIONS[0], LOCATION, TIER, 2, 0);
    await setup.addSection(SECTIONS[1], LOCATION, TIER, 2, 1);
    await page.screenshot({ path: testInfo.outputPath('01-market-planned.png'), fullPage: true });

    // --- 3. Import responses -------------------------------------------------------------
    // The Google Form path reads Draft, Review (E38/F04/S01): this organizer already holds the
    // responses, so the rail's step out of draft is the import, and Begin Review waits on it. This
    // market asks no custom question - only the essential ones the plan above defines.
    await expect(page.getByTestId('phase-transition-applications')).toBeDisabled();
    await page.getByTestId('phase-rail-fix').click();
    await expect(page).toHaveURL(/\/import$/);
    await expect(setup.currentPhase).toHaveText('Draft');

    // --- 4. Import the vendors -----------------------------------------------------------
    await expect(importPage.view).toBeVisible();
    await importPage.chooseFile(CSV);
    await importPage.mapColumns(CSV_HEADERS, CSV_MAPPING);
    await expect(importPage.allMapped).toBeVisible();

    await importPage.clickPreview();
    await expect(importPage.previewCounts).toContainText('3 of 3 rows');
    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toContainText('3 new applications');
    // Written, the import took the market into Review.
    await expect(setup.currentPhase).toHaveText('Review');
    await page.screenshot({ path: testInfo.outputPath('02-imported.png'), fullPage: true });

    // --- 5. Review them ------------------------------------------------------------------
    // The import's done step leads to the review, where no import is offered (E38/F04/S03).
    await page.getByTestId('import-finish-button').click();
    await expect(page).toHaveURL(/\/applications$/);
    // The page opens on All (E38/F05/S01); this walk decides one card at a time.
    await monitor.switchTo();
    await monitor.waitForLoaded();
    await expect(page.getByTestId('market-setup-import-button')).toHaveCount(0);

    // They arrive awaiting a decision. Nobody is assignable yet, and the queue is one card at a
    // time, so the count of work left is the assertion.
    await expect(monitor.progress).toContainText('of 3 to review');
    await expect(monitor.tally).toContainText('0 reviewed');
    // The card carries the answers the verdict is supposed to rest on, not just an address.
    await expect(monitor.answers).toBeVisible();
    expect((await monitor.queuedEmails()).sort()).toEqual([WANTED, ALSO_WANTED, REJECTED].sort());

    await monitor.approve(WANTED);
    await monitor.approve(ALSO_WANTED);
    await monitor.reject(REJECTED);
    await expect(monitor.done).toBeVisible();
    await expect(monitor.tally).toContainText('3 reviewed · 2 approved · 1 rejected');
    await page.screenshot({ path: testInfo.outputPath('03-reviewed.png'), fullPage: true });

    // --- 6. Assign ------------------------------------------------------------------------
    // Assign is an operation of the `assignment` phase and refuses everywhere else
    // (E10/F03/S02), and Begin Assignment lands on its page (E32/F01/S01). This spec is the one
    // that goes the whole way, so the walk belongs here rather than being skipped past by a seed.
    await setup.advancePhaseTo('assignment', 'Assignment');
    await expect(page).toHaveURL(/\/settings$/);
    await expect(setup.assignPhaseHint).toBeHidden();
    await setup.setMaxAssignmentsPerVendor(2);
    await setup.setMaxHalfTableProportion(100);

    await setup.waitForAssignEnabled();
    await setup.clickAssign();
    // A refused run says why, so a failure here reads as the reason and not as a timeout.
    await expect(setup.assignError).toBeHidden();

    // --- 7. The result --------------------------------------------------------------------
    // A run lands on the Assignments page (E22/F04/S03): the strip over the tables grid.
    await expect(page).toHaveURL(/\/assignments$/, { timeout: 15000 });
    await expect(results.strip).toBeVisible({ timeout: 15000 });
    await expect(results.occupiedSeats.first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: testInfo.outputPath('04-assigned.png'), fullPage: true });

    // Approval is what decided this, and it is the whole point of the journey: the two the
    // organizer approved hold tables, and the one they turned down holds none - read off the grid
    // once it has drawn, so "not placed" is not "not loaded".
    expect(await results.placementsFor(WANTED)).toEqual([
      expect.stringContaining(SECTIONS[0]),
      expect.stringContaining(SECTIONS[0]),
    ]);
    expect(await results.placementsFor(ALSO_WANTED)).toEqual([
      expect.stringContaining(SECTIONS[1]),
    ]);
    expect(await results.placementsFor(REJECTED)).toEqual([]);
  });

  /**
   * The other path, as far as the seam the CSV path does not cross: vendors apply on the market's
   * own page while it is in Applications, are reviewed there as they arrive, and an approved one
   * is placed (E38/F04/S01).
   */
  test('an organizer opens applications, a vendor applies, is approved, and is placed', async ({
    authenticatedPage: page,
    browser,
  }) => {
    const marketName = `Journey Online E2E ${Date.now()}`;
    const newMarket = new NewMarketPage(page);
    const setup = new MarketSetupPage(page);
    const monitor = new ApplicationMonitorPage(page);
    const results = new ResultPage(page);
    // An address of this run's own: one address is sent at most five codes in 15 minutes, so a
    // fixed one failed this test from its sixth repeat in one run.
    const VENDOR = `ruth-${Date.now()}@bindery.test`;

    // --- 1. Create and plan the market ------------------------------------------------------
    await page.goto('/markets');
    await page.getByTestId('markets-create-button').click();
    await newMarket.waitForOverlay();
    await newMarket.selectFirstOrg();
    await newMarket.fillMarketName(marketName);
    await newMarket.choosePath('form');
    await newMarket.clickSubmit();
    const marketId = await newMarket.waitForSetupRedirect();
    await setup.waitForWizard();
    await setup.addMarketDate(MARKET_DATES[0]);
    await setup.selectManualPath();
    await setup.addTier(TIER, 0);
    await setup.addLocation(LOCATION, 0);
    await setup.addSection(SECTIONS[0], LOCATION, TIER, 2, 0);

    // --- 2. Open applications ---------------------------------------------------------------
    await setup.advancePhaseTo('applications', 'Applications');
    await expect(page).toHaveURL(/\/applications$/);
    await expect(page.getByTestId('market-setup-import-button')).toHaveCount(0);

    // --- 3. A vendor applies on the market's own page, in a browser of their own -------------
    const slug = marketNameToSlug(marketName);
    const vendorContext = await browser.newContext();
    const vendorPage = await vendorContext.newPage();
    const login = new ApplicantLoginPage(vendorPage);
    await vendorPage.goto(`/${slug}/applicant-login?redirect=apply`);
    await login.requestCode(VENDOR);
    await expect(login.codeInput).toBeVisible();
    createApplicantLoginChallenge(marketId, VENDOR, '864213');
    await login.enterCode('864213');
    const apply = new ApplyPage(vendorPage);
    await expect(apply.form).toBeVisible({ timeout: 30000 });
    await apply.fullNameInput.fill('Ruth Abernathy');
    await apply.tierCheckbox(MARKET_DATES[0], TIER).check();
    await apply.maxDatesInput.fill('1');
    await apply.tableChoiceRadio('full').check();
    await apply.submit();
    await vendorPage.waitForURL(new RegExp(`/${slug}/applicant/dashboard`));
    await vendorContext.close();

    // --- 4. Reviewed in the same stage, applications still open ------------------------------
    // The page opens on All (E38/F05/S01); this walk decides one card at a time.
    await page.reload();
    await monitor.switchTo();
    await monitor.waitForLoaded();
    await monitor.approve(VENDOR);
    await expect(monitor.tally).toContainText('1 reviewed · 1 approved');

    // --- 5. Assign, and the approved vendor holds a table -----------------------------------
    await setup.advancePhaseTo('assignment', 'Assignment');
    await expect(page).toHaveURL(/\/settings$/);
    await setup.waitForAssignEnabled();
    await setup.clickAssign();
    await expect(page).toHaveURL(/\/assignments$/, { timeout: 15000 });
    await expect(results.occupiedSeats.first()).toBeVisible({ timeout: 10000 });
    expect(await results.placementsFor(VENDOR)).toEqual([expect.stringContaining(SECTIONS[0])]);
  });
});
