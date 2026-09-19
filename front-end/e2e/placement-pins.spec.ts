import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import type { APIRequestContext } from '@playwright/test';
import { loginViaApi, ensureTestOrgAuthenticated } from './helpers/seeds';
import {
  seedPhaseMarket,
  seedApplicationWithStatus,
  transitionMarket,
  type PhaseMarketSeed,
} from './helpers/seedPhaseMarket';

/**
 * A pin is a hand-placed row the solver must work around (E11).
 *
 * Driven through the API rather than the UI: the Tables view gains its place-and-swap controls in
 * `E11/F03/S01`, and until then these are the only callers there are. What is pinned here is the
 * behaviour those controls will sit on - the seat refusal, the orphan, and the blocker it raises -
 * so the UI story lands on coverage that already exists.
 */

const PLAN = {
  priority: [],
  marketDates: [{ date: '2026-08-01' }],
  tiers: [{ id: 1, name: 'Gold' }],
  locations: [{ name: 'Main Hall' }],
  sections: [
    { name: 'Front', location: { name: 'Main Hall' }, tier: { id: 1, name: 'Gold' }, count: 3 },
  ],
  assignmentOptions: { maxAssignmentsPerVendor: 1, maxHalfTableProportionPerSection: 50 },
};

async function setPlan(
  request: APIRequestContext,
  seed: PhaseMarketSeed,
  sectionCount: number,
): Promise<void> {
  const marketRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
  });
  const { market } = (await marketRes.json()) as { market: Record<string, unknown> };
  const res = await request.put(`${BACKEND_URL}/markets/${seed.marketId}`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: {
      ...market,
      setupObject: {
        ...PLAN,
        sections: [{ ...PLAN.sections[0], count: sectionCount }],
      },
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

function place(request: APIRequestContext, marketId: string, body: Record<string, unknown>) {
  return request.put(`${BACKEND_URL}/markets/${marketId}/placements`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: body,
  });
}

test.describe('Placement pins', () => {
  let seed: PhaseMarketSeed;

  test.beforeAll(async ({ request }) => {
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    await ensureTestOrgAuthenticated(request, BACKEND_URL, TEST_USER.email);
    seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    await setPlan(request, seed, 3);
    await transitionMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      seed.marketId,
      'applications_open',
    );
    await transitionMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      seed.marketId,
      'applications_closed',
    );
    await transitionMarket(request, BACKEND_URL, TEST_USER.email, seed.marketId, 'review');
    seedApplicationWithStatus(seed.marketId, 'reviewer_approved', 'pinned@example.com');
  });

  // `request` is test-scoped, so the session `beforeAll` signed in on is not this one's.
  test.beforeEach(async ({ request }) => {
    await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('a second pin to an occupied seat is refused, naming the vendor already there', async ({
    request,
  }) => {
    const first = await place(request, seed.marketId, {
      email: 'pinned@example.com',
      date: '2026-08-01',
      tableCode: 'Front 1',
      tableChoice: 'Full Table',
    });
    expect(first.ok(), await first.text()).toBeTruthy();

    const second = await place(request, seed.marketId, {
      email: 'other@example.com',
      date: '2026-08-01',
      tableCode: 'Front 1',
      tableChoice: 'Full Table',
    });

    expect(second.status()).toBe(409);
    expect(await second.text()).toContain('pinned@example.com');
  });

  test('an orphaned pin blocks the way into assignment, and clearing it unblocks', async ({
    request,
  }) => {
    // Pin the last table in the plan, then shrink the plan out from under it. The pin is not
    // deleted - a deliberate guarantee is never lost silently - so the reckoning lands here.
    const pinned = await place(request, seed.marketId, {
      email: 'pinned@example.com',
      date: '2026-08-01',
      tableCode: 'Front 3',
      tableChoice: 'Full Table',
    });
    expect(pinned.ok(), await pinned.text()).toBeTruthy();

    await setPlan(request, seed, 1);

    const blocked = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { toPhase: 'assignment' },
    });
    expect(blocked.ok()).toBeFalsy();
    const refusal = await blocked.text();
    expect(refusal).toContain('pinned@example.com');
    expect(refusal).toContain('Front 3');

    // The pin survived the plan edit rather than being deleted by it.
    const marketRes = await request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market } = (await marketRes.json()) as {
      market: { assignmentObject?: { vendorAssignments?: Array<{ tableCode: string }> } };
    };
    expect(
      (market.assignmentObject?.vendorAssignments ?? []).map((row) => row.tableCode),
    ).toContain('Front 3');

    // Re-placing it onto a seat the plan still has clears the blocker.
    const rePlaced = await place(request, seed.marketId, {
      email: 'pinned@example.com',
      date: '2026-08-01',
      tableCode: 'Front 1',
      tableChoice: 'Full Table',
    });
    expect(rePlaced.ok(), await rePlaced.text()).toBeTruthy();

    const allowed = await request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { toPhase: 'assignment' },
    });
    expect(allowed.ok(), await allowed.text()).toBeTruthy();
  });
});
