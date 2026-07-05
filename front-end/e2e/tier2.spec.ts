import { test, expect, TEST_USER, OrganizationsPage, ManageMarketPage, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';

const SECOND_USER = {
  email: 'e2e-second@example.com',
  password: 'e2esecond123',
};

const THIRD_USER = {
  email: 'e2e-third@example.com',
  password: 'e2ethird123',
};

test.describe('Tier 2 - Organization CRUD', () => {
  test.beforeAll(async ({ request }) => {
    for (const user of [SECOND_USER, THIRD_USER]) {
      const res = await request.post(`${BACKEND_URL}/register-user`, {
        data: { email: user.email, password: user.password },
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok()) {
        const body = await res.text();
        if (res.status() !== 409 && !body.includes('already exists')) {
          throw new Error(`Failed to create user ${user.email}: ${res.status()} ${body}`);
        }
      }
    }
  });

  test('create org, manage roles, rename, and delete', async ({ authenticatedPage: page }) => {
    const orgsPage = new OrganizationsPage(page);
    await orgsPage.goto();
    await orgsPage.waitForLoaded();

    const orgName = `E2E Org ${Date.now()}`;

    await orgsPage.createOrg(orgName);
    await expect(page.locator('.org-card').filter({ hasText: orgName })).toBeVisible({ timeout: 10000 });

    const manageButton = page.locator('.org-card').filter({ hasText: orgName }).getByTestId('organizations-manage-button');

    await manageButton.click();
    await orgsPage.waitForManageOverlay();
    await orgsPage.addAdmin(SECOND_USER.email);
    await page.waitForTimeout(500);

    await manageButton.click();
    await orgsPage.waitForManageOverlay();
    await orgsPage.addMember(THIRD_USER.email);
    await page.waitForTimeout(500);

    await manageButton.click();
    await orgsPage.waitForManageOverlay();
    const memberRemove = orgsPage.removeMemberButtons.first();
    await expect(memberRemove).toBeVisible({ timeout: 5000 });
    await memberRemove.click();
    await page.waitForTimeout(500);

    await manageButton.click();
    await orgsPage.waitForManageOverlay();
    const newName = `${orgName} (renamed)`;
    await orgsPage.renameOrg(newName);
    await page.waitForTimeout(500);

    await orgsPage.deleteOrg();
    await page.waitForTimeout(500);

    await expect(page.locator('.org-card').filter({ hasText: newName })).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('Tier 2 - Market role management', () => {
  let marketName: string;

  test.beforeAll(async ({ request }) => {
    const userRes = await request.post(`${BACKEND_URL}/register-user`, {
      data: { email: SECOND_USER.email, password: SECOND_USER.password },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!userRes.ok()) {
      const body = await userRes.text();
      if (userRes.status() !== 409 && !body.includes('already exists')) {
        throw new Error(`Failed to create second user: ${userRes.status()} ${body}`);
      }
    }

    const loginRes = await request.post(`${BACKEND_URL}/login`, {
      data: { email: TEST_USER.email, password: TEST_USER.password },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!loginRes.ok()) {
      throw new Error(`Login failed: ${loginRes.status()} ${await loginRes.text()}`);
    }
    const loginBody = await loginRes.json() as { user_data: { id: string } };
    const userId = loginBody.user_data.id;

    marketName = `E2E Market Roles ${Date.now()}`;
    const marketRes = await request.post(`${BACKEND_URL}/markets`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: {
        name: marketName,
        creationDate: new Date().toISOString(),
        roles: { [userId]: 'owner' },
        modificationList: [],
        assignmentObject: {},
      },
    });
    if (!marketRes.ok()) {
      throw new Error(`Market creation failed: ${marketRes.status()} ${await marketRes.text()}`);
    }
  });

  test('add user, change role, and remove user from market', async ({ authenticatedPage: page }) => {
    await page.goto('/markets');
    await expect(page.locator('.markets-view')).toBeVisible({ timeout: 10000 });

    const marketCard = page.locator('.market-card').filter({ hasText: marketName });
    await expect(marketCard).toBeVisible({ timeout: 10000 });

    const manageButton = marketCard.getByTestId('market-card-manage-button');
    await manageButton.click();

    const manageMarket = new ManageMarketPage(page);
    await manageMarket.waitForOverlay();

    await manageMarket.addUser(SECOND_USER.email, 'editor');
    await page.waitForTimeout(1000);

    await expect(page.locator('.user-card').filter({ hasText: SECOND_USER.email })).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.user-card').filter({ hasText: SECOND_USER.email }).locator('.role-editor')).toBeVisible();

    const roleSelect = page.locator('.user-card').filter({ hasText: SECOND_USER.email }).getByTestId('manage-market-role-select');
    await roleSelect.selectOption('viewer');
    await page.waitForTimeout(1000);

    await expect(page.locator('.user-card').filter({ hasText: SECOND_USER.email }).locator('.role-viewer')).toBeVisible({ timeout: 5000 });

    const removeButton = page.locator('.user-card').filter({ hasText: SECOND_USER.email }).getByTestId('manage-market-remove-user-button');
    await removeButton.click();
    await page.waitForTimeout(1000);

    await expect(page.locator('.user-card').filter({ hasText: SECOND_USER.email })).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe('Tier 2 - Assignment CSV export', () => {
  let marketId: string;

  test.beforeAll(async ({ request }) => {
    const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    marketId = seed.marketId;
  });

  test('download CSV with expected columns', async ({ authenticatedPage: page }) => {
    const marketRes = await page.request.get(`${BACKEND_URL}/markets/${encodeURIComponent(marketId)}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(marketRes.ok()).toBeTruthy();
    const marketData = (await marketRes.json()).market as Record<string, unknown>;

    await page.evaluate(({ market, user }) => {
      localStorage.setItem('market', JSON.stringify(market));
      localStorage.setItem('user', JSON.stringify(user));
    }, { market: marketData, user: TEST_USER.email });

    await page.goto('/assignment-results');
    await expect(page.locator('.generate-assignment-view')).toBeVisible({ timeout: 15000 });

    const downloadButton = page.getByTestId('assignment-results-download-csv-button');
    await expect(downloadButton).toBeEnabled({ timeout: 15000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await downloadButton.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain('.csv');

    const stream = await download.createReadStream();
    if (!stream) {
      throw new Error('Download stream is null - download may have failed');
    }
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const csvContent = Buffer.concat(chunks).toString('utf-8');
    const headerLine = csvContent.split('\n')[0].trim();

    // The export is a wide-format CSV: the included source columns followed by
    // one column per market date (the date string itself). Each date cell holds
    // the vendor's "<table_code> - <table_choice>" assignment.
    const expectedColumns = ['email', 'vendor_name', 'table_choice', 'buddy_email', 'day_1', '2025-06-01'];
    for (const col of expectedColumns) {
      expect(headerLine.toLowerCase()).toContain(col.toLowerCase());
    }

    // The engine's assignments must land in the date column cells.
    expect(csvContent.toLowerCase()).toContain('hall a');
  });
});

test.describe('Tier 2 - Publish market', () => {
  let marketId: string;
  let slug: string;

  test.beforeAll(async ({ request }) => {
    const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    marketId = seed.marketId;
    slug = seed.slug;
  });

  test('publish market and verify check-in URL', async ({ authenticatedPage: page }) => {
    const marketRes = await page.request.get(`${BACKEND_URL}/markets/${encodeURIComponent(marketId)}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(marketRes.ok()).toBeTruthy();
    const marketData = (await marketRes.json()).market as Record<string, unknown>;

    await page.evaluate(({ market, user }) => {
      localStorage.setItem('market', JSON.stringify(market));
      localStorage.setItem('user', JSON.stringify(user));
    }, { market: marketData, user: TEST_USER.email });

    await page.goto('/assignment-results');
    await expect(page.locator('.generate-assignment-view')).toBeVisible({ timeout: 15000 });

    const doneButton = page.getByTestId('assignment-results-done-button');
    await doneButton.click();

    await page.waitForURL(`**/${slug}`, { timeout: 10000 });

    await page.goto(`/${slug}/check-in`);
    await expect(page.locator('.attendance-view')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('attendance-checkin-email-input')).toBeVisible({ timeout: 5000 });
  });
});
