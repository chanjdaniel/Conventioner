import {
  test,
  expect,
  TEST_USER,
  MarketSetupPage,
  OrganizationsPage,
  ManageMarketPage,
  BACKEND_URL,
  APP_API,
} from './fixtures';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { SEED_MARKET_DATE, ensureTestOrgAuthenticated } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { MarketsPage } from './pages/MarketsPage';

const SECOND_USER = {
  email: 'e2e-second@example.com',
  password: 'e2esecond123',
};

const THIRD_USER = {
  email: 'e2e-third@example.com',
  password: 'e2ethird123',
};

test.describe('Tier 2 - Organization CRUD', () => {
  test.beforeAll(() => {
    for (const user of [SECOND_USER, THIRD_USER]) {
      ensureVerifiedUser(user.email, user.password);
    }
  });

  test('create org, manage roles, rename, and delete', async ({ authenticatedPage: page }) => {
    const orgsPage = new OrganizationsPage(page);
    await orgsPage.goto();
    await orgsPage.waitForLoaded();

    const orgName = `E2E Org ${Date.now()}`;

    await orgsPage.createOrg(orgName);
    const manageButton = (await orgsPage.findCard(orgName)).getByTestId(
      'organizations-manage-button',
    );

    // ONE session. Every membership change used to close this dialog, so each of these steps
    // needed the dialog reopened first (E20/F01/S02) - which is the defect, written down.
    await manageButton.click();
    await orgsPage.waitForManageOverlay();

    await orgsPage.addAdmin(SECOND_USER.email);
    await expect(orgsPage.adminEmails.filter({ hasText: SECOND_USER.email })).toBeVisible({
      timeout: 5000,
    });
    await expect(orgsPage.manageWindow).toBeVisible();

    await orgsPage.addMember(THIRD_USER.email);
    await expect(orgsPage.memberEmails.filter({ hasText: THIRD_USER.email })).toBeVisible({
      timeout: 5000,
    });
    await expect(orgsPage.manageWindow).toBeVisible();

    const memberRemove = orgsPage.removeMemberButtons.first();
    await expect(memberRemove).toBeVisible({ timeout: 5000 });
    // Remove asks first (E38/F15/S01).
    await memberRemove.click();
    await orgsPage.confirmRemove();
    await expect(orgsPage.memberEmails.filter({ hasText: THIRD_USER.email })).toHaveCount(0, {
      timeout: 5000,
    });
    await expect(orgsPage.manageWindow).toBeVisible();

    const newName = `${orgName} (renamed)`;
    await orgsPage.renameOrg(newName);
    await expect(orgsPage.manageWindow).toBeVisible();

    // Deleting IS one of the three correct closes: the thing being managed no longer exists.
    await orgsPage.deleteOrg();
    await expect(orgsPage.manageWindow).toBeHidden({ timeout: 5000 });

    await expect(
      page.getByTestId('organization-card').filter({ hasText: newName }),
    ).not.toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe('Tier 2 - Market role management', () => {
  let marketName: string;

  test.beforeAll(async ({ request }) => {
    ensureVerifiedUser(SECOND_USER.email, SECOND_USER.password);

    const loginRes = await request.post(`${BACKEND_URL}/login`, {
      data: { email: TEST_USER.email, password: TEST_USER.password },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!loginRes.ok()) {
      throw new Error(`Login failed: ${loginRes.status()} ${await loginRes.text()}`);
    }
    const loginBody = (await loginRes.json()) as { user_data: { id: string } };
    const userId = loginBody.user_data.id;

    const orgId = await ensureTestOrgAuthenticated(request, BACKEND_URL);

    marketName = `E2E Market Roles ${Date.now()}`;
    const marketRes = await request.post(`${BACKEND_URL}/markets`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        name: marketName,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
        roles: { [userId]: 'owner' },
        modificationList: [],
        assignmentObject: {},
      },
    });
    if (!marketRes.ok()) {
      throw new Error(`Market creation failed: ${marketRes.status()} ${await marketRes.text()}`);
    }
  });

  test('add user, change role, and remove user from market', async ({
    authenticatedPage: page,
  }) => {
    const markets = new MarketsPage(page);
    await markets.goto();
    await markets.narrowTo(marketName);
    const marketCard = markets.card(marketName);

    const manageButton = marketCard.getByTestId('market-card-manage-button');
    await manageButton.click();

    const manageMarket = new ManageMarketPage(page);
    await manageMarket.waitForOverlay();

    await manageMarket.addUser(SECOND_USER.email, 'editor');
    await page.waitForTimeout(1000);

    await expect(page.locator('.user-card').filter({ hasText: SECOND_USER.email })).toBeVisible({
      timeout: 5000,
    });

    // A role the caller may change is the SELECT itself now, not a badge wrapping a transparent
    // one behind a hand-drawn chevron (E20/F01/S03). Its value is the role, which is a more honest
    // thing to assert than the colour class the badge happened to carry.
    const roleSelect = page
      .locator('.user-card')
      .filter({ hasText: SECOND_USER.email })
      .getByTestId('manage-market-role-select');
    await expect(roleSelect).toHaveValue('editor');

    await roleSelect.selectOption('viewer');
    await manageMarket.roleChangeConfirmButton.click();
    await expect(manageMarket.roleChangeConfirm).toHaveCount(0);
    await expect(roleSelect).toHaveValue('viewer', { timeout: 5000 });

    const removeButton = page
      .locator('.user-card')
      .filter({ hasText: SECOND_USER.email })
      .getByTestId('manage-market-remove-user-button');
    // Remove asks first (E38/F15/S01).
    await removeButton.click();
    await page.getByTestId('manage-market-remove-submit-button').click();

    await expect(page.locator('.user-card').filter({ hasText: SECOND_USER.email })).not.toBeVisible(
      { timeout: 5000 },
    );
  });
});

test.describe('Tier 2 - Assignment CSV export', () => {
  let marketId: string;

  test.beforeAll(async ({ request }) => {
    const seed = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    marketId = seed.marketId;
  });

  test('download CSV with expected columns', async ({ authenticatedPage: page }) => {
    await page.evaluate((user: string) => {
      localStorage.setItem('user', JSON.stringify(user));
    }, TEST_USER.email);

    // The assignment is read on the Assignments page (E22/F04/S04), addressed by the market's id.
    await page.goto(marketScreenPath(marketId, 'assignments'));
    await expect(page.getByTestId('result-strip')).toBeVisible({ timeout: 15000 });

    const downloadButton = page.getByTestId('result-download-csv-button');
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

    // The export describes what the solver decided: the vendor's address, then one column per
    // market date holding "<table code> - <table choice>". It used to carry the organizer's own
    // spreadsheet columns through verbatim, which is why it needed the upload still on hand at
    // download time.
    for (const col of ['email', SEED_MARKET_DATE]) {
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
    const seed = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    marketId = seed.marketId;
    slug = seed.slug;
  });

  test('publish market and verify check-in URL', async ({ authenticatedPage: page }) => {
    await page.evaluate((user: string) => {
      localStorage.setItem('user', JSON.stringify(user));
    }, TEST_USER.email);

    // Publishing is a step on the phase strip, not a Done button on the results screen
    // (E10/F03/S01): that button posted a transition invalid from the phase the organizer was
    // standing in, and failed with a raw enum error.
    // Publishing is `assignment -> market_days`, so the market has to BE in assignment. The seed
    // is shared across this file's tests, so walk only the steps still ahead of it. Its vendors
    // are already approved, so the review guard passes.
    const PATH_TO_ASSIGNMENT = ['draft', 'applications', 'assignment'];
    const marketRes = await page.request.get(`${APP_API}/markets/${encodeURIComponent(marketId)}`);
    expect(marketRes.ok()).toBeTruthy();
    const marketData = (await marketRes.json()).market as Record<string, unknown>;
    const startAt = PATH_TO_ASSIGNMENT.indexOf(String(marketData.phase ?? 'draft'));
    for (const toPhase of PATH_TO_ASSIGNMENT.slice(startAt + 1)) {
      const res = await page.request.post(
        `${APP_API}/markets/${encodeURIComponent(marketId)}/transition`,
        {
          headers: { 'Content-Type': 'application/json' },
          data: { toPhase },
        },
      );
      expect(res.ok(), `transition to ${toPhase}: ${await res.text()}`).toBeTruthy();
    }

    const setupPage = new MarketSetupPage(page);
    // Its vendors are told first, on its vendor page, on this path too (ADR 0022).
    await setupPage.publishResults(marketId);
    await page.goto(marketSetupPath(marketId));
    await setupPage.advancePhaseTo('market_days', 'Market Days');

    // Its vendors reach their vendor page, where they check in; it is open to every published
    // market, however its vendors arrived (ADR 0022).
    await page.goto(`/${slug}`);
    await expect(page.getByTestId('vendor-page-market-name')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('vendor-sign-in-email-input')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('vendor-page-not-found')).toHaveCount(0);
  });
});
