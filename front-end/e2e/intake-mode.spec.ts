import { test, expect, TEST_USER, BACKEND_URL, VendorPage } from './fixtures';
import {
  createApplicantLoginChallenge,
  seedApplicantMarket,
  type ApplicantMarketSeed,
} from './helpers/seedApplicantMarket';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import type { Page } from '@playwright/test';

const SCREENSHOT_DIR = 'e2e-screenshots/intake-mode';
const UNKNOWN_SLUG = 'no-such-market-at-all';
const SIGNED_IN_VENDOR = 'signed-in-vendor@example.com';

/**
 * What a visitor is shown at a route, with the slug they typed masked out.
 *
 * The slug is the one thing a gated market and an absent one legitimately differ by: every
 * applicant page falls back to printing what the visitor typed when it has no market name, and
 * it has no market name in either case. Masking it is what makes the rest comparable.
 */
async function renderedFor(page: Page, slug: string, suffix: string): Promise<string> {
  await page.goto(`/${slug}${suffix}`);
  await page.waitForLoadState('networkidle');
  const text = (await page.locator('body').innerText()).trim();
  return text.split(slug).join('<slug>');
}

async function finalPath(page: Page, slug: string, suffix: string): Promise<string> {
  await page.goto(`/${slug}${suffix}`);
  await page.waitForLoadState('networkidle');
  return new URL(page.url()).pathname.split(slug).join('<slug>');
}

test.describe('Intake mode - a CSV market has no public applicant surface', () => {
  let csvMarket: ApplicantMarketSeed;

  test.beforeAll(async ({ request }) => {
    csvMarket = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { intakeMode: 'csv' },
    );
  });

  for (const suffix of ['', '/apply', '/applicant-login', '/applicant/dashboard']) {
    test(`a stranger at /<slug>${suffix} is shown what an unknown market shows`, async ({
      page,
    }) => {
      const gated = await renderedFor(page, csvMarket.marketSlug, suffix);
      const absent = await renderedFor(page, UNKNOWN_SLUG, suffix);

      expect(gated).toBe(absent);
    });

    test(`/<slug>${suffix} lands a stranger where an unknown market lands them`, async ({
      page,
    }) => {
      const gated = await finalPath(page, csvMarket.marketSlug, suffix);
      const absent = await finalPath(page, UNKNOWN_SLUG, suffix);

      expect(gated).toBe(absent);
    });
  }

  test('its vendor page says the page does not exist, rather than naming it or taking an address', async ({
    page,
  }) => {
    // A sign-in page once drew its form and answered "sent" for a code it never sends (E32/F03/S01).
    for (const slug of [csvMarket.marketSlug, UNKNOWN_SLUG]) {
      await page.goto(`/${slug}`);
      await expect(page.getByTestId('vendor-page-not-found')).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('vendor-page-market-name')).toHaveCount(0);
      await expect(page.getByTestId('vendor-sign-in-email-input')).toHaveCount(0);
    }

    await page.goto(`/${csvMarket.marketSlug}`);
    await expect(page.getByTestId('vendor-page-not-found')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-csv-market-home.png`, fullPage: true });
  });

  test('its vendors still reach check-in once it runs', async ({ page, request }) => {
    // Intake mode gates applying, never checking in. This used to open the check-in page of the
    // market above, which takes applications and runs no check-in - and passed only because the
    // page drew its form for any address at all (bug 9). A market seeded with no intake mode is
    // CSV, and this one runs.
    const running = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.goto(`/${running.marketSlug}/check-in`);

    await expect(page.getByTestId('attendance-checkin-market-name')).toHaveText(
      running.marketName,
      { timeout: 10000 },
    );
    await expect(page.getByTestId('attendance-checkin-email-input')).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-csv-market-checkin.png`, fullPage: true });
  });
});

test.describe('Intake mode - a form market keeps its applicant surface', () => {
  let formMarket: ApplicantMarketSeed;

  test.beforeAll(async ({ request }) => {
    formMarket = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
  });

  test('its vendor page names the market and asks for an email address', async ({ page }) => {
    await page.goto(`/${formMarket.marketSlug}`);

    await expect(page.getByTestId('vendor-page-market-name')).toHaveText(formMarket.marketName, {
      timeout: 10000,
    });
    await expect(page.getByTestId('vendor-sign-in-email-input')).toBeVisible();
    await expect(page.getByTestId('vendor-page-not-found')).toHaveCount(0);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-form-market-home.png`, fullPage: true });
  });

  // The separate sign-in page and "Your application" are gone, not redirected (ADR 0022).
  for (const suffix of ['/applicant-login', '/applicant/dashboard']) {
    test(`its old address /<slug>${suffix} reads as any page that is not there`, async ({
      page,
    }) => {
      await page.goto(`/${formMarket.marketSlug}${suffix}`);

      await expect(page.getByTestId('page-not-found')).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('vendor-sign-in-email-input')).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/${formMarket.marketSlug}${suffix}$`));
    });
  }
});

test.describe('Intake mode - a market that stops serving applicants', () => {
  test('reads to a vendor already signed in as it reads to a stranger', async ({
    page,
    request,
  }) => {
    const market = await seedApplicantMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    const login = new VendorPage(page);
    await page.goto(`/${market.marketSlug}`);
    await login.requestCode(SIGNED_IN_VENDOR);
    createApplicantLoginChallenge(market.marketId, SIGNED_IN_VENDOR, '531642');
    await login.enterCode('531642');
    await expect(login.signedInAs).toBeVisible();

    // Nobody has applied, so the organizer may take the market back to draft, where it serves no
    // applicant. The vendor's sign-in still holds; their page must not blame their connection
    // for a market that is no longer there.
    const back = await request.post(`${BACKEND_URL}/markets/${market.marketId}/transition`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { toPhase: 'draft' },
    });
    expect(back.ok(), await back.text()).toBeTruthy();

    await page.goto(`/${market.marketSlug}`);
    await expect(page.getByTestId('page-not-found')).toBeVisible();
    await expect(page.getByText('Check your connection')).toHaveCount(0);
  });
});
