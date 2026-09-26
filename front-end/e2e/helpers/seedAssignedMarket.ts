import type { APIRequestContext } from '@playwright/test';
import { savePlan } from './savePlan';
import {
  SEED_MARKET_DATE,
  type SeedResult,
  seedMarketWithVendors,
  marketNameToSlug,
} from './seeds';

export interface AssignedSeedResult extends SeedResult {
  slug: string;
  assignmentObject: Record<string, unknown>;
}

/**
 * Create a market with vendor data, setup configuration, and computed assignments.
 *
 * Uses seedMarketWithVendors for the base market (application-based path), then
 * attaches a setupObject and runs the assignment through `POST /markets/{id}/assignment`,
 * which computes it and stores it in one call. The assignment is both persisted and
 * returned in the result.
 *
 * The D9 lock ordering (form finalized + applications opened before any
 * Application document exists) is enforced by seedMarketWithVendors.
 *
 * @returns AssignedSeedResult with marketId, slug, and the stored assignmentObject.
 */
export async function seedAssignedMarket(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
  /** `run: false` stops in the assignment phase with nothing run yet (E22/F04/S03). */
  options: { name?: string; run?: boolean } = {},
): Promise<AssignedSeedResult> {
  const seed = await seedMarketWithVendors(request, baseURL, email, password, options);

  // The vendors themselves are approved applications, seeded by seedMarketWithVendors. This
  // setupObject used to carry their answers as spreadsheet cell values as well.
  const setupObject = {
    priority: [],
    marketDates: [{ date: SEED_MARKET_DATE }],
    tiers: [{ id: 1, name: 'Gold' }],
    locations: [{ name: 'Main Hall' }],
    sections: [
      {
        name: 'Hall A',
        location: { name: 'Main Hall' },
        tier: { id: 1, name: 'Gold' },
        count: 5,
      },
    ],
    assignmentOptions: {
      maxAssignmentsPerVendor: 1,
      maxHalfTableProportionPerSection: 50,
    },
  };

  await savePlan(request, baseURL, email, seed.marketId, setupObject);

  // Walk to `assignment` first. It is where an organizer looking at the results screen actually
  // is - publishing is `assignment -> market_days` (E03/F03) - and it is the one phase the solver
  // runs in (E10/F03/S02), so the walk has to come before the run rather than after it.
  for (const toPhase of ['applications_open', 'applications_closed', 'review', 'assignment']) {
    const res = await request.post(
      `${baseURL}/markets/${encodeURIComponent(seed.marketId)}/transition`,
      {
        headers: { 'Content-Type': 'application/json', 'X-Owner-Email': email },
        data: { toPhase },
      },
    );
    if (!res.ok()) {
      throw new Error(`Transition to ${toPhase} failed: ${res.status()} ${await res.text()}`);
    }
  }

  if (options.run === false) {
    return { ...seed, slug: marketNameToSlug(seed.marketName), assignmentObject: {} };
  }

  // One call runs the solver and stores what it produced. `assignmentObject` is server-owned
  // (E11/F01/S01), so the old `GET /assignment` followed by a whole-market PUT would compute an
  // assignment and then throw it away.
  const assignRes = await request.post(
    `${baseURL}/markets/${encodeURIComponent(seed.marketId)}/assignment`,
    {
      headers: { 'X-Owner-Email': email },
    },
  );
  if (!assignRes.ok()) {
    throw new Error(`Assignment run failed: ${assignRes.status()} ${await assignRes.text()}`);
  }
  const assignedMarket = (await assignRes.json()) as Record<string, unknown>;

  const storedAssignment = (assignedMarket.assignmentObject || {}) as Record<string, unknown>;

  const slug = marketNameToSlug(seed.marketName);

  return { ...seed, slug, assignmentObject: storedAssignment };
}
