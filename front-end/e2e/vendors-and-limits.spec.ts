import { execFileSync } from 'node:child_process';
import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { VendorsPage } from './pages/VendorsPage';
import { marketScreenPath } from './helpers/marketScreens';
import { SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { seedApprovedVendor } from './helpers/seedApplication';
import { savePlan } from './helpers/savePlan';
import { mongoContainer } from './helpers/containerNames';

/**
 * Who the Vendors page lists, and what it says about a date a vendor did not get (bugs 10 and 33,
 * E26/F05/S04; settles claims-and-room 04).
 *
 * The page listed every application, so rejected applicants were counted as vendors and it
 * disagreed with Result ("72 of 237 vendors assigned" beside "72 of 72 vendors placed"). And a
 * vendor who had every date they asked for was told, for the dates they did not get, "A table is
 * free - they could be placed", with a link inviting the organizer to break their limit.
 */
const D1 = SEED_MARKET_DATE;
const D2 = '2026-05-02';
const D3 = '2026-05-03';
const GOLD = { id: 1, name: 'Gold' };

function mongoEval(script: string): void {
  execFileSync('docker', [
    'exec',
    mongoContainer(),
    'mongosh',
    'mongodb://admin:secret@localhost:27017/conventioner?authSource=admin',
    '--quiet',
    '--eval',
    script,
  ]);
}

/**
 * Three dates, room for everyone on each, and a ceiling of two per vendor. Alice asks for one date
 * of the three; Carol asks for all three, so the ceiling stops her; Bob was rejected.
 */
async function seedMarketWithLimits(request: APIRequestContext): Promise<string> {
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const market = JSON.stringify(marketId);
  mongoEval(
    `db.applications.updateOne({ market_id: ${market}, applicant_email: 'alice@example.com' },
      { $set: { 'form_data.essential_available_dates': ${JSON.stringify([D1, D2, D3])},
                'form_data.essential_tier_preference': ${JSON.stringify({ [D1]: ['Gold'], [D2]: ['Gold'], [D3]: ['Gold'] })},
                'form_data.essential_max_dates': 1 } })`,
  );
  mongoEval(
    `db.applications.updateOne({ market_id: ${market}, applicant_email: 'bob@example.com' },
      { $set: { status: 'reviewer_rejected' } })`,
  );
  seedApprovedVendor(marketId, 'carol@example.com', { dates: [D1, D2, D3], tiers: ['Gold'] });

  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    priority: [],
    marketDates: [{ date: D1 }, { date: D2 }, { date: D3 }],
    tiers: [GOLD],
    locations: [{ name: 'Main Hall' }],
    sections: [{ name: 'Hall A', location: { name: 'Main Hall' }, tier: GOLD, count: 4 }],
    assignmentOptions: { maxAssignmentsPerVendor: 2, maxHalfTableProportionPerSection: 50 },
  });
  for (const toPhase of ['applications_open', 'applications_closed', 'review', 'assignment']) {
    const res = await request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
      data: { toPhase },
    });
    expect(res.ok(), `to ${toPhase}: ${await res.text()}`).toBeTruthy();
  }
  const run = await request.post(`${BACKEND_URL}/markets/${marketId}/assignment`);
  expect(run.ok(), await run.text()).toBeTruthy();
  return marketId;
}

test('Vendors lists the vendors, not every applicant, and agrees with Result', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await seedMarketWithLimits(request);

  const vendors = new VendorsPage(page);
  await vendors.goto(marketId);
  await expect(vendors.vendorListItems).toHaveCount(2);
  await expect(page.getByTestId('vendors-summary')).toHaveText(/2\s+of\s+2\s+vendors assigned/);
  // A rejected applicant is not a vendor of this market; Applications is where they are seen.
  await expect(vendors.vendorListItems.filter({ hasText: 'bob@example.com' })).toHaveCount(0);

  await page.goto(marketScreenPath(marketId, 'result'));
  await expect(page.getByTestId('result-vendors-placed')).toHaveText(/2\s+of\s+2\s+vendors placed/);
});

test('a date a vendor did not get says which limit stopped it, and offers no placing', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await seedMarketWithLimits(request);

  // Alice asked for one date and has it: the other two are her own limit.
  await page.goto(`${marketScreenPath(marketId, 'vendors')}?vendor=alice@example.com`);
  const alice = page.getByTestId('vendors-detail-panel');
  await expect(alice.getByTestId('vendor-date-card-reason')).toHaveText([
    'Already has as many dates as they asked for',
    'Already has as many dates as they asked for',
  ]);
  await expect(alice.getByText('Place them')).toHaveCount(0);

  // Carol asked for all three; the market allows two.
  await page.goto(`${marketScreenPath(marketId, 'vendors')}?vendor=carol@example.com`);
  const carol = page.getByTestId('vendors-detail-panel');
  await expect(carol.getByTestId('vendor-date-card-reason')).toHaveText([
    'Already has as many dates as the market allows per vendor',
  ]);
  await expect(carol.getByText('Place them')).toHaveCount(0);
});
