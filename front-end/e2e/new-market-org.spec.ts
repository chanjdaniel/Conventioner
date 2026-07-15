import { test, expect, LoginPage, NewMarketPage, BACKEND_URL, TEST_USER } from './fixtures';
import { ensureTestOrg, loginViaApi } from './helpers/seeds';

/**
 * Verified user that deliberately belongs to no organization.
 * Created by scripts/seed_fixture.sh alongside TEST_USER.
 */
const NO_ORG_USER = {
  email: 'e2e-noorg@example.com',
  password: 'e2enoorg123',
};

/**
 * D14: every market requires an organization at creation. An org-less market is
 * not a valid state, so the overlay must block submission until one is picked,
 * and a user with no organizations must be routed to create one first.
 */
test.describe('New market - organization is required', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('API enforces organization at market creation', async ({ request }) => {
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);

    const orgsRes = await request.get(`${BACKEND_URL}/organizations`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(orgsRes.ok()).toBe(true);
    const orgs = (await orgsRes.json()).organizations as { id: string; name: string }[];
    expect(orgs.length).toBeGreaterThan(0);

    const orgId = orgs[0].id;

    // POST /markets without organizationId is rejected.
    const noOrgRes = await request.post(`${BACKEND_URL}/markets`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Owner-Email': TEST_USER.email,
      },
      data: {
        name: `No Org E2E ${Date.now()}`,
        creationDate: new Date().toISOString(),
        roles: { [TEST_USER.email]: 'owner' },
        modificationList: [],
        assignmentObject: {},
      },
    });
    expect(noOrgRes.ok()).toBe(false);
    expect(noOrgRes.status()).toBe(400);
    expect((await noOrgRes.json()).error).toMatch(/organization/i);

    // POST /markets with a valid organizationId succeeds.
    const marketName = `API Org Required ${Date.now()}`;
    const createRes = await request.post(`${BACKEND_URL}/markets`, {
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
    expect(createRes.ok()).toBe(true);
    const { market_id: marketId } = (await createRes.json()) as { market_id: string };

    // The persisted market carries the organizationId that was submitted.
    const marketRes = await request.get(`${BACKEND_URL}/markets/${marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(marketRes.ok()).toBe(true);
    const { market } = (await marketRes.json()) as { market: { organizationId: string } };
    expect(market.organizationId).toBe(orgId);
  });

  test('user with no organizations cannot create a market via API', async ({ playwright }) => {
    const api = await playwright.request.newContext({
      baseURL: BACKEND_URL,
      ignoreHTTPSErrors: true,
    });
    await api.post('/login', {
      data: { email: NO_ORG_USER.email, password: NO_ORG_USER.password },
    });

    const orgsRes = await api.get('/organizations', {
      headers: { 'X-Owner-Email': NO_ORG_USER.email },
    });
    expect(orgsRes.ok()).toBe(true);
    const orgs = (await orgsRes.json()).organizations as { id: string }[];
    expect(orgs.length).toBe(0);

    // Without an organization to attach, the request is rejected.
    const createRes = await api.post('/markets', {
      data: {
        name: `Zero Org E2E ${Date.now()}`,
        creationDate: new Date().toISOString(),
        roles: { [NO_ORG_USER.email]: 'owner' },
        modificationList: [],
        assignmentObject: {},
      },
    });
    expect(createRes.ok()).toBe(false);
    expect(createRes.status()).toBe(400);

    await api.dispose();
  });

  test('org picker gates submission in the overlay', async ({
    authenticatedPage: page,
  }, testInfo) => {
    const newMarketPage = new NewMarketPage(page);

    await page.goto('/markets');
    await page.getByTestId('markets-create-button').click();
    await newMarketPage.waitForOverlay();

    // Nothing selected yet, so the market cannot be created.
    await expect(newMarketPage.orgSelect).toHaveValue('');
    await expect(newMarketPage.submitButton).toBeDisabled();
    await newMarketPage.fillMarketName(`Org Gate E2E ${Date.now()}`);
    await expect(newMarketPage.submitButton).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('01-submit-blocked-no-org.png') });

    // Picking an organization unlocks submission.
    await newMarketPage.selectFirstOrg();
    await expect(newMarketPage.submitButton).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('02-org-selected-submit-enabled.png') });
  });

  test('a user with no organizations is pointed at organization creation', async ({
    page,
  }, testInfo) => {
    const loginPage = new LoginPage(page);
    await loginPage.login(NO_ORG_USER.email, NO_ORG_USER.password);
    await loginPage.waitForDashboardRedirect();

    const newMarketPage = new NewMarketPage(page);
    await page.goto('/markets');
    await page.getByTestId('markets-create-button').click();
    await newMarketPage.waitForOverlay();

    await expect(newMarketPage.orgEmptyHint).toBeVisible();
    await expect(newMarketPage.orgSelect).toBeDisabled();
    await expect(newMarketPage.submitButton).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('03-zero-org-fallback.png') });

    await newMarketPage.orgCreateLink.click();
    await expect(page).toHaveURL(/\/organizations/);
  });
});
