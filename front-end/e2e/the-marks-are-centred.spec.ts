import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { seedPublishedMarketWithAssignments } from './helpers/seeds';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import type { Locator } from '@playwright/test';

/**
 * The centred marks are centred (E28/F04/S02).
 *
 * The calendar's month arrows were text glyphs whose 3x5px ink sat 2.25px below the middle of their
 * 28px buttons; the dot marking the market's current tab and page sat about 1.5px low against the
 * capitals of its label.
 */

/** The dot's centre against the cap-height centre of the label it sits beside, in px. */
async function dotOffset(link: Locator): Promise<number> {
  return link.evaluate((el) => {
    const dot = el.querySelector('.current-dot')!.getBoundingClientRect();
    const style = getComputedStyle(el);
    // The text's baseline: an empty inline-block's bottom edge sits on it.
    const probe = document.createElement('span');
    probe.style.display = 'inline-block';
    el.insertBefore(probe, el.firstChild);
    const baseline = probe.getBoundingClientRect().bottom;
    probe.remove();
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const cap = ctx.measureText('H').actualBoundingBoxAscent;
    return dot.top + dot.height / 2 - (baseline - cap / 2);
  });
}

test('the current dot sits on the middle of its label, on the bar and on the pages', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await page.setViewportSize({ width: 1920, height: 1080 });
  // A published market's current tab is Attendance; an assigned one's current page is Result.
  await page.goto(marketScreenPath(seed.marketId, 'result'));
  await page.evaluate(() => document.fonts.ready);

  const tab = page.locator('.market-bar-tab.current');
  await expect(tab).toHaveCount(1, { timeout: 10000 });
  expect(Math.abs(await dotOffset(tab)), 'the bar tab').toBeLessThanOrEqual(0.5);

  const pageLink = page.locator('.market-page.current');
  if (await pageLink.count()) {
    expect(Math.abs(await dotOffset(pageLink)), 'the page link').toBeLessThanOrEqual(0.5);
  }
});

test('the page link dot under the Assignment tab is centred too', async ({
  authenticatedPage: page,
  request,
}) => {
  const { seedAssignedMarket } = await import('./helpers/seedAssignedMarket');
  const seed = await seedAssignedMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(marketScreenPath(seed.marketId, 'result'));
  await page.evaluate(() => document.fonts.ready);
  const pageLink = page.locator('.market-page.current');
  await expect(pageLink).toHaveCount(1, { timeout: 10000 });
  expect(Math.abs(await dotOffset(pageLink))).toBeLessThanOrEqual(0.5);
});

test('the month arrows sit in the middle of their buttons', async ({
  authenticatedPage: page,
  request,
}) => {
  const seed = await seedPublishedMarketWithAssignments(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
  );
  await page.goto(marketSetupPath(seed.marketId, 'setup'));
  for (const id of ['setup-dates-prev-month', 'setup-dates-next-month']) {
    const button = page.getByTestId(id);
    await expect(button).toBeVisible({ timeout: 10000 });
    const { dx, dy, inkWidth } = await button.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const ink = el.querySelector('svg')!.getBoundingClientRect();
      return {
        dx: ink.left + ink.width / 2 - (box.left + box.width / 2),
        dy: ink.top + ink.height / 2 - (box.top + box.height / 2),
        inkWidth: ink.width,
      };
    });
    expect(Math.abs(dx), `${id} across`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(dy), `${id} down`).toBeLessThanOrEqual(0.5);
    expect(inkWidth, `${id} reads beside the month`).toBeGreaterThanOrEqual(12);
  }
});
