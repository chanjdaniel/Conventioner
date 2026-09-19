import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedAssignedMarket, type AssignedSeedResult } from './helpers/seedAssignedMarket';

/**
 * The phase rail (E10/F01).
 *
 * The strip it replaces floated above the card, labelled "Current Phase:" in white on a white
 * page. The rail is a band below the market header, on every market screen, and it is where the
 * check-in URL publishing puts on the air is finally stated.
 */
test.describe('The phase rail', () => {
  let seed: AssignedSeedResult;

  test.beforeAll(async ({ request }) => {
    seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  async function openMarket(page: import('@playwright/test').Page, path: string) {
    const res = await page.request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market } = (await res.json()) as { market: Record<string, unknown> };
    await page.evaluate((m) => {
      const copy = { ...(m as Record<string, unknown>) };
      delete copy._id;
      localStorage.setItem('market', JSON.stringify(copy));
      localStorage.setItem('user', JSON.stringify('e2e@example.com'));
    }, market);
    await page.goto(path);
  }

  test('is below the header on every market screen', async ({ authenticatedPage: page }) => {
    for (const path of [
      '/market-setup?tab=setup',
      `/markets/${seed.marketId}/tables`,
      '/vendors',
      `/markets/${seed.marketId}/attendance`,
    ]) {
      await openMarket(page, path);
      const rail = page.getByTestId('phase-rail');
      await expect(rail, `no rail on ${path}`).toBeVisible({ timeout: 15000 });
      await expect(rail.getByTestId('phase-rail-current')).toHaveText(/Assignment/);
    }
  });

  test('no two adjacent labels overlap at 1920x1080 with a long check-in URL', async ({
    authenticatedPage: page,
  }) => {
    // Container overflow does not detect this: the step boxes shrink below their labels, so the
    // labels paint over each other while the row still fits.
    await page.setViewportSize({ width: 1920, height: 1080 });

    const res = await page.request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market } = (await res.json()) as { market: Record<string, unknown> };
    market.name = 'Portland Holiday Makers Market December 2026';
    const put = await page.request.put(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: market,
    });
    expect(put.ok(), await put.text()).toBeTruthy();

    await page.request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { toPhase: 'market_days' },
    });

    await openMarket(page, '/market-setup?tab=setup');
    const chip = page.getByTestId('phase-rail-checkin');
    await expect(chip).toBeVisible({ timeout: 15000 });
    const url = await chip.locator('a').innerText();
    expect(url.length).toBeGreaterThan(60);

    const smallestGap = await page.evaluate(() => {
      // `Array.from`, not a spread: this runs inside the page under the e2e tsconfig, where a
      // `NodeListOf<Element>` is not iterable.
      const boxes = Array.from(document.querySelectorAll('.phase-step-label')).map((el) =>
        el.getBoundingClientRect(),
      );
      let smallest = Infinity;
      for (let i = 1; i < boxes.length; i += 1) {
        smallest = Math.min(smallest, boxes[i].left - (boxes[i - 1].left + boxes[i - 1].width));
      }
      return smallest;
    });
    expect(smallestGap).toBeGreaterThan(0);
  });

  test('the check-in URL is on the rail once published, and copies in one action', async ({
    authenticatedPage: page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await openMarket(page, '/market-setup?tab=setup');

    const chip = page.getByTestId('phase-rail-checkin');
    await expect(chip).toBeVisible({ timeout: 15000 });
    const url = await chip.locator('a').innerText();

    await page.getByTestId('phase-rail-checkin-copy').click();
    await expect(page.getByTestId('phase-rail-checkin-copy')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

    // And it is the page publishing actually put on the air.
    await page.goto(new URL(url).pathname);
    await expect(page.locator('body')).not.toContainText('Page not found');
  });

  test('archiving states in words that the market is over', async ({ authenticatedPage: page }) => {
    await page.request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { toPhase: 'archived' },
    });
    await openMarket(page, '/market-setup?tab=setup');

    const frozen = page.getByTestId('phase-rail-frozen');
    await expect(frozen).toBeVisible({ timeout: 15000 });
    await expect(frozen).toContainText('This market is archived');
    // Strikethrough is reinforcement, never the only signal.
    await expect(page.locator('.phase-step--frozen').first()).toBeVisible();
    await expect(page.locator('.rail-button--forward')).toHaveCount(0);
  });
});
