import {
  test,
  expect,
  TEST_USER,
  BACKEND_URL,
  NewMarketPage,
  MarketSetupPage,
  CsvImportPage,
  ApplicationMonitorPage,
  AssignmentResultsPage,
} from './fixtures';
import { ensureTestOrg } from './helpers/seeds';

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

/** The days this market runs. Two, so "which days can you attend" is a real question. */
const MARKET_DATES = ['2026-08-01', '2026-08-08'];
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
  'Which days can you attend?',
  'How many days do you want?',
  'Which tiers will you accept?',
  'Full or half table?',
  "Partner's email if sharing",
  'Rank the sections',
];

const CSV_MAPPING: Record<string, string> = {
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
  `2026/05/02 9:14:03,${WANTED},"2026-08-01, 2026-08-08",2,${TIER},full,,"${SECTIONS[0]}, ${SECTIONS[1]}"`,
  `2026/05/02 10:02:51,${ALSO_WANTED},2026-08-01,1,${TIER},full,,"${SECTIONS[1]}, ${SECTIONS[0]}"`,
  `2026/05/03 8:40:12,${REJECTED},2026-08-08,1,${TIER},full,,"${SECTIONS[0]}, ${SECTIONS[1]}"`,
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
    const results = new AssignmentResultsPage(page);

    // --- 1. Create the market ------------------------------------------------------------
    await page.goto('/markets');
    await page.getByTestId('markets-create-button').click();
    await newMarket.waitForOverlay();
    await newMarket.selectFirstOrg();
    await newMarket.fillMarketName(marketName);
    await newMarket.clickSubmit();
    await newMarket.waitForSetupRedirect();

    await setup.waitForWizard();
    await expect(setup.currentPhase).toHaveText('Draft');

    // --- 2. Plan the market --------------------------------------------------------------
    // What the market offers is what it can ask an applicant about, so this comes first.
    await setup.addMarketDate(MARKET_DATES[0], 0);
    await setup.addMarketDate(MARKET_DATES[1], 1);
    await expect(setup.getDateInput(1)).toHaveValue(MARKET_DATES[1]);
    await setup.clickNext();

    await setup.selectManualPath();
    await setup.addTier(TIER, 0);
    await setup.addLocation(LOCATION, 0);
    await setup.addSection(SECTIONS[0], LOCATION, TIER, 2, 0);
    await setup.addSection(SECTIONS[1], LOCATION, TIER, 2, 1);
    await setup.clickNext();
    await page.screenshot({ path: testInfo.outputPath('01-market-planned.png'), fullPage: true });

    // --- 3. Open applications ------------------------------------------------------------
    // Importing is only permitted once applications are open. This market asks no custom
    // question - only the essential ones the plan above defines - and that is enough.
    await setup.advancePhaseTo('applications_open', 'Applications Open');
    await expect(setup.phaseBlockers).toHaveCount(0);

    // --- 4. Import the vendors -----------------------------------------------------------
    await setup.openApplicationsTab();
    await monitor.waitForLoaded();
    await expect(monitor.empty).toBeVisible();

    await setup.startCsvImport();
    await expect(importPage.view).toBeVisible();
    await importPage.chooseFile(CSV);
    await importPage.mapColumns(CSV_HEADERS, CSV_MAPPING);
    await expect(importPage.allMapped).toBeVisible();

    await importPage.clickPreview();
    await expect(importPage.previewCounts).toContainText('3 of 3 rows');
    await importPage.clickConfirm();
    await expect(importPage.resultSummary).toContainText('3 new applications');
    await page.screenshot({ path: testInfo.outputPath('02-imported.png'), fullPage: true });

    // --- 5. Review them ------------------------------------------------------------------
    await setup.goto();
    await setup.openApplicationsTab();
    await monitor.waitForLoaded();

    // They arrive awaiting a decision. Nobody is assignable yet, and the queue is one card at a
    // time, so the count of work left is the assertion - there is no list of all three to count.
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
    await setup.openSetupTab();
    // The assignment options are set here rather than on the way past, because the wizard only
    // persists them when it saves, and the organizer left for the import flow in between.
    await setup.setMaxAssignmentsPerVendor(2);
    await setup.setMaxHalfTableProportion(100);
    await setup.waitForAssignEnabled();
    await setup.clickAssign();
    // A refused run says why, so a failure here reads as the reason and not as a timeout.
    await expect(setup.assignError).toBeHidden();

    // --- 7. The result --------------------------------------------------------------------
    await expect(results.summaryStats).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: testInfo.outputPath('04-assigned.png'), fullPage: true });

    await results.clickViewVendors();
    await expect(results.vendorRows.first()).toBeVisible({ timeout: 10000 });

    // Approval is what decided this, and it is the whole point of the journey: the two the
    // organizer approved hold tables, and the one they turned down holds none. The modal lists
    // every applicant either way, so a rejected vendor is present and empty rather than absent -
    // which is the stronger assertion, because it distinguishes "not placed" from "not loaded".
    expect(await results.placementsFor(WANTED)).toEqual([
      expect.stringContaining(SECTIONS[0]),
      expect.stringContaining(SECTIONS[0]),
    ]);
    expect(await results.placementsFor(ALSO_WANTED)).toEqual([
      expect.stringContaining(SECTIONS[1]),
    ]);
    expect(await results.placementsFor(REJECTED)).toEqual([]);
  });
});
