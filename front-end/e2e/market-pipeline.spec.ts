import {
  test,
  expect,
  MarketSetupPage,
  AssignmentResultsPage,
  BACKEND_URL,
  TEST_USER,
} from './fixtures';
import { ensureTestOrg, loginViaApi, marketNameToSlug } from './helpers/seeds';
import { seedApprovedVendor } from './helpers/seedApplication';

/** The single market day this pipeline sets up, seeds vendors for, and assigns. */
const MARKET_DATE = '2026-07-15';
import { CheckinPage } from './pages/CheckinPage';

test.describe('Market pipeline E2E', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  /**
   * Full end-to-end pipeline: create market via API, seed a setupObject,
   * walk the 3-page setup wizard, trigger assignment
   * generation, verify the results view, and publish the market with Done.
   */
  test('create market, configure, assign, view results, and publish', async ({
    authenticatedPage: page,
    playwright,
  }, testInfo) => {
    const marketName = `Pipeline E2E ${Date.now()}`;

    // Phase 1: Create the market via API instead of CSV upload.
    const ctx = page.request;
    await loginViaApi(ctx, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const orgsRes = await ctx.get(`${BACKEND_URL}/organizations`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const orgs = (await orgsRes.json()).organizations as { id: string }[];
    const orgId = orgs[0]?.id;
    if (!orgId) throw new Error('No organization found');

    const createRes = await ctx.post(`${BACKEND_URL}/markets`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Owner-Email': TEST_USER.email,
      },
      data: {
        name: marketName,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
        roles: { [TEST_USER.email]: 'owner' },
        modificationList: [],
        assignmentObject: {},
      },
    });
    if (!createRes.ok()) {
      throw new Error(`Market creation failed: ${createRes.status()} ${await createRes.text()}`);
    }
    const { market_id: marketId } = (await createRes.json()) as { market_id: string };

    // The vendors the wizard's Assign button will place. Approved applications, which is what a
    // vendor is; this used to upload a fabricated CSV because the solver read a separate
    // source_data collection.
    const VENDORS: Array<[string, string, string, string]> = [
      ['alice@example.com', 'Gold', 'full', ''],
      ['bob@example.com', 'Gold', 'full', ''],
      ['carol@example.com', 'Silver', 'half', ''],
      ['dave@example.com', 'Silver', 'half', 'carol@example.com'],
      ['eve@example.com', 'Gold', 'full', ''],
    ];
    for (const [applicant, tier, tableChoice, shareWith] of VENDORS) {
      seedApprovedVendor(marketId, applicant, {
        dates: [MARKET_DATE],
        tiers: [tier],
        tableChoice,
        shareWith,
      });
    }

    const marketRes = await ctx.get(`${BACKEND_URL}/markets/${marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    let { market } = (await marketRes.json()) as { market: Record<string, unknown> };

    // Seed a minimal setupObject so the setup wizard has columns to display.
    const minimalSetup = {
      priority: [],
      marketDates: [],
      tiers: [],
      locations: [],
      sections: [],
      assignmentOptions: {
        maxAssignmentsPerVendor: null,
        maxHalfTableProportionPerSection: null,
      },
    };
    const setupRes = await ctx.put(`${BACKEND_URL}/markets/${marketId}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Owner-Email': TEST_USER.email,
      },
      data: { ...market, setupObject: minimalSetup },
    });
    if (!setupRes.ok()) {
      throw new Error(`Setup PUT failed: ${setupRes.status()} ${await setupRes.text()}`);
    }
    const updatedRes = await ctx.get(`${BACKEND_URL}/markets/${marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const updated = (await updatedRes.json()) as { market: Record<string, unknown> };
    market = updated.market;

    // Inject the market into localStorage so the setup wizard can pick it up.
    await page.evaluate(
      ({ m, user }) => {
        localStorage.setItem('market', JSON.stringify(m));
        localStorage.setItem('user', JSON.stringify(user));
      },
      { m: market, user: TEST_USER.email },
    );

    await page.goto('/market-setup');

    // Phase 2: Walk the setup wizard
    const setupPage = new MarketSetupPage(page);
    await setupPage.waitForWizard();

    // --- Page 0: Market Dates ---
    // There is no Manage Columns step any more: a market describes no spreadsheet, so the only
    // thing this page asks for is the days the market runs.
    await setupPage.addMarketDate(MARKET_DATE, 0);
    await expect(setupPage.getDateInput(0)).toHaveValue(MARKET_DATE);

    // Advance to page 1
    await setupPage.clickNext();

    // --- Page 1: Tiers + Locations + Sections ---
    await setupPage.selectManualPath();

    // Tiers are no longer pre-filled from an uploaded spreadsheet's cell values, so the
    // organizer names the one this market runs.
    await setupPage.addTier('Gold', 0);
    await expect(page.locator('.triple-column-body .priority-row').first()).toBeVisible({
      timeout: 5000,
    });

    // Add a location
    await setupPage.addLocation('Main Hall', 0);

    // Enough Gold tables for every Gold vendor seeded above. With one table the assertion
    // further down - that alice specifically can check in - would be testing which of five
    // vendors won a single seat, rather than testing the pipeline.
    await setupPage.addSection('Gold Tables', 'Main Hall', 'Gold', 5, 0);

    // Advance to page 2
    await setupPage.clickNext();

    // --- Page 2: Assignment Priority + Assignment Options ---
    // No column mapping to choose: the application form supplies the vendor's address, their
    // table choice and their sharing partner.
    await setupPage.setMaxAssignmentsPerVendor(1);
    await setupPage.setMaxHalfTableProportion(100);

    // Verify the Assign button is enabled and click it
    await setupPage.waitForAssignEnabled();
    await setupPage.clickAssign();

    // A refused run says why, so a failure here reads as the reason rather than as a timeout.
    const assignError = page.getByTestId('market-setup-assign-error');
    await expect(assignError).toBeHidden();

    // Phase 3: Verify assignment results
    const resultsPage = new AssignmentResultsPage(page);

    await expect(resultsPage.summaryStats).toBeVisible({ timeout: 15000 });

    const summaryText = await resultsPage.summaryStats.textContent();
    expect(summaryText).toContain('Assignments');
    expect(summaryText).toContain('Assigned Tables');
    expect(summaryText).toContain('Assigned Vendors');
    expect(summaryText).toContain('Satisfaction Score');

    await expect(resultsPage.doneButton).toBeVisible();
    await expect(resultsPage.downloadCsvButton).toBeVisible();
    await expect(resultsPage.backButton).toBeVisible();

    await expect(page.locator('.body-grid-date .stat-list')).toBeVisible();
    await expect(page.locator('.body-grid-section .stat-list')).toBeVisible();
    await expect(page.locator('.body-grid-tier .stat-list')).toBeVisible();

    await expect(resultsPage.viewVendorsButton).toBeVisible();
    await expect(resultsPage.viewTablesButton).toBeVisible();
    await expect(resultsPage.viewAttendanceButton).toBeVisible();

    // Phase 4: Publish with Done
    await page.screenshot({
      path: testInfo.outputPath('01-assignment-results-before-publish.png'),
      fullPage: true,
    });

    expect(marketId).toBeTruthy();

    // Publishing is `assignment -> market_days` (E03/F03), so the market has to BE in assignment.
    // It used to be `archived`, which was reachable from every phase - which is exactly why
    // `archived` meant both "just published" and "over". The vendors seeded above are already
    // approved, so the review guard passes.
    for (const toPhase of ['applications_open', 'applications_closed', 'review', 'assignment']) {
      const res = await page.request.post(
        `${BACKEND_URL}/markets/${encodeURIComponent(marketId)}/transition`,
        {
          headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
          data: { toPhase },
        },
      );
      expect(res.ok(), `transition to ${toPhase}: ${await res.text()}`).toBeTruthy();
    }

    await resultsPage.clickDone();

    // A published market lands on the public page it actually serves, not back in the wizard.
    // This market takes its vendors by CSV import, so that is check-in rather than the market
    // home, which answers a stranger as a market that does not exist.
    const slug = marketNameToSlug(marketName);
    await page.waitForURL(`**/${slug}/check-in`, { timeout: 10000 });
    await expect(page.locator('.attendance-view')).toBeVisible({ timeout: 10000 });
    await page.screenshot({
      path: testInfo.outputPath('02-published-market-checkin.png'),
      fullPage: true,
    });

    // The server advanced the phase, and reports isDraft derived from it.
    const storedRes = await page.request.get(`${BACKEND_URL}/markets/${marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(storedRes.ok()).toBe(true);
    const { market: storedMarket } = (await storedRes.json()) as {
      market: { phase: string; isDraft: boolean };
    };
    // A published market is RUNNING, so its phase is market_days (E03/F03). `archived` now means
    // finished - a market that has run and is over, or one abandoned before it ever ran.
    expect(storedMarket.phase).toBe('market_days');
    expect(storedMarket.isDraft).toBe(false);

    // Reopening the published market from the markets list lands on the market's own screens.
    // This used to route on phase and send a published market to `/<slug>`, its public page -
    // which the intake-mode gate serves only to form-intake markets, so every MVP market landed
    // on "Page not found". The old assertion here waited for that URL and passed, because the URL
    // was right and only the page was wrong; this asserts what rendered.
    await page.goto('/markets');
    await page.getByTestId('market-card').filter({ hasText: marketName }).first().click();
    await page.waitForURL('**/market-setup', { timeout: 10000 });
    await expect(page.getByTestId('page-not-found')).toHaveCount(0);
    await expect(page.getByTestId('market-setup-title')).toHaveText(marketName, { timeout: 10000 });

    // Phase 5: A vendor can now check in
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
    await page.screenshot({
      path: testInfo.outputPath('03-checkin-after-publish.png'),
      fullPage: true,
    });
  });
});
