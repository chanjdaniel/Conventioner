import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedApplicantMarket, type ApplicantMarketSeed } from './helpers/seedApplicantMarket';
import type { Page } from '@playwright/test';

const SCREENSHOT_DIR = 'e2e-screenshots/intake-mode';
const UNKNOWN_SLUG = 'no-such-market-at-all';

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

  test('the market home never confirms that the market exists', async ({ page }) => {
    await page.goto(`/${csvMarket.marketSlug}`);
    await expect(page.getByTestId('market-home-not-found')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('market-home-name')).toHaveCount(0);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-csv-market-home.png`, fullPage: true });
  });

  test('its vendors still reach check-in', async ({ page }) => {
    await page.goto(`/${csvMarket.marketSlug}/check-in`);

    await expect(page.locator('.attendance-view')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('attendance-checkin-email-input')).toBeVisible({ timeout: 5000 });

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

  test('the market home names the market', async ({ page }) => {
    await page.goto(`/${formMarket.marketSlug}`);

    await expect(page.getByTestId('market-home-name')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('market-home-not-found')).toHaveCount(0);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-form-market-home.png`, fullPage: true });
  });

  test('the login page is served', async ({ page }) => {
    await page.goto(`/${formMarket.marketSlug}/applicant-login`);

    await expect(page.getByTestId('applicant-login-email-input')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('applicant-login-market')).toHaveText(formMarket.marketName);
  });
});
