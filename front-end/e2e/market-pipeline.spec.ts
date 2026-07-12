import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, MarketSetupPage, AssignmentResultsPage, NewMarketPage, BACKEND_URL, TEST_USER } from './fixtures';
import { ensureTestOrg } from './helpers/seeds';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(__dirname, 'fixtures', 'test-vendors.csv');

test.describe('Market pipeline E2E', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  /**
   * Full end-to-end pipeline: create market with CSV upload, walk the 3-page
   * setup wizard, trigger assignment generation, and verify the results view.
   *
   * This test exercises the real product flow without API shortcuts.
   */
  test('create market, configure, assign, and view results', async ({ authenticatedPage: page }) => {
    const marketName = `Pipeline E2E ${Date.now()}`;

    // ── Phase 1: Create a new market with CSV upload ──────────────────────
    const newMarketPage = new NewMarketPage(page);

    // Navigate to Markets and open the New Market overlay
    await page.goto('/markets');
    await page.getByTestId('markets-create-button').click();
    await newMarketPage.waitForOverlay();

    // Upload the CSV fixture
    await newMarketPage.uploadCsv(CSV_PATH);

    // After CSV parsing, the name input appears
    await newMarketPage.waitForNameInput();
    await newMarketPage.selectFirstOrg();
    await newMarketPage.fillMarketName(marketName);

    // Submit to create the market
    await newMarketPage.clickSubmit();
    await newMarketPage.waitForSetupRedirect();

    // ── Phase 2: Walk the setup wizard ────────────────────────────────────
    const setupPage = new MarketSetupPage(page);
    await setupPage.waitForWizard();

    // --- Page 0: Manage Columns + Market Dates ---
    // Verify that columns from the CSV are visible (5 columns: email, vendor_name,
    // table_choice, buddy_email, day_1)
    await expect(page.locator('.double-column-body .setup-row').first()).toBeVisible({ timeout: 5000 });
    const columnRows = page.locator('.double-column-body .setup-row');
    await expect(columnRows).toHaveCount(5);

    // Add a market date: map the "day_1" column (index 4) to a date.
    // This also seeds tier names from the date column values ("Gold", "Silver").
    await setupPage.addMarketDate('2026-07-15', 4, 0);

    // Advance to page 1
    await setupPage.clickNext();

    // --- Page 1: Tiers + Locations + Sections ---
    // The ChoosePathOverlay appears because sections are empty.
    // Select Manual Setup.
    await setupPage.selectManualPath();

    // Tiers auto-populate from the day_1 column values ("Gold", "Silver").
    // Verify tier rows are present.
    await expect(page.locator('.triple-column-body .priority-row').first()).toBeVisible({ timeout: 5000 });

    // Add a location
    await setupPage.addLocation('Main Hall', 0);

    // Add a section: Gold tier, Main Hall location, 1 table
    await setupPage.addSection('Gold Tables', 'Main Hall', 'Gold', 1, 0);

    // Advance to page 2
    await setupPage.clickNext();

    // --- Page 2: Assignment Priority + Assignment Options ---
    // Configure required assignment options.
    // Column indices from CSV headers: email=0, vendor_name=1, table_choice=2,
    // buddy_email=3, day_1=4
    await setupPage.selectEmailColumn(0);
    await setupPage.selectTableChoiceColumn(2);
    await setupPage.selectTableShareEmailColumn(3);

    // Numeric options: max 1 assignment per vendor, 100% half-table proportion
    await setupPage.setMaxAssignmentsPerVendor(1);
    await setupPage.setMaxHalfTableProportion(100);

    // Verify the Assign button is enabled and click it
    await setupPage.waitForAssignEnabled();
    await setupPage.clickAssign();

    // ── Phase 3: Verify assignment results ─────────────────────────────────
    const resultsPage = new AssignmentResultsPage(page);

    // Wait for the results page to load with statistics
    await expect(resultsPage.summaryStats).toBeVisible({ timeout: 15000 });

    // Verify summary stats render meaningful data
    const summaryText = await resultsPage.summaryStats.textContent();
    expect(summaryText).toContain('Assignments');
    expect(summaryText).toContain('Assigned Tables');
    expect(summaryText).toContain('Assigned Vendors');
    expect(summaryText).toContain('Satisfaction Score');

    // Verify action buttons are present
    await expect(resultsPage.doneButton).toBeVisible();
    await expect(resultsPage.downloadCsvButton).toBeVisible();
    await expect(resultsPage.backButton).toBeVisible();

    // Verify per-date, per-section, and per-tier breakdowns are rendered
    await expect(page.locator('.body-grid-date .stat-list')).toBeVisible();
    await expect(page.locator('.body-grid-section .stat-list')).toBeVisible();
    await expect(page.locator('.body-grid-tier .stat-list')).toBeVisible();

    // Verify quick-nav buttons are visible
    await expect(resultsPage.viewVendorsButton).toBeVisible();
    await expect(resultsPage.viewTablesButton).toBeVisible();
    await expect(resultsPage.viewAttendanceButton).toBeVisible();
  });
});
