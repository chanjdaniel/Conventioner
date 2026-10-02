import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL, ApplicantLoginPage } from './fixtures';
import {
  createApplicantLoginChallenge,
  planSetupObject,
  seedApplicantMarket,
} from './helpers/seedApplicantMarket';
import { seedApprovedVendor } from './helpers/seedApplication';

/**
 * A vendor can read their application, and its verdict, after applications close (bug 20,
 * E26/F07/S02).
 *
 * Every applicant endpoint served a market in Applications Open only, so once the organizer
 * published results and closed applications - the order most organizers do it in - the sign-in
 * page showed the raw slug, no code could be requested, and the verdict could not be reached.
 * The ruling the module itself records says an applicant may sign in during any phase and always
 * see their own application; applying stays open-only.
 */
const DATE = '2026-08-01';
const VENDOR = 'returning-vendor@example.com';
const CODE = '864213';

async function post(request: APIRequestContext, path: string, data: object = {}) {
  const res = await request.post(`${BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
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
  await post(request, `/markets/${market.marketId}/publish-results`);
  await post(request, `/markets/${market.marketId}/transition`, { toPhase: 'applications_closed' });

  const login = new ApplicantLoginPage(page);
  await page.goto(`/${market.marketSlug}/applicant-login`);
  await expect(page.getByTestId('applicant-login-market')).toHaveText(market.marketName);
  await login.requestCode(VENDOR);
  createApplicantLoginChallenge(market.marketId, VENDOR, CODE);
  await login.enterCode(CODE);

  await page.waitForURL(new RegExp(`/${market.marketSlug}/applicant/dashboard`));
  await expect(page.getByTestId('applicant-dashboard-status')).toContainText('Approved');
  await expect(page.getByTestId('applicant-dashboard-answers')).toContainText('Returning Ceramics');
  // Reading is open; applying is not - the save refuses it, which the back-end suite pins, and
  // the apply page's closed state is walked in returning-vendors-edit-their-answers.spec.ts.
});
