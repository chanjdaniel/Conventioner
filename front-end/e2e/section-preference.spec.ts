import { test, expect } from './fixtures';
import { savePlan } from './helpers/savePlan';
import { BACKEND_URL, TEST_USER } from './fixtures';
import { SEED_MARKET_DATE, ensureTestOrg, loginViaApi } from './helpers/seeds';
import { seedApprovedVendor } from './helpers/seedApplication';

/**
 * A vendor's ranked section preference decides which table they reach.
 *
 * Honoured as a placement preference, never a filter: a ranking is a permutation of the whole
 * offering, so it excludes nothing, and nobody goes unplaced for wanting something. Contrast
 * tier, which IS a filter, because the tier decides what the applicant pays.
 *
 * Driven through the assignment API rather than the UI: the wizard has no screen that shows a
 * vendor's own ranking, so the placement is the only observable the preference produces.
 */
const GARDEN = 'Garden';
const HALL = 'Main Hall';

test.describe('Section preference', () => {
  test('a vendor is placed in the section they ranked first', async ({
    authenticatedPage: page,
  }) => {
    const ctx = page.request;
    await loginViaApi(ctx, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const orgId = await ensureTestOrg(ctx, BACKEND_URL, TEST_USER.email, TEST_USER.password);

    const marketName = `Section Preference ${Date.now()}`;
    const createRes = await ctx.post(`${BACKEND_URL}/markets`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: {
        name: marketName,
        creationDate: new Date().toISOString(),
        organizationId: orgId,
        roles: { [TEST_USER.email]: 'owner' },
        modificationList: [],
        assignmentObject: {},
      },
    });
    expect(createRes.ok(), await createRes.text()).toBeTruthy();
    const { market_id: marketId } = (await createRes.json()) as { market_id: string };

    // Two sections at the same tier, so tier rules nothing out and only preference can decide.
    const tier = { id: 1, name: 'Gold' };
    const setupObject = {
      priority: [],
      marketDates: [{ date: SEED_MARKET_DATE }],
      tiers: [tier],
      locations: [{ name: HALL }, { name: GARDEN }],
      sections: [
        { name: HALL, location: { name: HALL }, tier, count: 2 },
        { name: GARDEN, location: { name: GARDEN }, tier, count: 2 },
      ],
      assignmentOptions: { maxAssignmentsPerVendor: 1, maxHalfTableProportionPerSection: 100 },
      floorplans: null,
    };

    // One vendor ranks each section first. Both accept the same tier and the same day, so the
    // only thing separating them is what they asked for.
    seedApprovedVendor(marketId, 'prefers-garden@example.com', {
      dates: [SEED_MARKET_DATE],
      tiers: [tier.name],
      sections: [GARDEN, HALL],
    });
    seedApprovedVendor(marketId, 'prefers-hall@example.com', {
      dates: [SEED_MARKET_DATE],
      tiers: [tier.name],
      sections: [HALL, GARDEN],
    });

    await savePlan(ctx, BACKEND_URL, TEST_USER.email, marketId, setupObject);

    const assignmentRes = await ctx.get(`${BACKEND_URL}/markets/${marketId}/assignment`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    expect(assignmentRes.ok(), await assignmentRes.text()).toBeTruthy();
    const assigned = (await assignmentRes.json()) as Record<string, unknown>;

    const placements = ((assigned.assignmentObject as Record<string, unknown>)?.vendorAssignments ??
      []) as Array<{ email: string; section: string }>;
    const sectionFor = (email: string) => placements.find((p) => p.email === email)?.section;

    expect(sectionFor('prefers-garden@example.com')).toBe(GARDEN);
    expect(sectionFor('prefers-hall@example.com')).toBe(HALL);
  });
});
