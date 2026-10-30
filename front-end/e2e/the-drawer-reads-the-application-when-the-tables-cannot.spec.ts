import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';

/**
 * The vendor drawer keeps a vendor's application when the market's placements cannot be read
 * (T123, from T119's review).
 *
 * The drawer reads the applications, the assignment's statistics and the tables together, and one
 * refusal emptied all three: an approved application whose answers are incomplete makes the server
 * refuse the two assignment reads, and the drawer then said "This market asks no questions of its
 * own." of a market that asks one, with the refusal shown nowhere.
 */
test('a vendor drawer shows their answers and why the placements are missing', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  // Alice's application loses the dates she can attend, so it can no longer be placed, and the
  // server refuses to say where anyone is.
  mongoEval(
    `db.applications.updateOne({market_id: '${seed.marketId}', applicant_email: 'alice@example.com'}, {$unset: {'form_data.essential_available_dates': ''}})`,
  );

  await page.goto(`${marketScreenPath(seed.marketId, 'vendors')}?vendor=bob%40example.com`);
  const panel = page.getByTestId('vendor-drawer-panel-application');
  await expect(panel).toBeVisible({ timeout: 15000 });

  await expect(page.getByTestId('vendors-detail-answer-business_name')).toBeVisible();
  await expect(panel).not.toContainText('asks no questions');
  await expect(page.getByTestId('vendors-detail-load-error')).toContainText(
    'cannot be assigned until its answers are complete',
  );

  // Behind it the page lists both, says why, and counts no one as placed or not.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vendors-list-item')).toHaveCount(2);
  await expect(page.getByTestId('vendors-summary')).toHaveText('2 vendors');
});
