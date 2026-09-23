import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { test, expect, TEST_USER, LoginPage, OrganizationsPage, BACKEND_URL } from './fixtures';
import { loginViaApi } from './helpers/seeds';
import { ensureVerifiedUser } from './helpers/verifiedUser';

// ── Test user credentials ──
const ORG_MEMBER = {
  email: 'e2e-access-member@example.com',
  password: 'e2eaccessmember123',
};
const OUTSIDER = {
  email: 'e2e-access-outsider@example.com',
  password: 'e2eaccessoutsider123',
};

// ── Helpers ──

/**
 * Log a user in inside their own browser context, so no two users in a test ever share a
 * session cookie or the persisted `user` in localStorage. The context is closed afterwards.
 */
async function withUser<T>(
  browser: Browser,
  email: string,
  password: string,
  body: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const loginPage = new LoginPage(page);
    await loginPage.login(email, password);
    await loginPage.waitForDashboardRedirect();
    return await body(page);
  } finally {
    await context.close();
  }
}

/**
 * Open /markets and wait for the fetch to settle.
 *
 * `.markets-view` is on the page from first render, and the card list only exists once the
 * fetch resolves, so waiting on the view alone would let a `not.toBeVisible()` pass against a
 * DOM that is still showing "Loading markets...". Waiting for the loading state to clear -
 * and asserting the fetch did not error - is what makes the negative assertions mean anything.
 */
async function gotoMarketsLoaded(page: Page): Promise<void> {
  await page.goto('/markets');
  await page.waitForSelector('.markets-view', { timeout: 10000 });
  await expect(
    page.locator('.markets-view .empty-state').filter({ hasText: 'Loading markets' }),
  ).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('.markets-view .error-state')).toHaveCount(0);
}

function marketCard(page: Page, marketName: string) {
  return page.locator('[data-testid="market-card"]').filter({ hasText: marketName });
}

/**
 * Create a unique org for a test and return the TEST_USER's user ID.
 * Returns the new org's ID, name, and the owner's user ID.
 */
async function createTestOrg(
  request: APIRequestContext,
  name: string,
): Promise<{ orgId: string; orgName: string; ownerUserId: string }> {
  const ownerUserId = await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);

  const orgName = `${name} ${Date.now()}`;
  const createRes = await request.post(`${BACKEND_URL}/organizations`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': TEST_USER.email,
    },
    data: { name: orgName },
  });
  if (!createRes.ok()) {
    throw new Error(`Org creation failed: ${createRes.status()} ${await createRes.text()}`);
  }
  const orgId = (await createRes.json()).organization_id as string;
  return { orgId, orgName, ownerUserId };
}

/** Add a user to an org as TEST_USER (the org owner). Throws on rejection. */
async function addOrgMember(
  request: APIRequestContext,
  orgId: string,
  userEmail: string,
): Promise<void> {
  const res = await request.post(`${BACKEND_URL}/organizations/${orgId}/members`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': TEST_USER.email,
    },
    data: { user_email: userEmail },
  });
  if (!res.ok()) {
    throw new Error(`Add member failed: ${res.status()} ${await res.text()}`);
  }
}

