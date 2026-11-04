import type { APIRequestContext } from '@playwright/test';
import { test, expect, BACKEND_URL, TEST_USER, VendorPage } from './fixtures';
import {
  createApplicantLoginChallenge,
  seedApplicantMarket,
  type ApplicantMarketSeed,
} from './helpers/seedApplicantMarket';

/**
 * A sign-in code takes five tries, then says it is spent (T202, T191 F22).
 *
 * A vendor who asked for two codes and typed the first email's code was refused, and the page went
 * on offering "Sign in" for a code that could no longer pass, since one wrong try burnt it. A code
 * now lasts ten minutes and takes five tries: a wrong one says so and clears the field for another;
 * the fifth, or an expired code, says it no longer works and offers only "Send a new code".
 *
 * Email is off on the stack, so the code each email would carry is planted in its place.
 */
const RETRY = "That code isn't right. Check you typed the newest code and try again.";
const SPENT = 'That code no longer works. Send yourself a new code.';
const FIRST_CODE = '418203';
const SECOND_CODE = '927451';

let market: ApplicantMarketSeed;

test.beforeEach(async ({ request }) => {
  market = await seedApplicantMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
});

function askForACode(request: APIRequestContext, email: string) {
  return request.post(
    `${BACKEND_URL}/public/markets/${market.marketSlug}/applicant-login/request-code`,
    { data: { email } },
  );
}

test('a vendor who asked twice and typed the first email’s code signs in with the second', async ({
  page,
  request,
}) => {
  const vendor = `asked-twice-${Date.now()}@example.com`;
  const vendorPage = new VendorPage(page);
  await vendorPage.goto(market.marketSlug);

  await vendorPage.requestCode(vendor);
  createApplicantLoginChallenge(market.marketId, vendor, FIRST_CODE);
  // Asked again, as from the first email's "send a new code" or another tab.
  expect((await askForACode(request, vendor)).status()).toBe(200);
  createApplicantLoginChallenge(market.marketId, vendor, SECOND_CODE);

  await vendorPage.enterCode(FIRST_CODE);
  await expect(vendorPage.error).toHaveText(RETRY);
  await expect(vendorPage.codeInput).toHaveValue('');
  await expect(vendorPage.codeInput).toBeFocused();

  await vendorPage.enterCode(SECOND_CODE);
  await expect(vendorPage.signedInAs).toContainText(vendor);
});

test('a vendor who uses up a code is told, sends a new one and signs in', async ({ page }) => {
  // The page waits a minute before it sends again; the clock is moved past it, not waited on.
  await page.clock.install();
  const vendor = `used-up-${Date.now()}@example.com`;
  const vendorPage = new VendorPage(page);
  await vendorPage.goto(market.marketSlug);
  await vendorPage.requestCode(vendor);
  createApplicantLoginChallenge(market.marketId, vendor, FIRST_CODE);

  for (const wrong of ['000001', '000002', '000003', '000004']) {
    await vendorPage.enterCode(wrong);
    await expect(vendorPage.error).toHaveText(RETRY);
    await expect(vendorPage.codeInput).toHaveValue('');
  }
  await vendorPage.enterCode('000005');

  await expect(vendorPage.error).toHaveText(SPENT);
  await expect(vendorPage.codeInput).toHaveCount(0);
  await expect(vendorPage.verifyButton).toHaveCount(0);
  await expect(vendorPage.sendNewCodeButton).toBeVisible();
  await expect(vendorPage.sendNewCodeButton).toBeDisabled();
  await expect(vendorPage.sendNewCodeButton).toContainText(/in \d+s/);

  await page.clock.runFor('01:01');
  await expect(vendorPage.sendNewCodeButton).toBeEnabled();
  await expect(vendorPage.sendNewCodeButton).toHaveText('Send a new code');
  await vendorPage.sendNewCodeButton.click();
  await expect(vendorPage.codeInput).toBeVisible();
  await expect(vendorPage.error).toHaveCount(0);
  createApplicantLoginChallenge(market.marketId, vendor, SECOND_CODE);

  await vendorPage.enterCode(SECOND_CODE);
  await expect(vendorPage.signedInAs).toContainText(vendor);
});
