import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { planSetupObject, seedApplicantMarket } from './helpers/seedApplicantMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { seedApplicationWithStatus } from './helpers/seedPhaseMarket';
import { marketSetupPath } from './helpers/marketScreens';
import { namelessControls } from './helpers/accessibleNames';

/**
 * Results wait for the allocation (E36/F04/S01), and settle it (E36/F04/S02).
 *
 * Publish Results is offered once the market is assigning with a current run, says why until then,
 * and confirms with how many applicants will read each outcome before it tells anyone.
 */
const DATE = '2099-08-01';

async function post(request: APIRequestContext, path: string, data: object = {}) {
  const res = await request.post(`${BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
    data,
  });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
}

test('publishing waits for a run, then says who will read what before it tells them', async ({
  authenticatedPage: page,
  request,
}) => {
  const market = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject([DATE]) },
  );
  seedApprovedVendor(market.marketId, 'seated@example.com', {
    dates: [DATE],
    tiers: ['Gold'],
    sections: ['Main Hall', 'Garden'],
  });
  seedApplicationWithStatus(market.marketId, 'reviewer_rejected', 'turned-away@example.com');
  for (const toPhase of ['assignment']) {
    await post(request, `/markets/${market.marketId}/transition`, { toPhase });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(marketSetupPath(market.marketId, 'applications'));
  // The rail's end - the application page, Allocate tables, Publish Market, More - takes a row of
  // its own rather than running out of the card, which lost More off the edge at 1440.
  const rail = await page.getByTestId('phase-rail').boundingBox();
  const more = await page.getByTestId('phase-rail-menu-button').boundingBox();
  expect(more!.x + more!.width).toBeLessThanOrEqual(rail!.x + rail!.width);
  const publish = page.getByTestId('app-monitor-publish-button');
  await expect(publish).toBeDisabled();
  await expect(page.getByTestId('app-monitor-publish-hint')).toHaveText(
    'Allocate tables first: results tell each applicant whether they have a table.',
  );

  await post(request, `/markets/${market.marketId}/assignment`);
  await page.reload();
  // Nor does it go live untold (E36/F04/S02): the rail says so. Its fix is this very page.
  await expect(page.getByTestId('phase-transition-market_days')).toBeDisabled();
  await expect(page.getByTestId('phase-rail-next')).toContainText(
    'Applicants have not been told whether they have a table.',
  );
  await expect(publish).toBeEnabled();
  await publish.click();
  const confirm = page.getByTestId('publish-results-window');
  expect(await namelessControls(page), 'the publish results dialog').toEqual([]);
  await expect(confirm).toContainText('1 applicant will read "You have a table"');
  await expect(confirm).toContainText('1 will read "You did not get assigned"');
  await confirm.getByTestId('publish-results-submit-button').click();
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId('app-monitor-published-badge')).toBeVisible();

  // Publishing settles the assignment: no run after it, and its rules read as settled.
  await page.goto(marketSetupPath(market.marketId, 'assignment'));
  await expect(page.getByTestId('assignment-rules-settled')).toContainText(
    'Results are published, so the table allocation is settled',
  );
  await expect(page.getByTestId('market-setup-assign-button')).toHaveCount(0);
  // Seats still change by hand: freed, and given back.
  const seat = { email: 'seated@example.com', date: DATE };
  const freed = await request.delete(`${BACKEND_URL}/markets/${market.marketId}/placements`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
    data: seat,
  });
  expect(freed.ok(), await freed.text()).toBeTruthy();
  const placed = await request.put(`${BACKEND_URL}/markets/${market.marketId}/placements`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
    data: { ...seat, table_code: 'Main Hall 1', table_choice: 'Full Table' },
  });
  expect(placed.ok(), await placed.text()).toBeTruthy();
  // And the market may go live.
  await page.getByTestId('phase-transition-market_days').click();
  await page.getByTestId('sweep-confirm-submit-button').click();
  await expect(page.getByTestId('phase-rail-current')).toHaveText('Market Days');
});
