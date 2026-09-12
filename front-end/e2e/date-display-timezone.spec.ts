import { test, expect, BACKEND_URL, TEST_USER } from './fixtures';
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
 *   - Pacific/Honolulu    (UTC-10: west of the pin — where the bug bit)
 *   - America/Los_Angeles (UTC-8:  at the pin — where the bug hid)
 *   - Asia/Tokyo          (UTC+9:  far east — always looked correct)
 */

const MARKET_DATE = '2026-07-31';
const EXPECTED_LABEL = 'Friday, July 31';
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

  const marketRes = await request.get(`${BACKEND_URL}/markets/${marketId}`, {
    headers: { 'X-Owner-Email': TEST_USER.email },
  });
  const { market } = (await marketRes.json()) as { market: Record<string, unknown> };

  const setupObject = {
    colNames: ['email', 'day_1'],
    colValues: [[], []],
    colInclude: [false, false],
    enumPriorityOrder: [[], []],
    priority: [],
    marketDates: [{ date: MARKET_DATE, colNameIdx: 1 }],
    tiers: [],
    locations: [],
    sections: [],
    assignmentOptions: {
      maxAssignmentsPerVendor: null,
      maxHalfTableProportionPerSection: null,
      emailColNameIdx: null,
      tableChoiceColNameIdx: null,
      tableShareEmailColNameIdx: null,
      maxDaysColNameIdx: null,
    },
  };
  const putRes = await request.put(`${BACKEND_URL}/markets/${marketId}`, {
    headers,
    data: { ...market, setupObject },
  });
  if (!putRes.ok()) {
    throw new Error(`Setup PUT failed: ${putRes.status()} ${await putRes.text()}`);
  }
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
      // market-pipeline.spec.ts does so /market-setup renders our market.
      await page.goto('/login');
      await page.evaluate(
        ({ m, user }) => {
          localStorage.setItem('market', JSON.stringify(m));
          localStorage.setItem('user', JSON.stringify(user));
        },
        { m: market, user: TEST_USER.email },
      );
      await page.goto('/market-setup');

      const dateLabel = page.getByTestId('setup-dates-date-display-0');
      await expect(dateLabel).toBeVisible({ timeout: 10000 });
      await expect(dateLabel).toHaveText(EXPECTED_LABEL);

      await page.screenshot({
        path: testInfo.outputPath(`market-dates-${timezoneId.replace('/', '_')}.png`),
        fullPage: true,
      });
    });
  });
}
