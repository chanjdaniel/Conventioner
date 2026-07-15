import type { APIRequestContext } from '@playwright/test'
import { type SeedResult, seedMarketWithVendors, marketNameToSlug } from './seeds'

export interface AssignedSeedResult extends SeedResult {
  slug: string
  assignmentObject: Record<string, unknown>
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
  const seed = await seedMarketWithVendors(request, baseURL, email, password)

  // SetupObject with colValues populated so the assignment algorithm has
  // vendor data to work with. colName is included because the assignment
  // solver's _calculate_date_flexibility calls toAttrString(market_date.col_name)
  // which crashes on None. This coupling belongs to Phase 5.
  const setupObject = {
    colNames: ['email', 'vendor_name', 'table_choice', 'buddy_email', 'day_1'],
    colValues: [
      ['alice@example.com', 'bob@example.com'],
      ['Alice', 'Bob'],
      ['Full table'],
      [''],
      ['Gold'],
    ],
    colInclude: [true, true, true, true, true],
    enumPriorityOrder: [[], [], [], [], []],
    priority: [],
    marketDates: [{ date: '2025-06-01', colNameIdx: 4, colName: 'day_1' }],
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
      emailColNameIdx: 0,
      tableChoiceColNameIdx: 2,
      tableShareEmailColNameIdx: 3,
      maxDaysColNameIdx: null,
    },
  }

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
  })
  if (!putRes.ok()) {
    throw new Error(`Market PUT failed: ${putRes.status()} ${await putRes.text()}`)
  }

  const assignRes = await request.get(
    `${baseURL}/markets/${encodeURIComponent(seed.marketId)}/assignment`,
    {
      headers: { 'X-Owner-Email': email },
    },
  )
  if (!assignRes.ok()) {
    throw new Error(`Assignment GET failed: ${assignRes.status()} ${await assignRes.text()}`)
  }
  const assignedMarket = (await assignRes.json()) as Record<string, unknown>

  const storedAssignment = (assignedMarket.assignmentObject || {}) as Record<string, unknown>

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
  })
  if (!storeRes.ok()) {
    throw new Error(`Assignment store failed: ${storeRes.status()} ${await storeRes.text()}`)
  }

  const slug = marketNameToSlug(seed.marketName)

  return { ...seed, slug, assignmentObject: storedAssignment }
}
