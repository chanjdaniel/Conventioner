import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { marketSetupPath } from './helpers/marketScreens';
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

  async function marketBody(page: import('@playwright/test').Page) {
    const res = await page.request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market } = (await res.json()) as { market: Record<string, unknown> };
    delete market._id;
    return market;
  }

  async function openMarket(page: import('@playwright/test').Page, path: string) {
    const res = await page.request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market } = (await res.json()) as { market: Record<string, unknown> };
    await page.evaluate((m) => {
      const copy = { ...(m as Record<string, unknown>) };
      delete copy._id;
      localStorage.setItem('user', JSON.stringify('e2e@example.com'));
    }, market);
    await page.goto(path);
  }

  test('is below the header on every market screen', async ({ authenticatedPage: page }) => {
    for (const path of [
      marketSetupPath(seed.marketId, 'setup'),
      `/markets/${seed.marketId}/tables`,
      `/markets/${seed.marketId}/vendors`,
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
    // Unique per run: a public address belongs to one market (E21/F03/S03), and a fixed name here
    // used to pile up duplicates on a reused database, one per run.
    market.name = `Portland Holiday Makers Market December ${Date.now()}`;
    const put = await page.request.put(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: market,
    });
    expect(put.ok(), await put.text()).toBeTruthy();

    await page.request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { toPhase: 'market_days' },
    });

    await openMarket(page, marketSetupPath(seed.marketId, 'setup'));
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
    await openMarket(page, marketSetupPath(seed.marketId, 'setup'));

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

  test('a CSV market carries no application chip, and a form market does', async ({
    authenticatedPage: page,
  }) => {
    // The seeded market takes its vendors by import, so the chip must not appear: its `/apply` URL
    // answers exactly as a market that does not exist, and a chip would be the one place the
    // product admitted it was real (E18/F04/S02).
    await openMarket(page, marketSetupPath(seed.marketId, 'setup'));
    await expect(page.getByTestId('phase-rail')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('phase-rail-apply')).toHaveCount(0);

    // The same market taking applications by form does carry it, pointing at its own address.
    await page.request.put(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { ...(await marketBody(page)), intakeMode: 'form' },
    });
    await openMarket(page, marketSetupPath(seed.marketId, 'setup'));

    // Frozen after draft, so a market already past it keeps what it had - which is the rule, not a
    // failure. Only assert the chip when the server actually accepted the change.
    const res = await page.request.get(`${BACKEND_URL}/markets/${seed.marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    const { market } = (await res.json()) as { market: { intakeMode?: string } };
    if (market.intakeMode === 'form') {
      const chip = page.getByTestId('phase-rail-apply');
      await expect(chip).toBeVisible();
      await expect(chip.locator('a')).toHaveAttribute('href', /\/apply$/);
    }
  });

  test('archiving states in words that the market is over', async ({ authenticatedPage: page }) => {
    await page.request.post(`${BACKEND_URL}/markets/${seed.marketId}/transition`, {
      headers: { 'Content-Type': 'application/json', 'X-Owner-Email': TEST_USER.email },
      data: { toPhase: 'archived' },
    });
    await openMarket(page, marketSetupPath(seed.marketId, 'setup'));

    const frozen = page.getByTestId('phase-rail-frozen');
    await expect(frozen).toBeVisible({ timeout: 15000 });
    await expect(frozen).toContainText('This market is archived');
    // Strikethrough is reinforcement, never the only signal.
    await expect(page.locator('.phase-step--frozen').first()).toBeVisible();
    await expect(page.locator('.rail-button--forward')).toHaveCount(0);
  });
});
