import { execFileSync } from 'node:child_process';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { SEED_MARKET_DATE, ensureTestOrg, seedMarketWithVendors } from './helpers/seeds';
import { savePlan } from './helpers/savePlan';
import { marketSetupPath } from './helpers/marketScreens';
import { mongoContainer } from './helpers/containerNames';

/**
 * Tier is a filter only when the market asked it (bug 23, E26/F04/S02).
 *
 * A plan whose sections had no tier failed every run with a bare "Internal server error", and a
 * market that added a tier after its form froze placed nobody: no applicant had been asked, so no
 * applicant "accepted" any tier.
 */

const UNTIERED = {
  priority: [],
  marketDates: [{ date: SEED_MARKET_DATE }],
  tiers: [],
  locations: [{ name: 'Main Hall' }],
  sections: [{ name: 'Hall A', location: { name: 'Main Hall' }, tier: null, count: 5 }],
  assignmentOptions: { maxAssignmentsPerVendor: 1, maxHalfTableProportionPerSection: 50 },
};

const TIERED = {
  ...UNTIERED,
  tiers: [{ id: 1, name: 'Gold' }],
  sections: [
    { name: 'Hall A', location: { name: 'Main Hall' }, tier: { id: 1, name: 'Gold' }, count: 5 },
  ],
};

async function walkToAssignment(request: APIRequestContext, marketId: string) {
  for (const toPhase of ['applications_open', 'applications_closed', 'review', 'assignment']) {
    const res = await request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
      data: { toPhase },
    });
    expect(res.ok(), `to ${toPhase}: ${await res.text()}`).toBeTruthy();
  }
}

/** Run the assignment the way an organizer does, and count who it placed. */
async function assignFromThePage(page: Page, request: APIRequestContext, marketId: string) {
  await page.goto(marketSetupPath(marketId, 'assignment'));
  await page.getByTestId('market-setup-assign-button').click();
  await expect(page).toHaveURL(new RegExp(`/markets/${marketId}/result$`), { timeout: 15000 });
  const res = await request.get(`${BACKEND_URL}/markets/${marketId}`);
  const { market } = (await res.json()) as {
    market: { assignmentObject: { vendorAssignments?: unknown[] } };
  };
  return market.assignmentObject.vendorAssignments?.length ?? 0;
}

test.beforeAll(async ({ request }) => {
  await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
});

test('a market whose sections have no tier assigns its vendors', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, UNTIERED);
  await walkToAssignment(request, marketId);

  expect(await assignFromThePage(page, request, marketId)).toBeGreaterThan(0);
  await expect(page.getByText('Internal server error')).toHaveCount(0);
  // And the result offers no tier to filter by, since there are none.
  await expect(page.getByTestId('tables-filter-section')).toBeVisible();
  await expect(page.getByTestId('tables-filter-tier')).toHaveCount(0);
});

test('a tier added after the form froze places vendors, not nobody', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  // The form froze when its first application arrived, while the plan had no tiers: nobody was
  // asked which tiers they would take.
  execFileSync('docker', [
    'exec',
    mongoContainer(),
    'mongosh',
    'mongodb://admin:secret@localhost:27017/conventioner?authSource=admin',
    '--quiet',
    '--eval',
    `db.markets.updateOne({ id: ${JSON.stringify(marketId)} }, { $set: {
      'applicationForm.essentialOptions': { dates: [${JSON.stringify(SEED_MARKET_DATE)}],
        sections: ['Hall A'], tableTypes: ['Standard'], tiers: [], unasked: [] } } })`,
  ]);
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, TIERED);
  await walkToAssignment(request, marketId);

  expect(await assignFromThePage(page, request, marketId)).toBeGreaterThan(0);
});
