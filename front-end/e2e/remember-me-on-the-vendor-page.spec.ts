import { test, expect, BACKEND_URL, TEST_USER, VendorPage } from './fixtures';
import {
  createApplicantLoginChallenge,
  seedApplicantMarket,
  type ApplicantMarketSeed,
} from './helpers/seedApplicantMarket';
import { mongoEval } from './helpers/mongo';

/**
 * Remember me on the vendor page (T202, ADR 0022).
 *
 * A vendor's sign-in is kept in the tab, so a new tab asked for a code again. Ticking "Remember me
 * on this device" when they enter the code leaves the device remembered for that market: a new tab
 * signs them straight in, with no code, until the market's last date. Sign out ends it, on the
 * server too. Unticked, a new tab asks for a code as it always did.
 *
 * Driven through the real verify, never seeded: the cookie and its stored hash are the server's.
 * Email is off on the stack, so the code the email would carry is planted in its place.
 */
const CODE = '602914';

let market: ApplicantMarketSeed;

test.beforeEach(async ({ request }) => {
  // Every signed-out vendor page asks to resume, counted per caller (60 in 15 minutes), and the
  // serial run is one caller: by this spec the run's earlier pages may have used them up, and a
  // refused resume draws the sign-in, as no cookie does. The counters start again here.
  mongoEval('db.sign_in_attempts.deleteMany({})');
  market = await seedApplicantMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
});

async function signInWithTheCode(vendorPage: VendorPage, vendor: string, remember: boolean) {
  await vendorPage.goto(market.marketSlug);
  await vendorPage.requestCode(vendor);
  createApplicantLoginChallenge(market.marketId, vendor, CODE);
  await expect(vendorPage.rememberMe).not.toBeChecked();
  if (remember) await vendorPage.rememberMe.check();
  await vendorPage.enterCode(CODE);
  await expect(vendorPage.signedInAs).toContainText(vendor);
}

test('a vendor who ticks Remember me is signed straight in in a new tab, until they sign out', async ({
  page,
  context,
}) => {
  const vendor = `remembered-${Date.now()}@example.com`;
  await signInWithTheCode(new VendorPage(page), vendor, true);

  // Kept where no script on the page can read it.
  const cookies = await context.cookies();
  const remembered = cookies.find((c) => c.name === `vendor_remember_${market.marketId}`);
  expect(remembered?.httpOnly).toBe(true);
  expect(remembered?.secure).toBe(true);
  expect(remembered?.sameSite).toBe('None');
  expect(await page.evaluate(() => document.cookie)).not.toContain('vendor_remember_');

  const secondTab = new VendorPage(await context.newPage());
  await secondTab.goto(market.marketSlug);
  await expect(secondTab.signedInAs).toContainText(vendor);
  await expect(secondTab.emailStep).toHaveCount(0);

  await secondTab.signOutButton.click();
  await expect(secondTab.emailInput).toBeVisible();

  const thirdTab = new VendorPage(await context.newPage());
  await thirdTab.goto(market.marketSlug);
  await expect(thirdTab.emailInput).toBeVisible();
  await expect(thirdTab.signedInAs).toHaveCount(0);
});

test('a vendor who leaves it unticked is asked for a code in a new tab', async ({
  page,
  context,
}) => {
  const vendor = `not-remembered-${Date.now()}@example.com`;
  await signInWithTheCode(new VendorPage(page), vendor, false);

  const secondTab = new VendorPage(await context.newPage());
  await secondTab.goto(market.marketSlug);

  await expect(secondTab.emailInput).toBeVisible();
  await expect(secondTab.signedInAs).toHaveCount(0);
  // The first tab is still signed in: the tab's own sign-in is untouched.
  await expect(new VendorPage(page).signedInAs).toContainText(vendor);
});

test("a remembered vendor whose tab's sign-in has ended is signed straight back in, with no code", async ({
  page,
}) => {
  const vendor = `ended-${Date.now()}@example.com`;
  const vendorPage = new VendorPage(page);
  await signInWithTheCode(vendorPage, vendor, true);

  // The tab's 30-minute sign-in no longer passes, as it would not once it ended while the page
  // stood open at the door. The server refuses an ended token and a spoilt one alike, one 401
  // (`verify_application_token`), and no endpoint hands out an ended one.
  const spoilt = await page.evaluate(() => {
    const key = 'conventioner.applicantSession';
    const session = JSON.parse(sessionStorage.getItem(key) ?? '{}');
    const token = `${String(session.token).split('.').slice(0, 2).join('.')}.spoilt`;
    sessionStorage.setItem(key, JSON.stringify({ ...session, token }));
    return token;
  });
  await page.reload();

  await expect(vendorPage.signedInAs).toContainText(vendor);
  await expect(vendorPage.emailStep).toHaveCount(0);
  const kept = await page.evaluate(() => sessionStorage.getItem('conventioner.applicantSession'));
  expect(JSON.parse(kept ?? '{}').token).not.toBe(spoilt);
});
