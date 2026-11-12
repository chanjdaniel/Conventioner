import type { APIRequestContext } from '@playwright/test';
import { savePlan } from './savePlan';
import {
  SEED_MARKET_DATE,
  startLayout,
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
  /**
   * `run: false` stops in the assignment phase with nothing run yet (E22/F04/S03). `tables` is how
   * many the one section has, 5 unless named: the plan is settled once the market leaves draft
   * (E31/F01/S01), so a spec wanting a smaller room asks for it here rather than shrinking it later.
   * `dates` are the market's dates, a table on each open to every vendor; one unless named.
   * `intakeMode` is how vendors reach it; absent, a CSV market, as `seedMarketWithVendors` makes it.
   * `laidOut` lays Main Hall out in Draft (T257, `startLayout`): a hall 30 m across with Hall A's
   * tables in a row across it, Hall A 1 at 3 m from the left, 2 m apart and 5 m down, so the
   * section counts them.
   */
  options: {
    name?: string;
    run?: boolean;
    tables?: number;
    dates?: string[];
    intakeMode?: 'csv' | 'form';
    laidOut?: boolean;
  } = {},
): Promise<AssignedSeedResult> {
  const seed = await seedMarketWithVendors(request, baseURL, email, password, options);

  // The vendors themselves are approved applications, seeded by seedMarketWithVendors. This
  // setupObject used to carry their answers as spreadsheet cell values as well.
  const setupObject = {
    priority: [],
    marketDates: (options.dates ?? [SEED_MARKET_DATE]).map((date) => ({ date })),
    tiers: [{ id: 1, name: 'Gold' }],
    locations: [{ name: 'Main Hall' }],
    sections: [
      {
        name: 'Hall A',
        location: { name: 'Main Hall' },
        tier: { id: 1, name: 'Gold' },
        count: options.tables ?? 5,
      },
    ],
    assignmentOptions: {
      maxAssignmentsPerVendor: options.dates?.length ?? 1,
      maxHalfTableProportionPerSection: 50,
    },
  };

  await savePlan(request, baseURL, email, seed.marketId, setupObject);
  if (options.laidOut) await layOutMainHall(request, baseURL, seed.marketId, options.tables ?? 5);

  // Walk to `assignment` first. It is where an organizer looking at the results screen actually
  // is - publishing is `assignment -> market_days` (E03/F03) - and it is the one phase the solver
  // runs in (E10/F03/S02), so the walk has to come before the run rather than after it.
  for (const toPhase of ['applications', 'assignment']) {
    const res = await request.post(
      `${baseURL}/markets/${encodeURIComponent(seed.marketId)}/transition`,
      {
        headers: { 'Content-Type': 'application/json' },
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
  );
  if (!assignRes.ok()) {
    throw new Error(`Assignment run failed: ${assignRes.status()} ${await assignRes.text()}`);
  }
  const assignedMarket = (await assignRes.json()) as Record<string, unknown>;

  const storedAssignment = (assignedMarket.assignmentObject || {}) as Record<string, unknown>;

  const slug = marketNameToSlug(seed.marketName);

  return { ...seed, slug, assignmentObject: storedAssignment };
}

/** Main Hall laid out with Hall A's `count` tables in a row across it, by the ids the plan write
 *  gave the location and the section. */
async function layOutMainHall(
  request: APIRequestContext,
  baseURL: string,
  marketId: string,
  count: number,
): Promise<void> {
  const read = await request.get(`${baseURL}/markets/${encodeURIComponent(marketId)}`);
  if (!read.ok()) throw new Error(`Market read failed: ${read.status()} ${await read.text()}`);
  const { market } = (await read.json()) as {
    market: { setupObject: { locations: { id: string }[]; sections: { id: string }[] } };
  };
  const [hall] = market.setupObject.locations;
  const [section] = market.setupObject.sections;
  await startLayout(request, baseURL, marketId, {
    locationId: hall.id,
    metresAcross: 30,
    tables: Array.from({ length: count }, (_, i) => ({
      section: section.id,
      at: [3000 + i * 2000, 5000] as [number, number],
    })),
  });
}
