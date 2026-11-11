import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, VendorPage } from './fixtures';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
} from './helpers/seedApplicantMarket';
import { seedApprovedVendor } from './helpers/seedApplication';
import { seedApplicationWithStatus } from './helpers/seedPhaseMarket';

/**
 * A vendor can read their application, and its outcome, after applications close (bug 20,
 * E26/F07/S02), which is one of two since E36/F05/S02: a table, or none.
 *
 * Every applicant endpoint served a market whose applications were open only, so once the organizer
 * published results and closed applications - the order most organizers do it in - the sign-in
 * page showed the raw slug, no code could be requested, and the verdict could not be reached.
 * The ruling the module itself records says an applicant may sign in during any phase and always
 * see their own application; applying stays open-only.
 */
const DATE = '2099-08-01';
const VENDOR = 'returning-vendor@example.com';
const CODE = '864213';

async function post(request: APIRequestContext, path: string, data: object = {}) {
  const res = await request.post(`${BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    data,
  });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
}

test('after results are published and applications close, a vendor still reads their verdict', async ({
  page,
  request,
}) => {
  const market = await seedApplicantMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { setupObject: planSetupObject([DATE]) },
  );
  seedApprovedVendor(market.marketId, VENDOR, {
    dates: [DATE],
    tiers: ['Gold'],
    sections: ['Main Hall', 'Garden'],
    extra: { business_name: 'Returning Ceramics', product_type: 'Mugs' },
  });
  const TURNED_AWAY = 'turned-away@example.com';
  seedApplicationWithStatus(market.marketId, 'reviewer_rejected', TURNED_AWAY);
  // Results wait for the allocation (E36/F04/S01): reviewed, assigned, then published.
  for (const toPhase of ['assignment']) {
    await post(request, `/markets/${market.marketId}/transition`, { toPhase });
  }
  await post(request, `/markets/${market.marketId}/assignment`);
  await post(request, `/markets/${market.marketId}/publish-results`);

  const login = new VendorPage(page);
  await page.goto(`/${market.marketSlug}`);
  await expect(page.getByTestId('vendor-page-market-name')).toHaveText(market.marketName);
  await login.requestCode(VENDOR);
  createApplicantLoginChallenge(market.marketId, VENDOR, CODE);
  await login.enterCode(CODE);

  // One of two outcomes, read off the seats (E36/F05/S02): a table, and where.
  await expect(page.getByTestId('vendor-page-status')).toContainText('You have a table');
  await expect(page.getByTestId('vendor-page-seats')).toContainText('August 1, 2099');
  await expect(page.getByTestId('vendor-page-answers')).toContainText('Returning Ceramics');

  // Anyone without a seat reads the other, rejected or not, and never why.
  await page.getByTestId('vendor-page-sign-out-btn').click();
  // Signed out once the server has ended any remembered sign-in, and the page says so.
  await expect(login.emailInput).toBeVisible();
  await page.goto(`/${market.marketSlug}`);
  await login.requestCode(TURNED_AWAY);
  createApplicantLoginChallenge(market.marketId, TURNED_AWAY, CODE);
  await login.enterCode(CODE);
  const status = page.getByTestId('vendor-page-status');
  await expect(status).toContainText('You did not get assigned');
  await expect(status).not.toContainText(/reject|accepted/i);
  await expect(page.getByTestId('vendor-page-seats')).toHaveCount(0);
  // Reading is open; applying is not - the save refuses it, which the back-end suite pins, and
  // the vendor page's read-only answers are walked in returning-vendors-edit-their-answers.spec.ts.
});