/** Create a market owned by TEST_USER in `orgId`. Throws on rejection. */
async function createMarket(
  request: APIRequestContext,
  name: string,
  orgId: string,
  ownerUserId: string,
): Promise<string> {
  const res = await request.post(`${BACKEND_URL}/markets`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': TEST_USER.email,
    },
    data: {
      name,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      roles: { [ownerUserId]: 'owner' },
      modificationList: [],
      assignmentObject: {},
    },
  });
  if (!res.ok()) {
    throw new Error(`Market creation failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()).market_id as string;
}

/**
 * GET /markets/{id} for a user. Logs in via API first so the session is valid.
 */
async function apiGetMarket(
  request: APIRequestContext,
  email: string,
  password: string,
  marketId: string,
): Promise<{ status: number; body: unknown }> {
  await loginViaApi(request, BACKEND_URL, email, password);
  const res = await request.get(`${BACKEND_URL}/markets/${encodeURIComponent(marketId)}`, {
    headers: { 'X-Owner-Email': email },
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status(), body };
}

// ═══════════════════════════════════════════════════════════════════════════
// Org-membership visibility (the exact path that was silently broken)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Market visibility - org membership', () => {
  let marketId: string;
  let marketName: string;

  test.beforeAll(async ({ request }) => {
    ensureVerifiedUser(ORG_MEMBER.email, ORG_MEMBER.password);
    ensureVerifiedUser(OUTSIDER.email, OUTSIDER.password);

    const org = await createTestOrg(request, 'E2E Access Org');

    // Add ORG_MEMBER to the org (org-based VIEWER access, no explicit market role)
    await addOrgMember(request, org.orgId, ORG_MEMBER.email);

    marketName = `E2E Org Access ${Date.now()}`;
    marketId = await createMarket(request, marketName, org.orgId, org.ownerUserId);
  });

  test('org member sees market; outsider does not (paired)', async ({ browser, request }) => {
    // ── Positive: org member (no explicit role) sees the market ──
    await withUser(browser, ORG_MEMBER.email, ORG_MEMBER.password, async (page) => {
      await gotoMarketsLoaded(page);
      await expect(marketCard(page, marketName)).toBeVisible({ timeout: 10000 });
    });

    // Positive: org member can GET the single market by ID
    const memberGet = await apiGetMarket(request, ORG_MEMBER.email, ORG_MEMBER.password, marketId);
    expect(memberGet.status).toBe(200);
    const memberBody = memberGet.body as { market?: { name: string } };
    expect(memberBody.market?.name).toBe(marketName);

    // ── Negative: outsider does NOT see the market ──
    await withUser(browser, OUTSIDER.email, OUTSIDER.password, async (page) => {
      await gotoMarketsLoaded(page);
      await expect(marketCard(page, marketName)).not.toBeVisible({ timeout: 5000 });
      await expect(page.locator('[data-testid="market-card"]')).toHaveCount(0);
    });

    // Negative: outsider gets 404 on the single-market endpoint
    const outsiderGet = await apiGetMarket(request, OUTSIDER.email, OUTSIDER.password, marketId);
    expect(outsiderGet.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Explicit-role visibility (role on the market without org membership)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Market visibility - explicit role', () => {
  const EXPLICIT_USER = {
    email: 'e2e-access-explicit@example.com',
    password: 'e2eaccessexplicit123',
  };

  let marketId: string;
  let marketName: string;

  test.beforeAll(async ({ request }) => {
    ensureVerifiedUser(EXPLICIT_USER.email, EXPLICIT_USER.password);
    ensureVerifiedUser(OUTSIDER.email, OUTSIDER.password);

    const org = await createTestOrg(request, 'E2E Explicit Org');

    marketName = `E2E Explicit Role ${Date.now()}`;
    marketId = await createMarket(request, marketName, org.orgId, org.ownerUserId);

    // Give EXPLICIT_USER a viewer role on the market (they are NOT in the org)
    const roleRes = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Owner-Email': TEST_USER.email,
      },
      data: { user_email: EXPLICIT_USER.email, role: 'viewer' },
    });
    if (!roleRes.ok()) {
      throw new Error(`Viewer role grant failed: ${roleRes.status()} ${await roleRes.text()}`);
    }
  });

  test('user with explicit role sees market; outsider does not (paired)', async ({
    browser,
    request,
  }) => {
    // ── Positive: explicit-role user sees the market ──
    await withUser(browser, EXPLICIT_USER.email, EXPLICIT_USER.password, async (page) => {
      await gotoMarketsLoaded(page);
      await expect(marketCard(page, marketName)).toBeVisible({ timeout: 10000 });
    });

    const roleGet = await apiGetMarket(
      request,
      EXPLICIT_USER.email,
      EXPLICIT_USER.password,
      marketId,
    );
    expect(roleGet.status).toBe(200);

    // ── Negative: outsider does NOT see the market ──
    await withUser(browser, OUTSIDER.email, OUTSIDER.password, async (page) => {
      await gotoMarketsLoaded(page);
      await expect(marketCard(page, marketName)).not.toBeVisible({ timeout: 5000 });
    });

    const outsiderGet = await apiGetMarket(request, OUTSIDER.email, OUTSIDER.password, marketId);
    expect(outsiderGet.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Org membership changes take effect (add → visible, remove → invisible)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Market visibility - org membership changes', () => {
  let marketId: string;
  let marketName: string;
  let orgId: string;

  test.beforeAll(async ({ request }) => {
    ensureVerifiedUser(ORG_MEMBER.email, ORG_MEMBER.password);

    const org = await createTestOrg(request, 'E2E Membership Org');
    orgId = org.orgId;

    marketName = `E2E Membership Chg ${Date.now()}`;
    marketId = await createMarket(request, marketName, orgId, org.ownerUserId);
  });

  test('add user to org grants visibility; remove revokes it', async ({ browser, request }) => {
    await withUser(browser, ORG_MEMBER.email, ORG_MEMBER.password, async (page) => {
      // ── Phase 1: Before adding to org, ORG_MEMBER does NOT see the market ──
      await gotoMarketsLoaded(page);
      await expect(marketCard(page, marketName)).not.toBeVisible({ timeout: 5000 });

      const getBefore = await apiGetMarket(
        request,
        ORG_MEMBER.email,
        ORG_MEMBER.password,
        marketId,
      );
      expect(getBefore.status).toBe(404);

      // ── Phase 2: Owner adds ORG_MEMBER to the org via API ──
      await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
      await addOrgMember(request, orgId, ORG_MEMBER.email);

      // ── Phase 3: Now ORG_MEMBER sees the market ──
      await gotoMarketsLoaded(page);
      await expect(marketCard(page, marketName)).toBeVisible({ timeout: 10000 });

      // ── Phase 4: Owner removes ORG_MEMBER from the org via API ──
      // Need the member's user ID to call the remove endpoint.
      const memberUser = await loginViaApi(
        request,
        BACKEND_URL,
        ORG_MEMBER.email,
        ORG_MEMBER.password,
      );
      await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
      const removeRes = await request.delete(
        `${BACKEND_URL}/organizations/${orgId}/users/${memberUser}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Owner-Email': TEST_USER.email,
          },
        },
      );
      if (!removeRes.ok()) {
        throw new Error(`Remove member failed: ${removeRes.status()} ${await removeRes.text()}`);
      }

      // ── Phase 5: ORG_MEMBER no longer sees the market ──
      await gotoMarketsLoaded(page);
      await expect(marketCard(page, marketName)).not.toBeVisible({ timeout: 5000 });
    });

    // ── API confirmation ──
    const getAfter = await apiGetMarket(request, ORG_MEMBER.email, ORG_MEMBER.password, marketId);
    expect(getAfter.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Org deletion does not strand markets visible to wrong people
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Market visibility - org deletion', () => {
  let marketId: string;
  let marketName: string;
  let orgId: string;
  let orgName: string;

  test.beforeAll(async ({ request }) => {
    ensureVerifiedUser(ORG_MEMBER.email, ORG_MEMBER.password);

    const org = await createTestOrg(request, 'E2E Delete Org');
    orgId = org.orgId;
    orgName = org.orgName;

    // Add ORG_MEMBER to the org
    await addOrgMember(request, orgId, ORG_MEMBER.email);

    marketName = `E2E DeleteOrg ${Date.now()}`;
    marketId = await createMarket(request, marketName, orgId, org.ownerUserId);
  });

  /**
   * Deleting an organization takes its drafts with it (E20/F04/S01).
   *
   * This used to assert the opposite half of the same act: the market SURVIVED, detached, and was
   * still reachable by anyone holding an explicit role on it. That detachment is the state the
   * story removed - a market belonging to nothing is one `POST /markets` refuses to produce, and
   * it was invisible to everyone who reached it through the organization.
   *
   * So what is pinned now is that the market is gone for EVERYBODY, including the owner, whose
   * explicit role is no longer a way to reach a market that no longer exists.
   */
  test('deleting an org deletes the drafts it holds, for the member and the owner alike', async ({
    browser,
    request,
  }) => {
    // Three full UI logins plus an org deletion do not fit the suite's default budget.
    test.setTimeout(60_000);

    // ── Phase 1: ORG_MEMBER sees the market via org membership ──
    await withUser(browser, ORG_MEMBER.email, ORG_MEMBER.password, async (page) => {
      await gotoMarketsLoaded(page);
      await expect(marketCard(page, marketName)).toBeVisible({ timeout: 10000 });
    });

    // An explicit role, so Phase 3 proves the market is GONE rather than merely unreachable.
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { user_email: TEST_USER.email, role: 'owner' },
    });

    // ── Phase 2: Owner deletes the org, and the confirmation names what goes with it ──
    await withUser(browser, TEST_USER.email, TEST_USER.password, async (page) => {
      await page.goto('/organizations');
      await page.waitForSelector('.organizations-view', { timeout: 10000 });

      const orgsPage = new OrganizationsPage(page);
      const orgCard = page.getByTestId('organization-card').filter({ hasText: orgName });
      await expect(orgCard).toBeVisible({ timeout: 5000 });

      await orgCard.getByTestId('organizations-manage-button').click();
      await orgsPage.waitForManageOverlay();

      await orgsPage.clickDelete();
      await expect(orgsPage.deleteWindow).toBeVisible({ timeout: 5000 });
      // Named, not counted: this is the market about to be destroyed.
      await expect(orgsPage.doomedMarkets.filter({ hasText: marketName })).toBeVisible({
        timeout: 10000,
      });

      await expect(orgsPage.deleteConfirmButton).toBeEnabled({ timeout: 10000 });
      await orgsPage.confirmDelete();

      await expect(orgCard).not.toBeVisible({ timeout: 5000 });
    });

    // ── Phase 3: it is gone, for the member and for the owner who holds an explicit role ──
    await withUser(browser, ORG_MEMBER.email, ORG_MEMBER.password, async (page) => {
      await gotoMarketsLoaded(page);
      await expect(marketCard(page, marketName)).not.toBeVisible({ timeout: 5000 });
    });

    const ownerGet = await apiGetMarket(request, TEST_USER.email, TEST_USER.password, marketId);
    expect(ownerGet.status, 'a deleted market is gone, not merely detached').toBe(404);

    const memberGet = await apiGetMarket(request, ORG_MEMBER.email, ORG_MEMBER.password, marketId);
    expect(memberGet.status).toBe(404);
  });
});
