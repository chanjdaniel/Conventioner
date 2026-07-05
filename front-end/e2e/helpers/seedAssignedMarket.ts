import type { APIRequestContext } from '@playwright/test';
import { seedMarketWithVendors, type SeedResult } from './seeds';

export interface AssignedSeedResult extends SeedResult {
  slug: string;
}

export async function seedAssignedMarket(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  password: string,
): Promise<AssignedSeedResult> {
  const seed = await seedMarketWithVendors(request, baseURL, email, password);

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
    marketDates: [
      { date: '2025-06-01', colNameIdx: 4, colName: 'day_1' },
    ],
    tiers: [
      { id: 1, name: 'Gold' },
    ],
    locations: [
      { name: 'Main Hall' },
    ],
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

  const slug = seed.marketName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return { ...seed, slug };
}
