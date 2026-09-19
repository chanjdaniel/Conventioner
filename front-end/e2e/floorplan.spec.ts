import path from 'path';
import { fileURLToPath } from 'url';
import {
  test,
  expect,
  MarketSetupPage,
  FloorplanWorkflowPage,
  BACKEND_URL,
  TEST_USER,
} from './fixtures';
import { ensureTestOrg, loginViaApi } from './helpers/seeds';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOORPLAN_PATH = path.resolve(__dirname, 'fixtures', 'test-floorplan.png');

test.describe('Floorplan workflow E2E', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('create market from floorplan, complete wizard, and verify save', async ({
    authenticatedPage: page,
  }) => {
    const marketName = `Floorplan E2E ${Date.now()}`;

    // Create the market via API instead of CSV upload through the UI overlay.
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

    const setupPage = new MarketSetupPage(page);
    await setupPage.waitForWizard();

    // No Manage Columns step, and no paging: the plan is one page (E10/F02/S01).
    await setupPage.addMarketDate('2026-07-15', 0);

    const floorplanPage = new FloorplanWorkflowPage(page);
    await floorplanPage.selectFloorplanPath();
    await floorplanPage.completeFloorplanWorkflow(FLOORPLAN_PATH);

    await expect(page).toHaveURL(/\/market-setup/);
    await setupPage.waitForWizard();

    // Verify placed tables survived the step-2 to step-3 transition.
    // If the initFloorplan bug resets placedTables, this fails.
    const survivingTables = await floorplanPage.snapshotPlacedTables();
    expect(survivingTables.length).toBeGreaterThan(0);

    // The wizard's tier/location/section page is reachable.
    await expect(page.locator('.plan-row--triple')).toBeVisible({ timeout: 5000 });

    // The floorplan's own sections and locations reached the market plan, which is the "verify
    // save" this test is named for. It used to assert that rows were RENDERED on that page,
    // which passed only because the tier list was pre-filled by scraping the uploaded
    // spreadsheet's cell values - an artifact of the CSV era, not of the floorplan.
    const savedRes = await ctx.get(`${BACKEND_URL}/markets/${marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(savedRes.ok()).toBeTruthy();
    const saved = (await savedRes.json()) as {
      market: { setupObject?: { sections?: unknown[]; locations?: unknown[] } };
    };
    expect(saved.market.setupObject?.sections?.length ?? 0).toBeGreaterThan(0);
    expect(saved.market.setupObject?.locations?.length ?? 0).toBeGreaterThan(0);
  });
});
