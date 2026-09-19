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

    // --- The plan, one page (E10/F02/S01) ---
    // There is no Manage Columns step any more: a market describes no spreadsheet, so the plan is
    // the days it runs, what it offers, and how the solver should order applicants.
    await setupPage.addMarketDate(MARKET_DATE, 0);
    await expect(setupPage.getDateInput(0)).toHaveValue(MARKET_DATE);

    await setupPage.selectManualPath();

    // Tiers are no longer pre-filled from an uploaded spreadsheet's cell values, so the
    // organizer names the one this market runs.
    await setupPage.addTier('Gold', 0);
    await expect(page.locator('.plan-row--triple .priority-row').first()).toBeVisible({
      timeout: 5000,
    });

    // Add a location
    await setupPage.addLocation('Main Hall', 0);

    // Enough Gold tables for every Gold vendor seeded above. With one table the assertion
    // further down - that alice specifically can check in - would be testing which of five
    // vendors won a single seat, rather than testing the pipeline.
    await setupPage.addSection('Gold Tables', 'Main Hall', 'Gold', 5, 0);

    // --- Assignment Priority + Assignment Options, further down the same page ---
    // No column mapping to choose: the application form supplies the vendor's address, their
    // table choice and their sharing partner.
    await setupPage.setMaxAssignmentsPerVendor(1);
    await setupPage.setMaxHalfTableProportion(100);

    // Assign is an operation of the `assignment` phase and refuses everywhere else
    // (E10/F03/S02). These vendors arrive already approved, so the walk is three transitions.
    await setupPage.advancePhaseTo('applications_open', 'Applications Open');
    await setupPage.advancePhaseTo('applications_closed', 'Applications Closed');
    await setupPage.advancePhaseTo('review', 'Review');
    await setupPage.advancePhaseTo('assignment', 'Assignment');

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
    // Named and defined where it is shown: it used to be a bare "Satisfaction Score" with no
    // definition, no breakdown and no tooltip anywhere in the product.
    expect(summaryText).toContain('Satisfaction');
    expect(summaryText).toContain('share of the dates vendors asked for');

    // Download CSV and Send to Discord are the two things here that are actually actions. Done
    // and Back are gone: publishing is a step on the phase strip, and "I have finished looking at
    // this" is what leaving a page already is (E10/F03/S01).
    await expect(resultsPage.downloadCsvButton).toBeVisible();
    await expect(page.getByTestId('assignment-results-done-button')).toHaveCount(0);
    await expect(page.getByTestId('assignment-results-back-button')).toHaveCount(0);

    await expect(page.locator('.body-grid-date .stat-list')).toBeVisible();
    await expect(page.locator('.body-grid-section .stat-list')).toBeVisible();
    await expect(page.locator('.body-grid-tier .stat-list')).toBeVisible();

    await expect(resultsPage.viewVendorsButton).toBeVisible();
    await expect(resultsPage.viewTablesButton).toBeVisible();
    await expect(resultsPage.viewAttendanceButton).toBeVisible();

    // Phase 4: Publish
    await page.screenshot({
      path: testInfo.outputPath('01-assignment-results-before-publish.png'),
      fullPage: true,
    });

    expect(marketId).toBeTruthy();

    // Publishing is `assignment -> market_days` (E03/F03), so the market has to BE in assignment -
    // and it is, because Assign only runs from there (E10/F03/S02) and this spec walked the
    // phases through the UI above. It used to be `archived`, which was reachable from every phase,
    // which is exactly why `archived` meant both "just published" and "over".
    //
    // Publishing is a step on the phase strip, not a Done button on the results screen
    // (E10/F03/S01): that button posted a transition invalid from the phase the organizer was
    // standing in, and failed with a raw enum error.
    const afterWalk = await page.request.get(`${BACKEND_URL}/markets/${marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market: walkedMarket } = (await afterWalk.json()) as {
      market: Record<string, unknown>;
    };
    await page.evaluate((m) => localStorage.setItem('market', JSON.stringify(m)), walkedMarket);

    await page.goto('/market-setup');
    await setupPage.advancePhaseTo('market_days', 'Market Days');

    // Its vendors reach check-in on the URL publishing put on the air. This market takes its
    // vendors by CSV import, so its market home answers as a market that does not exist.
    const slug = marketNameToSlug(marketName);
    await page.goto(`/${slug}/check-in`);
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
