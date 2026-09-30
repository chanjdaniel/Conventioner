import type { Page, Request } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedDraftMarket } from './helpers/seedDraftMarket';
import { marketSetupPath } from './helpers/marketScreens';

/**
 * One edit to the plan is one save (E26/F04/S01, bug 25).
 *
 * After any edit the page used to send `PUT /plan` about every 625 ms until the organizer left
 * it: each save re-read the market, the re-read replaced the plan's working copy, and the cards,
 * which deep-watch that copy, reported the replacement as a new edit. Besides the traffic, the
 * looping tab re-sent its own copy every cycle and overwrote whatever another editor saved.
 */

function countPlanSaves(page: Page): { count: () => number } {
  let saves = 0;
  page.on('request', (req: Request) => {
    if (req.method() === 'PUT' && /\/markets\/[^/]+\/plan$/.test(req.url())) saves += 1;
  });
  return { count: () => saves };
}

/** Five seconds is eight debounce cycles of the old loop; one save must stay one save. */
const QUIET = 5_000;

test.describe('The plan saves once per edit', () => {
  test('on Market Setup, one edit sends one save', async ({ authenticatedPage: page, request }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.goto(marketSetupPath(marketId));
    await page.getByTestId('setup-location-add-button').click();
    const saves = countPlanSaves(page);

    await page.getByTestId('setup-location-name-input-0').fill('Pier Hall');
    await expect.poll(saves.count).toBe(1);
    await page.waitForTimeout(QUIET);
    expect(saves.count()).toBe(1);
  });

  test('on the Assignment page, one option edit sends one save', async ({
    authenticatedPage: page,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await page.goto(marketSetupPath(marketId, 'assignment'));
    const proportion = page.getByTestId('setup-options-max-proportion-input');
    await expect(proportion).toBeVisible();
    const saves = countPlanSaves(page);

    await proportion.fill('40');
    await expect.poll(saves.count).toBe(1);
    await page.waitForTimeout(QUIET);
    expect(saves.count()).toBe(1);
  });

  test("a second editor's change survives while the first tab stays open", async ({
    authenticatedPage: first,
    request,
  }) => {
    const { marketId } = await seedDraftMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    await first.goto(marketSetupPath(marketId));
    await first.getByTestId('setup-location-add-button').click();
    await first.getByTestId('setup-location-name-input-0').fill('Pier Hall');
    await expect(first.getByTestId('market-setup-plan-saved')).toBeVisible();

    // The same organizer in a second tab, as two people sharing a market would be.
    const second = await first.context().newPage();
    await second.goto(marketSetupPath(marketId));
    await expect(second.getByTestId('setup-location-name-input-0')).toHaveValue('Pier Hall');
    await second.getByTestId('setup-location-add-button').click();
    await second.getByTestId('setup-location-name-input-1').fill('Annex');
    await expect(second.getByTestId('market-setup-plan-saved')).toBeVisible();
    await second.close();

    await first.waitForTimeout(QUIET);
    const res = await request.get(`${BACKEND_URL}/markets/${marketId}`);
    const { market } = (await res.json()) as {
      market: { setupObject: { locations: { name: string }[] } };
    };
    expect(market.setupObject.locations.map((l) => l.name)).toEqual(['Pier Hall', 'Annex']);
  });
});
