import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, MarketSetupPage, AssignmentResultsPage, NewMarketPage, BACKEND_URL, TEST_USER } from './fixtures';
import { ensureTestOrg, seedPublishedMarketWithAssignments } from './helpers/seeds';
import {
  makeLegacyPublishedMarket,
  readMarketLifecycle,
  runIsDraftConsistencyMigration,
} from './helpers/legacyMarketDoc';
import { CheckinPage } from './pages/CheckinPage';
import { marketNameToKebabSlug } from '../src/utils/marketSlug';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = path.resolve(__dirname, 'fixtures', 'test-vendors.csv');

test.describe('Market pipeline E2E', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  /**
   * Full end-to-end pipeline: create market with CSV upload, walk the 3-page
   * setup wizard, trigger assignment generation, verify the results view, and
   * publish the market with Done.
   *
   * This test exercises the real product flow without API shortcuts.
   */
  test('create market, configure, assign, view results, and publish', async ({ authenticatedPage: page, playwright }, testInfo) => {
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

    // ── Phase 4: Publish with Done ─────────────────────────────────────────
    // Done advances the phase through POST /markets/:id/transition. `isDraft` is
    // derived from the stored phase, so publishing is what moves the market out of
    // draft - nothing writes `isDraft` on its own.
    await page.screenshot({ path: testInfo.outputPath('01-assignment-results-before-publish.png'), fullPage: true });

    const marketId = await page.evaluate(
      () => (JSON.parse(localStorage.getItem('market') || '{}') as { id?: string }).id,
    );
    expect(marketId).toBeTruthy();

    await resultsPage.clickDone();

    // A published market lands on its public slug URL, not back in the wizard.
    const slug = marketNameToKebabSlug(marketName);
    await page.waitForURL(`**/${slug}`, { timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Market home' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('02-published-market-home.png'), fullPage: true });

    // The server advanced the phase, and reports isDraft derived from it.
    const marketRes = await page.request.get(`${BACKEND_URL}/markets/${marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(marketRes.ok()).toBe(true);
    const { market: storedMarket } = await marketRes.json() as {
      market: { phase: string; isDraft: boolean };
    };
    expect(storedMarket.phase).toBe('archived');
    expect(storedMarket.isDraft).toBe(false);

    // Reopening the published market from the markets list routes on phase, so it
    // goes to the public page instead of dropping the owner back into setup.
    await page.goto('/markets');
    await page.getByTestId('market-card').filter({ hasText: marketName })
      .getByTestId('market-card-open-button').click();
    await page.waitForURL(`**/${slug}`, { timeout: 10000 });

    // ── Phase 5: A vendor can now check in ─────────────────────────────────
    // The public slug lookup serves markets past draft only, so it resolves this
    // market only because Done advanced its phase.
    const anonymous = await playwright.request.newContext({ ignoreHTTPSErrors: true });
    const publicRes = await anonymous.get(
      `${BACKEND_URL}/public/markets/${slug}/vendors/${encodeURIComponent('alice@example.com')}/assignments`,
    );
    expect(publicRes.status()).toBe(200);
    await anonymous.dispose();

    // And the vendor-facing check-in page finds the assignment.
    const checkinPage = new CheckinPage(page);
    await checkinPage.goto(slug);
    await checkinPage.fillEmail('alice@example.com');
    await checkinPage.clickLookup();
    await expect(checkinPage.checkinButtons.first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: testInfo.outputPath('03-checkin-after-publish.png'), fullPage: true });
  });

  /**
   * The upgrade path for markets the OLD build published.
   *
   * Publishing used to be `PUT isDraft: false`, which left the document as
   * `phase: "draft"` + `isDraft: false` - the phase never moved, so `isDraft` was the only
   * publish signal there was. The slug lookup now decides on phase, so those markets are
   * invisible on their public check-in URL until `migrate_is_draft_consistency.py` advances
   * them. Silently 404ing a live market's public URL is the worst outcome this PR could have,
   * so the repair is exercised against the real script, the real database and the real
   * vendor-facing page rather than asserted.
   */
  test('a market published by the old build stays published across the migration', async ({
    authenticatedPage: page,
    request,
    playwright,
  }) => {
    // Seeding, two migration runs and a browser pass do not fit the default budget.
    test.slow();

    const seed = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const vendorAssignmentsUrl =
      `${BACKEND_URL}/public/markets/${seed.marketSlug}` +
      `/vendors/${encodeURIComponent('alice@example.com')}/assignments`;

    const anonymous = await playwright.request.newContext({ ignoreHTTPSErrors: true });

    // Rewind the document to the shape the old build stored for a published market.
    makeLegacyPublishedMarket(seed.marketId);
    expect(readMarketLifecycle(seed.marketId)).toEqual({ phase: 'draft', isDraft: false });

    // Unmigrated, this live market's public check-in URL is off the air.
    expect((await anonymous.get(vendorAssignmentsUrl)).status()).toBe(404);

    runIsDraftConsistencyMigration();

    // The migration resolves the disagreement in favour of isDraft: the market is published,
    // so its phase advances rather than the market being confirmed as a draft.
    expect(readMarketLifecycle(seed.marketId)).toEqual({ phase: 'archived', isDraft: false });

    const migratedRes = await anonymous.get(vendorAssignmentsUrl);
    expect(migratedRes.status()).toBe(200);
    await anonymous.dispose();

    // Re-running it changes nothing.
    runIsDraftConsistencyMigration();
    expect(readMarketLifecycle(seed.marketId)).toEqual({ phase: 'archived', isDraft: false });

    // And the check-in page still finds the vendor's assignment, which is what that URL is for.
    // (It is driven from a signed-in page, as `checkin.spec.ts` does: `App.vue` bounces a
    // session-less visitor to /login even on this public route. That is a real bug on the
    // public surface, but a pre-existing one this migration neither causes nor repairs - the
    // anonymous request above is what proves the lookup resolves without a session.)
    const checkinPage = new CheckinPage(page);
    await checkinPage.goto(seed.marketSlug);
    await checkinPage.fillEmail('alice@example.com');
    await checkinPage.clickLookup();
    await expect(checkinPage.checkinButtons.first()).toBeVisible({ timeout: 10000 });
  });
});
