import { test, expect, BACKEND_URL, TEST_USER } from './fixtures';
import { ensureTestOrg, seedPublishedMarketWithAssignments } from './helpers/seeds';
import { seedPhaseMarket } from './helpers/seedPhaseMarket';
import { marketSetupPath } from './helpers/marketScreens';
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

  /**
   * The two defects the-market-frame ticket 02 reproduced, pinned where the organizer met them.
   * Both came from the form tab fetching the form for itself and its siblings borrowing the answer
   * (E21/F02/S03).
   */
  test('the form builder follows an open and a reopen without leaving the tab', async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    await page.goto(marketSetupPath(seed.marketId, 'form'));
    const addField = page.getByTestId('form-builder-add-field-button');
    const lockBanner = page.getByTestId('form-builder-lock-banner');
    await expect(addField).toBeEnabled({ timeout: 15000 });
    await expect(lockBanner).toHaveCount(0);

    await page.getByTestId('phase-transition-applications_open').click();
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Applications Open', {
      timeout: 10000,
    });
    await expect(addField).toHaveCount(0);
    await expect(lockBanner).toContainText('Applications Open');

    await page.getByTestId('phase-rail-menu-button').click();
    await page.getByTestId('phase-transition-draft').click();
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Draft', { timeout: 10000 });
    await expect(lockBanner).toHaveCount(0);
    await expect(addField).toBeEnabled();
  });

  test("the priority rules offer the market's own questions on direct arrival", async ({
    authenticatedPage: page,
    request,
  }) => {
    const seed = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const form = await request.put(`${BACKEND_URL}/markets/${seed.marketId}/application-form`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: {
        fields: [
          {
            key: 'category',
            label: 'Category',
            type: 'select',
            required: false,
            options: ['Art', 'Food'],
            order: 0,
          },
        ],
      },
    });
    expect(form.ok()).toBe(true);

    // Straight to the Assignment tab, the way Assign and the links back from Tables arrive.
    await page.goto(marketSetupPath(seed.marketId, 'assignment'));
    await page.getByTestId('priority-add-rule').click({ timeout: 15000 });

    const target = page.getByTestId('priority-target-select').last();
    await expect(target.locator('optgroup[label="Your questions"] option')).toHaveText([
      'Category',
    ]);
  });
});
