import type { APIRequestContext } from '@playwright/test';
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
 * attaches a setupObject, computes the assignment, and stores it back on the
 * market. The assignment is both persisted and returned in the result.
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
): Promise<AssignedSeedResult> {
  const seed = await seedMarketWithVendors(request, baseURL, email, password);

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

  const putRes = await request.put(`${baseURL}/markets/${encodeURIComponent(seed.marketId)}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: {
      id: seed.marketId,
      name: seed.marketName,
      creationDate: new Date().toISOString(),
      organizationId: seed.orgId,
      roles: { [seed.userId]: 'owner' },
      modificationList: [],
      assignmentObject: {},
      setupObject,
    },
  });
  if (!putRes.ok()) {
    throw new Error(`Market PUT failed: ${putRes.status()} ${await putRes.text()}`);
  }

  const assignRes = await request.get(
    `${baseURL}/markets/${encodeURIComponent(seed.marketId)}/assignment`,
    {
      headers: { 'X-Owner-Email': email },
    },
  );
  if (!assignRes.ok()) {
    throw new Error(`Assignment GET failed: ${assignRes.status()} ${await assignRes.text()}`);
  }
  const assignedMarket = (await assignRes.json()) as Record<string, unknown>;

  const storedAssignment = (assignedMarket.assignmentObject || {}) as Record<string, unknown>;

  const storeRes = await request.put(`${baseURL}/markets/${encodeURIComponent(seed.marketId)}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-Owner-Email': email,
    },
    data: {
      id: seed.marketId,
      name: seed.marketName,
      creationDate: new Date().toISOString(),
      organizationId: seed.orgId,
      roles: { [seed.userId]: 'owner' },
      modificationList: [],
      setupObject,
      assignmentObject: storedAssignment,
    },
  });
  if (!storeRes.ok()) {
    throw new Error(`Assignment store failed: ${storeRes.status()} ${await storeRes.text()}`);
  }

  const slug = marketNameToSlug(seed.marketName);

  return { ...seed, slug, assignmentObject: storedAssignment };
}
