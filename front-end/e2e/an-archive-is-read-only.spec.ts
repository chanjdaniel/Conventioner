import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import { SEED_MARKET_DATE, seedPublishedMarketWithAssignments } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';

/**
 * An archived market is the record of what happened, so nothing in it can change (bug 30,
 * E26/F06/S01).
 *
 * On the usage run, an archived market's Market Setup offered every control and saved a date
 * clicked on it; its Result page still showed hundreds of "Change" and "Place someone" buttons,
 * and "Free this seat" took a vendor out of a market that had already run. An archived market that
 * never ran showed an Attendance tab.
 */
async function archive(request: APIRequestContext, marketId: string) {
  const res = await request.post(`${BACKEND_URL}/markets/${marketId}/transition`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data: { toPhase: 'archived' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test('an archived market that ran is shown as a record, with nothing to change', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await archive(request, marketId);

  // The plan says why it cannot change, and its controls do nothing.
  await page.goto(marketSetupPath(marketId, 'setup'));
  await expect(page.getByTestId('market-read-only')).toContainText('archived', { timeout: 15000 });
  const dates = page.getByTestId('plan-card-dates').getByRole('button');
  await expect(dates.first()).toBeDisabled();
  // And the server is the rule, not the disabled control.
  const plan = await request.put(`${BACKEND_URL}/markets/${marketId}/plan`, {
    data: { setupObject: { marketDates: [{ date: SEED_MARKET_DATE }] } },
  });
  expect(plan.status()).toBe(403);

  // Result shows who sat where, and offers no seat to change.
  await page.goto(marketScreenPath(marketId, 'result'));
  await expect(page.getByTestId('tables-seat-occupied').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('button.seat-button')).toHaveCount(0);
  await expect(page.getByText('Place someone')).toHaveCount(0);

  // A vendor's dates read as a record too.
  await page.goto(`${marketScreenPath(marketId, 'vendors')}?vendor=alice@example.com`);
  await expect(page.getByTestId('vendors-detail-panel')).toContainText('A 1', { timeout: 15000 });
  await expect(page.getByTestId('vendor-date-card-place-link')).toHaveCount(0);

  // Verdicts are part of the record.
  await page.goto(marketSetupPath(marketId, 'applications'));
  await page.getByTestId('app-monitor-decided-toggle').click();
  await expect(page.getByTestId('app-monitor-decided-row').first()).toBeVisible();
  await expect(page.getByTestId('app-monitor-decided-approve-button')).toHaveCount(0);
  await expect(page.getByTestId('app-monitor-decided-reject-button')).toHaveCount(0);

  // It ran, so its attendance is part of the record.
  await expect(page.getByTestId('market-bar-tab-attendance')).toBeVisible();
});

test('an archived market that never ran has no Attendance tab', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedAssignedMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await archive(request, marketId);

  await page.goto(marketSetupPath(marketId, 'setup'));
  await expect(page.getByTestId('market-bar-tab-setup')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('market-bar-tab-attendance')).toHaveCount(0);
});
