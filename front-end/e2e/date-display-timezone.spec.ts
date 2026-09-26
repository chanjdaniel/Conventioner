import { test, expect, BACKEND_URL, TEST_USER } from './fixtures';
import { savePlan } from './helpers/savePlan';
import { marketSetupPath } from './helpers/marketScreens';
import { ensureTestOrg, loginViaApi } from './helpers/seeds';
import type { APIRequestContext } from '@playwright/test';

/**
 * Regression test for the market-date formatter timezone bug.
 *
 * A market date is a calendar day ("2026-07-31"), not an instant. The old
 * getFormattedDate pinned it to a hardcoded -08:00 offset and then rendered
 * it in the viewer's local timezone, so any viewer west of UTC-8 (Honolulu,
 * Alaska in winter) saw the PREVIOUS day. On an application form whose whole
 * purpose is picking attendance days, that silently misassigns people.
 *
 * These tests render the same stored date in browser contexts fixed to three
 * timezones spanning the bug boundary and assert every viewer sees the same
 * calendar day:
 *   - Pacific/Honolulu    (UTC-10: west of the pin - where the bug bit)
 *   - America/Los_Angeles (UTC-8:  at the pin - where the bug hid)
 *   - Asia/Tokyo          (UTC+9:  far east - always looked correct)
 */

const MARKET_DATE = '2026-07-31';
const EXPECTED_LABEL = 'Friday, July 31, 2026';
const TIMEZONES = ['Pacific/Honolulu', 'America/Los_Angeles', 'Asia/Tokyo'];

/**
 * Seed a market whose setupObject already holds MARKET_DATE, so the setup
 * wizard's date row renders the formatted label on load with no interaction.
 * Follows the market-pipeline.spec.ts API seeding pattern.
 */
async function seedMarketWithDate(request: APIRequestContext): Promise<Record<string, unknown>> {
  await loginViaApi(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  const orgId = await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);

  const headers = {
    'Content-Type': 'application/json',
    'X-Owner-Email': TEST_USER.email,
  };
  const createRes = await request.post(`${BACKEND_URL}/markets`, {
    headers,
    data: {
      name: `Date TZ E2E ${Date.now()}`,
      creationDate: new Date().toISOString(),
      organizationId: orgId,
      roles: { [TEST_USER.email]: 'owner' },
      modificationList: [],
      assignmentObject: {},
    },
  });
  if (!createRes.ok()) {
    throw new Error(`Market creation failed: ${createRes.status()} ${await createRes.text()}`);
  }
  const { market_id: marketId } = (await createRes.json()) as { market_id: string };

  const setupObject = {
    priority: [],
    marketDates: [{ date: MARKET_DATE }],
    tiers: [],
    locations: [],
    sections: [],
    assignmentOptions: {
      maxAssignmentsPerVendor: null,
      maxHalfTableProportionPerSection: null,
    },
  };
  await savePlan(request, BACKEND_URL, TEST_USER.email, marketId, setupObject);
  const updatedRes = await request.get(`${BACKEND_URL}/markets/${marketId}`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
  });
  return ((await updatedRes.json()) as { market: Record<string, unknown> }).market;
}

for (const timezoneId of TIMEZONES) {
  test.describe(`market date rendering in ${timezoneId}`, () => {
    test.use({ timezoneId });

    test(`stored ${MARKET_DATE} renders as ${EXPECTED_LABEL}`, async ({ page }, testInfo) => {
      // page.request shares the browser context's cookie jar, so the API
      // login below also authenticates subsequent in-page fetches.
      const market = await seedMarketWithDate(page.request);

      // Establish the app origin, then inject market + user the same way
      // market-pipeline.spec.ts does, for the screens that still read it.
      await page.goto('/login');
      await page.evaluate((user) => {
        localStorage.setItem('user', JSON.stringify(user));
      }, TEST_USER.email);
      await page.goto(marketSetupPath(String(market.id), 'setup'));

      const dateLabel = page.getByTestId('setup-dates-date-display-0');
      await expect(dateLabel).toBeVisible({ timeout: 10000 });
      // A day reads short beside its month (E23/F02/S01); its title is the whole date.
      await expect(dateLabel).toHaveAttribute('title', EXPECTED_LABEL);
      await expect(dateLabel).toContainText('Fri 31');
      await expect(page.getByTestId('setup-dates-month-name')).toHaveText(['July 2026']);

      await page.screenshot({
        path: testInfo.outputPath(`market-dates-${timezoneId.replace('/', '_')}.png`),
        fullPage: true,
      });
    });

    /**
     * The CALENDAR, not just the formatter (E18/F01/S02).
     *
     * A calendar does month ARITHMETIC rather than only formatting, which makes it the likeliest
     * place in the product to reintroduce the calendar-day-versus-instant bug: `new Date(2026, 10,
     * 1)` is midnight LOCAL, already November in Tokyo and still October in Honolulu. So the month
     * an organizer navigates to, and the day they click, are asserted in each timezone too.
     */
    test('the calendar names the same month and stores the same day everywhere', async ({
      page,
    }) => {
      const market = await seedMarketWithDate(page.request);
      await page.goto('/login');
      await page.evaluate((user) => {
        localStorage.setItem('user', JSON.stringify(user));
      }, TEST_USER.email);
      await page.goto(marketSetupPath(String(market.id), 'setup'));

      // It opens on the month the market already sits in - the same month for every viewer.
      const month = page.getByTestId('setup-dates-month');
      await expect(month).toBeVisible({ timeout: 15000 });
      await expect(month).toHaveText('July 2026');

      // Both edges of the month are where a local-offset bug shows first.
      await expect(page.getByTestId('setup-dates-day-2026-07-01')).toBeVisible();
      await expect(page.getByTestId('setup-dates-day-2026-07-31')).toBeVisible();
      await expect(page.getByTestId('setup-dates-day-2026-08-01')).toHaveCount(0);

      // Stepping a month, and back, lands where it started.
      await page.getByTestId('setup-dates-next-month').click();
      await expect(month).toHaveText('August 2026');
      await page.getByTestId('setup-dates-prev-month').click();
      await expect(month).toHaveText('July 2026');

      // A day clicked here is stored as that calendar day, whoever clicked it.
      await page.getByTestId('setup-dates-day-2026-07-01').click();
      await expect(page.getByTestId('setup-dates-date-display-0')).toHaveAttribute(
        'title',
        'Wednesday, July 1, 2026',
      );
    });
  });
}
