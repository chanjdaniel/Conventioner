import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketSetupPath } from './helpers/marketScreens';
import { SEED_MARKET_DATE, seedMarketWithVendors } from './helpers/seeds';
import { seedApprovedVendor } from './helpers/seedApplication';
import { savePlan } from './helpers/savePlan';
import { transitionMarket } from './helpers/seedPhaseMarket';

/**
 * A run refused for an incomplete application says who, and takes the organizer there (item 7 of
 * bug 42; E26/F10/S02).
 *
 * It said "1 approved application(s) cannot be assigned until their answers are complete:" and a
 * name, with nothing to follow - the organizer had to go and find that application themselves.
 */
const GOLD = { id: 1, name: 'Gold' };

test('the refusal names each applicant, and each name opens their application', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedMarketWithVendors(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  // Approved, but never said which days they can come.
  seedApprovedVendor(marketId, 'unfinished@example.com', { dates: [], tiers: ['Gold'] });
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, {
    priority: [],
    marketDates: [{ date: SEED_MARKET_DATE }],
    tiers: [GOLD],
    locations: [{ name: 'Main Hall' }],
    sections: [{ name: 'Hall A', location: { name: 'Main Hall' }, tier: GOLD, count: 5 }],
    assignmentOptions: { maxAssignmentsPerVendor: null, maxHalfTableProportionPerSection: 50 },
  });
  for (const phase of ['applications_open', 'applications_closed', 'review', 'assignment']) {
    await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, phase);
  }

  await page.goto(marketSetupPath(marketId, 'assignment'));
  await page.getByTestId('market-setup-assign-button').click();

  const banner = page.getByTestId('market-setup-assign-error');
  await expect(banner).toContainText(
    '1 approved application cannot be assigned until its answers are complete',
  );
  await expect(banner).not.toContainText('application(s)');
  const named = banner.getByTestId('market-setup-assign-incomplete');
  await expect(named).toHaveCount(1);
  await expect(named).toContainText('unfinished@example.com');
  await expect(named).toContainText('Available dates');

  await named.getByRole('link', { name: 'unfinished@example.com' }).click();
  await expect(page).toHaveURL(/\/applications\?application=/);
  // Opened at that application: the reviewed list is open, and it is the one marked.
  const row = page
    .getByTestId('app-monitor-decided-row')
    .filter({ hasText: 'unfinished@example.com' });
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/named/);
  await expect(row).toBeInViewport();
});
