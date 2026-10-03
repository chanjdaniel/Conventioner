import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrgAuthenticated, loginViaApi } from './helpers/seeds';

/**
 * Whoever creates a market owns it, whatever the request says (bug 46).
 *
 * `POST /markets` took the owner from the request body and only counted that there was one, so a
 * client could create a market owned by another user, or by an id that is nobody - which then sat
 * in the creator's organization with no one able to manage it.
 */
test('the signed-in creator is the market owner, whatever roles the body names', async ({
  request,
}) => {
  const creatorId = await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const orgId = await ensureTestOrgAuthenticated(request, BACKEND_URL, TEST_USER.email);

  for (const roles of [{ 'someone-else': 'owner' }, { undefined: 'owner' }, {}]) {
    const created = await request.post(`${BACKEND_URL}/markets`, {
      data: {
        name: `E2E Owner ${Date.now()} ${Object.keys(roles).length}`,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
        roles,
        modificationList: [],
        assignmentObject: {},
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { market_id: marketId } = (await created.json()) as { market_id: string };

    const res = await request.get(`${BACKEND_URL}/markets/${marketId}`);
    const { market } = (await res.json()) as { market: { roles: Record<string, string> } };
    expect(market.roles).toEqual({ [creatorId]: 'owner' });

    // And so the creator can do what an owner does.
    const renamed = await request.put(`${BACKEND_URL}/markets/${marketId}/name`, {
      data: { name: `E2E Owner renamed ${Date.now()}` },
    });
    expect(renamed.status(), await renamed.text()).toBe(200);
  }
});
