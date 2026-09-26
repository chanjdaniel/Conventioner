import { test, expect, BACKEND_URL, TEST_USER } from './fixtures';
import { ensureTestOrg, seedPublishedMarketWithAssignments } from './helpers/seeds';
import type { Page } from '@playwright/test';

/**
 * Every market screen shows the market as the server last reported it (E21/F02).
 *
 * The market is held once, fetched on arrival, and re-read when the organizer comes back to the
 * browser tab - so a change made somewhere else is on screen without a reload.
 */

/** What a browser does when the organizer switches back to this tab. */
async function returnToThisTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test.describe('One market, from the server', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('Tables picks up a change made elsewhere when the organizer comes back to the tab', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seeded = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.goto(`/markets/${seeded.marketId}/tables`);
    await expect(page.getByTestId('tables-heading')).toContainText(seeded.marketName, {
      timeout: 15000,
    });
    await expect(page.getByTestId('phase-rail-frozen')).toHaveCount(0);

    // Somewhere else - another tab, another device - the market is archived.
    const archived = await request.post(`${BACKEND_URL}/markets/${seeded.marketId}/transition`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { toPhase: 'archived' },
    });
    expect(archived.ok()).toBe(true);

    await returnToThisTab(page);

    await expect(page.getByTestId('phase-rail-frozen')).toBeVisible({ timeout: 10000 });
  });

  test('a market that does not exist reads as one this organizer cannot reach', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets/no-such-market/tables');

    await expect(page.getByTestId('market-arrival-missing')).toHaveText(
      /does not exist, or you do not have access to it/,
      { timeout: 15000 },
    );
    await expect(page.getByTestId('phase-rail')).toHaveCount(0);
  });
});
