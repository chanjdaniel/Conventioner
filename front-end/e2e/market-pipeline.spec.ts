import { getFormattedDate } from '../src/utils/utils';
import { savePlan } from './helpers/savePlan';
import { marketSetupPath } from './helpers/marketScreens';
import {
  test,
  expect,
  MarketSetupPage,
  ResultPage,
  BACKEND_URL,
  APP_API,
  TEST_USER,
  VendorPage,
} from './fixtures';
import { ensureTestOrg, loginViaApi, marketNameToSlug } from './helpers/seeds';
import { seedApprovedVendor } from './helpers/seedApplication';
import { upcomingSaturday } from './helpers/upcoming';

/** The single market day this pipeline sets up, seeds vendors for, and assigns. */
// Still to come whenever this runs: a market leaves draft only with such dates (E31/F01/S01).
const MARKET_DATE = upcomingSaturday();
import { forgetSignInAttempts, signInOnThePage } from './helpers/vendorSignIn';
import { MarketsPage } from './pages/MarketsPage';

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
  }, testInfo) => {
    const marketName = `Pipeline E2E ${Date.now()}`;

    // Phase 1: Create the market via API instead of CSV upload.
    const ctx = page.request;
    await loginViaApi(ctx, APP_API, TEST_USER.email, TEST_USER.password);
    const orgsRes = await ctx.get(`${APP_API}/organizations`);
    const orgs = (await orgsRes.json()).organizations as { id: string }[];
    const orgId = orgs[0]?.id;
    if (!orgId) throw new Error('No organization found');

    const createRes = await ctx.post(`${APP_API}/markets`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        name: marketName,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
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
    await savePlan(ctx, APP_API, TEST_USER.email, marketId, minimalSetup);

    // The signed-in user, where the screens that still read it look; the market is the URL's.
    await page.evaluate((user) => {
      localStorage.setItem('user', JSON.stringify(user));
    }, TEST_USER.email);

    await page.goto(marketSetupPath(marketId));

    // Phase 2: Walk the setup wizard
    const setupPage = new MarketSetupPage(page);
    await setupPage.waitForWizard();

    // --- The plan, one page (E10/F02/S01) ---
    // There is no Manage Columns step any more: a market describes no spreadsheet, so the plan is
    // the days it runs, what it offers, and how the solver should order applicants.
    await setupPage.addMarketDate(MARKET_DATE);
    // The day reads back as a day, not as an input's value: dates are chosen on a calendar now
    // (E18/F01/S02), and what the organizer sees is the date spelled out.
    await expect(page.getByTestId('setup-dates-date-display-0')).toHaveAttribute(
      'title',
      getFormattedDate(MARKET_DATE) as string,
    );

    // Tiers are no longer pre-filled from an uploaded spreadsheet's cell values, so the
    // organizer names the one this market runs.
    await setupPage.addTier('Gold', 0);
    // Named by its testid rather than by a layout class: every plan section is full width now
    // (E18/F01/S01), so `.plan-row--triple` no longer exists - and a spec that reaches through a
    // layout class breaks whenever the layout changes, which is not what it is testing.
    await expect(page.getByTestId('setup-tier-name-input-0')).toBeVisible({ timeout: 5000 });

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
    // (E10/F03/S02). These vendors arrive already approved, as though imported, so the walk is two
    // moves: into a Google Form market's Review (E38/F04/S01), then on to Assignment.
    // Review waits on Review setup (T206), which this form of essential questions alone reaches
    // past the rail's offer of the form (T260); one click decides it.
    await setupPage.decideOnReviewSetupAskingNothingOfTheirOwn('Draft from your Google Form');
    await setupPage.advancePhaseTo('applications', 'Review');
    await setupPage.advancePhaseTo('assignment', 'Assignment');

    // Verify the Assign button is enabled and click it
    await setupPage.waitForAssignEnabled();
    await setupPage.clickAssign();

    // A refused run says why, so a failure here reads as the reason rather than as a timeout.
    const assignError = page.getByTestId('market-setup-assign-error');
    await expect(assignError).toBeHidden();

    // Phase 3: Verify the result. A run lands on the Assignments page (E22/F04/S03).
    await expect(page).toHaveURL(/\/assignments$/, { timeout: 15000 });
    const resultsPage = new ResultPage(page);
    await expect(resultsPage.strip).toBeVisible({ timeout: 15000 });

    const summaryText = await resultsPage.strip.textContent();
    expect(summaryText).toContain('approved applicants assigned');
    expect(summaryText).toContain('table-days used');
    expect(summaryText).toContain('unassigned');
    // Named and defined where it is shown: it used to be a bare "Satisfaction Score" with no
    // definition, no breakdown and no tooltip anywhere in the product.
    expect(summaryText).toContain('satisfaction');
    await expect(page.getByText('share of the dates vendors asked for')).toBeVisible();

    // Download CSV is the thing here that is actually an action. Done and Back are gone:
    // publishing is a step on the phase strip, and "I have finished looking at this" is what
    // leaving a page already is (E10/F03/S01).
    await expect(resultsPage.downloadCsvButton).toBeVisible();
    await expect(page.getByTestId('assignment-results-done-button')).toHaveCount(0);
    await expect(page.getByTestId('assignment-results-back-button')).toHaveCount(0);

    // Vendors is a page of the same tab now, not a quick link (E22/F04/S02).
    await expect(page.getByTestId('market-pages-vendors')).toBeVisible();

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
    // Its vendors are told first, on its vendor page, on this path too (ADR 0022).
    await setupPage.publishResults(marketId);
    await page.goto(marketSetupPath(marketId));
    await setupPage.advancePhaseTo('market_days', 'Market Days');

    // Its vendors reach their vendor page, where they check in on the day (ADR 0022).
    const slug = marketNameToSlug(marketName);
    const vendorPage = new VendorPage(page);
    await vendorPage.goto(slug);
    await expect(vendorPage.marketName).toHaveText(marketName);
    await page.screenshot({
      path: testInfo.outputPath('02-published-market-checkin.png'),
      fullPage: true,
    });

    // The server advanced the phase, and reports isDraft derived from it.
    const storedRes = await page.request.get(`${APP_API}/markets/${marketId}`);
    expect(storedRes.ok()).toBe(true);
    const { market: storedMarket } = (await storedRes.json()) as {
      market: { phase: string; isDraft: boolean };
    };
    // A published market is RUNNING, so its phase is market_days (E03/F03). `archived` now means
    // finished - a market that has run and is over, or one abandoned before it ever ran.
    expect(storedMarket.phase).toBe('market_days');
    expect(storedMarket.isDraft).toBe(false);

    // Reopening the published market from the markets list lands on the market's own screens - on
    // Attendance, the page a running market is worked on (E22/F04/S02).
    // This used to route on phase and send a published market to `/<slug>`, its public page -
    // which the intake-mode gate serves only to form-intake markets, so every MVP market landed
    // on "Page not found". The old assertion here waited for that URL and passed, because the URL
    // was right and only the page was wrong; this asserts what rendered.
    const markets = new MarketsPage(page);
    await markets.goto();
    await markets.narrowTo(marketName);
    await markets.card(marketName).first().click();
    await page.waitForURL(/\/markets\/[^/]+\/attendance$/, { timeout: 10000 });
    await expect(page.getByTestId('page-not-found')).toHaveCount(0);
    await expect(page.getByTestId('market-bar-title')).toHaveText(marketName, { timeout: 10000 });

    // Phase 5: A vendor signs in on their page and reads where they sit.
    forgetSignInAttempts();
    await vendorPage.goto(slug);
    await signInOnThePage(vendorPage, marketId, 'alice@example.com');
    await expect(vendorPage.status).toContainText('You have a table');
    await page.screenshot({
      path: testInfo.outputPath('03-checkin-after-publish.png'),
      fullPage: true,
    });
  });
});
