import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { changeASettledPlan } from './helpers/settledPlanChanged';
import { SEED_MARKET_DATE } from './helpers/seeds';
import { marketScreenPath } from './helpers/marketScreens';

/**
 * A pin the plan no longer has, made while the market is already in Assignment (bug 31,
 * E26/F05/S02).
 *
 * The orphaned-pin guard stood only on the way INTO Assignment, so a seat dropped from the plan
 * after the run met nothing: Result showed the vendor at a table that does not exist, nothing
 * marked it, and Publish Market sent them there on the day.
 */
const plan = (count: number) => ({
  priority: [],
  marketDates: [{ date: SEED_MARKET_DATE }],
  tiers: [{ id: 1, name: 'Gold' }],
  locations: [{ name: 'Main Hall' }],
  sections: [
    { name: 'Hall A', location: { name: 'Main Hall' }, tier: { id: 1, name: 'Gold' }, count },
  ],
  assignmentOptions: { maxAssignmentsPerVendor: 1, maxHalfTableProportionPerSection: 50 },
});

test('an orphaned pin is marked where the organizer looks, and holds Publish back', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  const pinned = await request.put(`${BACKEND_URL}/markets/${marketId}/placements`, {
    data: {
      email: 'alice@example.com',
      date: SEED_MARKET_DATE,
      table_code: 'Hall A 5',
      table_choice: 'Full Table',
    },
  });
  expect(pinned.ok(), await pinned.text()).toBeTruthy();
  // The room is rearranged after the run: the fifth table goes - as only a market older than the
  // settled setup could have it (E31/F01/S01).
  changeASettledPlan(marketId, plan(4));

  // Assignments marks the table the plan no longer has.
  await page.goto(marketScreenPath(marketId, 'assignments'));
  const row = page.locator('[data-testid="tables-table-row"][data-table-code="Hall A 5"]');
  await expect(row.getByTestId('tables-orphaned')).toBeVisible();

  // So does the vendor's own panel.
  await page.goto(marketScreenPath(marketId, 'vendors'));
  await page.getByTestId('vendors-list-item').filter({ hasText: 'alice@example.com' }).click();
  await page.getByTestId('vendor-drawer-tab-assignments').click();
  await expect(page.getByTestId('vendor-date-card-orphaned')).toContainText(
    'no longer in the plan',
  );

  // And Publish is refused before the click (E31/F02/S01), naming who, where and when.
  await page.getByTestId('vendors-detail-close').click();
  await expect(page.getByTestId('phase-transition-market_days')).toBeDisabled();
  await expect(page.getByTestId('phase-rail-next')).toContainText(
    'alice@example.com at Hall A 5 on 2099-05-01',
  );
  await expect(page.getByTestId('phase-rail-current')).toHaveText('Assignment');
});
