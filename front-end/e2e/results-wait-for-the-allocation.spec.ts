import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { planSetupObject, seedApplicantMarket } from './helpers/seedApplicantMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { seedApplicationWithStatus } from './helpers/seedPhaseMarket';
import { marketSetupPath } from './helpers/marketScreens';

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
  for (const toPhase of ['applications_closed', 'review', 'assignment']) {
    await post(request, `/markets/${market.marketId}/transition`, { toPhase });
  }

  await page.goto(marketSetupPath(market.marketId, 'applications'));
  const publish = page.getByTestId('app-monitor-publish-button');
  await expect(publish).toBeDisabled();
  await expect(page.getByTestId('app-monitor-publish-hint')).toHaveText(
    'Run the assignment first: results tell each applicant whether they have a table.',
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
  await expect(confirm).toContainText('1 applicant will read "You have a table"');
  await expect(confirm).toContainText('1 will read "You did not get assigned"');
  await confirm.getByTestId('publish-results-submit-button').click();
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId('app-monitor-published-badge')).toBeVisible();

  // Publishing settles the assignment: no run after it, and its rules read as settled.
  await page.goto(marketSetupPath(market.marketId, 'assignment'));
  await expect(page.getByTestId('assignment-rules-settled')).toContainText(
    'Results are published, so the assignment is settled',
  );
  await expect(page.getByTestId('market-setup-assign-button')).toHaveCount(0);
  // And the market may go live.
  await page.getByTestId('phase-transition-market_days').click();
  await page.getByTestId('sweep-confirm-submit-button').click();
  await expect(page.getByTestId('phase-rail-current')).toHaveText('Market Days');
});
