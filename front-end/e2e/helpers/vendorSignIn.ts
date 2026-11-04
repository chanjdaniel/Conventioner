import type { APIRequestContext } from '@playwright/test';
import { createApplicantLoginChallenge } from './seedApplicantMarket';
import { mongoEval } from './mongo';
import type { VendorPage } from '../pages/VendorPage';

/**
 * A vendor signing in at their market's vendor page (ADR 0022), as a test drives it.
 *
 * Email is off on the stack, so the code the email would carry is planted in its place, after the
 * request it stands in for (`createApplicantLoginChallenge`). The sign-in limits count per address
 * across every market, so a spec that signs in often gives each test addresses of its own.
 */
export const VENDOR_CODE = '602914';

/** Sign in on the page that is open, through its real steps. */
export async function signInOnThePage(
  vendorPage: VendorPage,
  marketId: string,
  email: string,
): Promise<void> {
  await vendorPage.requestCode(email);
  createApplicantLoginChallenge(marketId, email, VENDOR_CODE);
  await vendorPage.enterCode(VENDOR_CODE);
  await vendorPage.signedInAs.waitFor({ timeout: 10000 });
}

/** A vendor's sign-in token, asked for over the API, for a test that reads as the vendor. */
export async function vendorToken(
  request: APIRequestContext,
  baseURL: string,
  marketSlug: string,
  marketId: string,
  email: string,
): Promise<string> {
  const asked = await request.post(
    `${baseURL}/public/markets/${marketSlug}/applicant-login/request-code`,
    { data: { email } },
  );
  if (!asked.ok()) throw new Error(`request-code: ${asked.status()} ${await asked.text()}`);
  createApplicantLoginChallenge(marketId, email, VENDOR_CODE);
  const verified = await request.post(
    `${baseURL}/public/markets/${marketSlug}/applicant-login/verify-code`,
    { data: { email, code: VENDOR_CODE } },
  );
  if (!verified.ok()) throw new Error(`verify-code: ${verified.status()} ${await verified.text()}`);
  return ((await verified.json()) as { token: string }).token;
}

/**
 * Start the sign-in counters again. A serial run is one caller, and by a spec that signs in the
 * run's earlier pages may have used its allowance up (E2E patterns).
 */
export function forgetSignInAttempts(): void {
  mongoEval('db.sign_in_attempts.deleteMany({})');
}

/** Today as a calendar day where the browser is, the day a vendor at the door means. */
export function calendarToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
