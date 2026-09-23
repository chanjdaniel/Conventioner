import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { APIRequestContext } from '@playwright/test';
import { OrganizationsPage } from './pages/OrganizationsPage';
import { loginViaApi } from './helpers/seeds';

/**
 * Deleting an organization is safe (E20/F04/S01).
 *
 * Owner-only was the AUTHORITY rule and stays. This is the SAFETY rule it never had: deletion
 * used to set every one of the organization's markets to belong to nothing - a state
 * `POST /markets` refuses to produce, and one that made those markets invisible to everyone who
 * reached them through the organization.
 *
 * The risk is recorded rather than argued: an ARCHIVED market is still publicly served and holds
 * the placement record of a market that ran, and deleting one takes a live check-in URL off the
 * air with no undo. Reaffirmed on 2026-09-22 - which is why the confirmation has to NAME what
 * each deletion destroys.
 */

async function makeOrg(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post(`${BACKEND_URL}/organizations`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: { name },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const listed = await request.get(`${BACKEND_URL}/organizations`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
  });
  const orgs = ((await listed.json()) as { organizations: Array<{ id: string; name: string }> })
    .organizations;
  return orgs.find((o) => o.name === name)!.id;
}

async function makeMarket(
  request: APIRequestContext,
  orgId: string,
  name: string,
): Promise<string> {
  const res = await request.post(`${BACKEND_URL}/markets`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: {
      name,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      roles: { [TEST_USER.email]: 'owner' },
      modificationList: [],
      assignmentObject: {},
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { market_id: string }).market_id;
}

async function transition(request: APIRequestContext, marketId: string, toPhase: string) {
  const res = await request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
    data: { toPhase },
  });
  expect(res.ok(), `transition to ${toPhase}: ${await res.text()}`).toBeTruthy();
}

test.describe('Deleting an organization', () => {
  test.beforeEach(async ({ request }) => {
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('is refused while it holds a market that is under way, and names which', async ({
    authenticatedPage: page,
    request,
  }) => {
    const orgName = `E2E DelBlocked ${Date.now()}`;
    const orgId = await makeOrg(request, orgName);
    const liveName = `Live Market ${Date.now()}`;
    const live = await makeMarket(request, orgId, liveName);
    // A form of essential questions alone is a form, so a plan with dates opens applications.
    await request.put(`${BACKEND_URL}/markets/${live}/application-form`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { fields: [{ key: 'business_name', label: 'Business name', type: 'text', order: 0 }] },
    });
    await transition(request, live, 'applications_open');

    const orgs = new OrganizationsPage(page);
    await orgs.goto();
    await orgs.waitForLoaded();
    const card = page.getByTestId('organization-card').filter({ hasText: orgName });
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.getByTestId('organizations-manage-button').click();
    await orgs.waitForManageOverlay();
    await orgs.clickDelete();

    await expect(orgs.deleteBlocked).toBeVisible({ timeout: 10000 });
    // NAMED. "You cannot delete this" without saying which market is a refusal an organizer can
    // only answer by guessing.
    await expect(orgs.blockingMarkets.filter({ hasText: liveName })).toBeVisible();
    await expect(orgs.deleteConfirmButton).toBeDisabled();

    // Server-side too, not merely a disabled button.
    const direct = await request.delete(`${BACKEND_URL}/organizations/${orgId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(direct.status()).toBe(409);
    expect((await direct.json()).error).toBe('organization_has_live_markets');

    // And nothing was destroyed on the way to refusing.
    const stillThere = await request.get(`${BACKEND_URL}/markets/${live}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(stillThere.status()).toBe(200);
  });

  test('names what it destroys per market, then destroys it', async ({
    authenticatedPage: page,
    request,
  }, testInfo) => {
    const orgName = `E2E DelSafe ${Date.now()}`;
    const orgId = await makeOrg(request, orgName);
    const draftName = `Forgotten Draft ${Date.now()}`;
    const archivedName = `Market That Ran ${Date.now()}`;
    const draft = await makeMarket(request, orgId, draftName);
    const archived = await makeMarket(request, orgId, archivedName);
    // draft -> archived is the publish path, which is what gives it a public check-in URL.
    await transition(request, archived, 'archived');

    const orgs = new OrganizationsPage(page);
    await orgs.goto();
    await orgs.waitForLoaded();
    const card = page.getByTestId('organization-card').filter({ hasText: orgName });
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.getByTestId('organizations-manage-button').click();
    await orgs.waitForManageOverlay();
    await orgs.clickDelete();

    await expect(orgs.deleteWindow).toBeVisible({ timeout: 5000 });
    await expect(orgs.doomedMarkets).toHaveCount(2, { timeout: 10000 });
    // A COUNT of markets does not let an organizer decide. Both are named.
    await expect(orgs.doomedMarkets.filter({ hasText: draftName })).toBeVisible();
    await expect(orgs.doomedMarkets.filter({ hasText: archivedName })).toBeVisible();

    // The URL that stops resolving is named, for the archived market and not for the draft.
    const archivedRow = orgs.doomedMarkets.filter({ hasText: archivedName });
    await expect(archivedRow.getByTestId('delete-org-public-url')).toBeVisible();
    await expect(
      orgs.doomedMarkets.filter({ hasText: draftName }).getByTestId('delete-org-public-url'),
    ).toHaveCount(0);

    // One of the two irreversible actions in the product; it gets looked at.
    await page.screenshot({ path: testInfo.outputPath('01-delete-org-confirmation.png') });

    await orgs.confirmDelete();
    await expect(card).not.toBeVisible({ timeout: 10000 });

    // Both markets went with it - not detached, gone.
    for (const marketId of [draft, archived]) {
      const gone = await request.get(`${BACKEND_URL}/markets/${marketId}`, {
        headers: { 'X-Owner-Email': TEST_USER.email },
      });
      expect(gone.status(), 'a market was left belonging to nothing').toBe(404);
    }
  });

  test('an organization with no markets says so and deletes cleanly', async ({
    authenticatedPage: page,
    request,
  }) => {
    const orgName = `E2E DelEmpty ${Date.now()}`;
    await makeOrg(request, orgName);

    const orgs = new OrganizationsPage(page);
    await orgs.goto();
    await orgs.waitForLoaded();
    const card = page.getByTestId('organization-card').filter({ hasText: orgName });
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.getByTestId('organizations-manage-button').click();
    await orgs.waitForManageOverlay();
    await orgs.clickDelete();

    await expect(page.getByTestId('delete-org-no-markets')).toBeVisible({ timeout: 10000 });
    await orgs.confirmDelete();
    await expect(card).not.toBeVisible({ timeout: 10000 });
  });
});
