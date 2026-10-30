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
 * clicked on it; its Assignments page still showed hundreds of "Change" and "Assign someone" buttons,
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

  // The rail says why it cannot change, once (T15), and the plan's controls do nothing.
  await page.goto(marketSetupPath(marketId, 'setup'));
  await expect(page.getByTestId('phase-rail-frozen')).toContainText('archived', { timeout: 15000 });
  await expect(page.getByTestId('market-read-only')).toHaveCount(0);
  const dates = page.getByTestId('plan-card-dates').getByRole('button');
  await expect(dates.first()).toBeDisabled();
  // And the server is the rule, not the disabled control.
  const plan = await request.put(`${BACKEND_URL}/markets/${marketId}/plan`, {
    data: { setupObject: { marketDates: [{ date: SEED_MARKET_DATE }] } },
  });
  expect(plan.status()).toBe(403);

  // Assignments shows who sat where, and offers no seat to change.
  await page.goto(marketScreenPath(marketId, 'assignments'));
  await expect(page.getByTestId('tables-seat-occupied').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('button.seat-button')).toHaveCount(0);
  await expect(page.getByText('Assign someone')).toHaveCount(0);

  // A vendor's dates read as a record too.
  await page.goto(
    `${marketScreenPath(marketId, 'vendors')}?vendor=alice@example.com&vendorTab=assignments`,
  );
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

test('an archived market that never ran says it has no attendance', async ({
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

  // The tab stays, as every tab does for a market's whole life (E31/F03/S02), and says so in
  // place of a roster that never was (bug 30).
  await page.goto(marketSetupPath(marketId, 'setup'));
  await page.getByTestId('market-bar-tab-attendance').click();
  await expect(page.getByTestId('market-tab-note')).toHaveText(
    'This market was archived without being published, so nobody checked in.',
  );
});
