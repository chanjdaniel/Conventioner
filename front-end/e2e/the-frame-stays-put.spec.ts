import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import {
  ensureTestOrg,
  seedMarketWithVendors,
  seedPublishedMarketWithAssignments,
} from './helpers/seeds';
import { seedFormlessPhaseMarket } from './helpers/seedPhaseMarket';
import { marketScreenPath, marketSetupPath } from './helpers/marketScreens';
import type { Page } from '@playwright/test';

/**
 * The market frame stays put (E21/F04, variant A of the-market-frame ticket 01).
 *
 * The market's bar and its whole phase rail pin under the app banner as one block while the PAGE
 * scrolls - never a nested scroller - so the market's name, its tabs and the action that moves it
 * on stay in view at any scroll position.
 */

/** Where the frame's top edge sits relative to the banner's bottom, and the rail's own top. */
async function frameGeometry(page: Page) {
  return page.evaluate(() => {
    const banner = document.querySelector('.app-container > header') as HTMLElement;
    const frame = document.querySelector('[data-testid="market-frame"]') as HTMLElement;
    const rail = document.querySelector('[data-testid="phase-rail"]') as HTMLElement;
    return {
      frameTop: Math.round(frame.getBoundingClientRect().top),
      bannerBottom: Math.round(banner.getBoundingClientRect().bottom),
      railBottom: Math.round(rail.getBoundingClientRect().bottom),
      scrolled: Math.round(window.scrollY),
    };
  });
}

async function scrollToBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  // Bounded: a screen shorter than the window does not scroll, and the caller says whether it must.
  await page
    .waitForFunction(() => window.scrollY > 0, null, { timeout: 2000 })
    .catch(() => undefined);
}

test.describe('The frame stays put', () => {
  let marketId: string;

  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const seeded = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    marketId = seeded.marketId;
  });

  test('on every tab, scrolling leaves the name, the tabs and the whole rail under the banner', async ({
    authenticatedPage: page,
  }) => {
    // Short enough that every tab is taller than the window, so each one genuinely scrolls.
    await page.setViewportSize({ width: 1920, height: 500 });

    for (const tab of ['setup', 'form', 'applications', 'assignment']) {
      await page.goto(marketSetupPath(marketId, tab));
      await expect(page.getByTestId('phase-rail')).toBeVisible({ timeout: 15000 });
      await scrollToBottom(page);

      const { frameTop, bannerBottom, scrolled } = await frameGeometry(page);
      expect(scrolled, `the ${tab} tab did not scroll, so this proves nothing`).toBeGreaterThan(0);
      expect(frameTop, `the frame left the banner on the ${tab} tab`).toBe(bannerBottom);
      await expect(page.getByTestId('market-bar-title')).toBeInViewport();
      await expect(page.getByTestId('market-bar-tab-setup')).toBeInViewport();
      await expect(page.getByTestId('phase-rail')).toBeInViewport({ ratio: 1 });
    }
  });

  /**
   * The fourth tab is Assignment (E22/F01/S02). `CONTEXT.md` defines the assignment as the solver's
   * output, so "Assignment Results" named one thing twice.
   */
  test('the tabs are called what the glossary calls them', async ({ authenticatedPage: page }) => {
    await page.goto(marketSetupPath(marketId, 'setup'));
    await expect(page.getByTestId('phase-rail')).toBeVisible({ timeout: 15000 });

    await expect(page.getByTestId('market-bar-tab-assignment')).toHaveText('Assignment');
    await expect(page.getByText('Assignment Results')).toHaveCount(0);
  });

  test('switching tab while scrolled lands at the new tab’s top, nothing hidden under the frame', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 500 });
    await page.goto(marketSetupPath(marketId, 'setup'));
    await expect(page.getByTestId('phase-rail')).toBeVisible({ timeout: 15000 });
    await scrollToBottom(page);

    await page.getByTestId('market-bar-tab-assignment').click();

    const { scrolled } = await frameGeometry(page);
    expect(scrolled).toBe(0);
  });

  test('a short tab still fills the window', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(marketSetupPath(marketId, 'applications'));
    await expect(page.getByTestId('phase-rail')).toBeVisible({ timeout: 15000 });

    const gap = await page.evaluate(() => {
      const card = document.querySelector('.settings-container') as HTMLElement;
      return Math.round(window.innerHeight - card.getBoundingClientRect().bottom);
    });
    // The card reaches the bottom of the viewport, less the page's own bottom gutter.
    expect(gap).toBeLessThanOrEqual(24);
  });

  test('a refused transition’s blockers are pinned with the rail, under their button', async ({
    authenticatedPage: page,
    request,
  }) => {
    // A plan that asks nothing, so Open Applications is refused and the blocker panel opens.
    const blocked = await seedFormlessPhaseMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      false,
    );
    await page.setViewportSize({ width: 1920, height: 700 });
    await page.goto(marketSetupPath(blocked.marketId, 'setup'));
    await page.getByTestId('phase-transition-applications_open').click();
    const blockers = page.getByTestId('phase-rail-blockers');
    await expect(blockers).toBeVisible({ timeout: 10000 });

    await scrollToBottom(page);

    const { frameTop, bannerBottom } = await frameGeometry(page);
    expect(frameTop).toBe(bannerBottom);
    await expect(blockers).toBeInViewport({ ratio: 1 });
  });

  /**
   * Tables, Attendance and Vendors used to keep their title in view by capping the card at the
   * window and scrolling inside it - the nested scroller the design language forbids, and the reason
   * a sticky frame could not work there (E21/F04/S02). The page is the scroller on all four now.
   */
  test('on Tables, Attendance and Vendors the frame stays put and the page is the only scroller', async ({
    authenticatedPage: page,
  }) => {
    // Short enough that Attendance with no check-ins still scrolls: at the full frame width its rail
    // no longer wraps (E22/F04/S01), and it has no Back footer any more (E22/F04/S02).
    await page.setViewportSize({ width: 1920, height: 300 });

    for (const screen of ['result', 'attendance', 'vendors'] as const) {
      await page.goto(marketScreenPath(marketId, screen));
      await expect(page.getByTestId('phase-rail')).toBeVisible({ timeout: 15000 });
      await page.waitForLoadState('networkidle');

      const boxed = await page.evaluate(() =>
        Array.from(document.querySelectorAll('*'))
          .filter((el) => {
            const style = getComputedStyle(el);
            return /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 24;
          })
          .map((el) => el.className.toString().split(' ')[0] || el.tagName),
      );
      expect(boxed, `${screen} scrolls inside a box`).toEqual([]);

      await scrollToBottom(page);
      const { frameTop, bannerBottom, scrolled } = await frameGeometry(page);
      expect(scrolled, `${screen} did not scroll, so this proves nothing`).toBeGreaterThan(0);
      expect(frameTop, `the frame left the banner on ${screen}`).toBe(bannerBottom);
      await expect(page.getByTestId('phase-rail')).toBeInViewport({ ratio: 1 });
    }
  });

  /**
   * Nothing inside a market screen scrolls or clips on its own (E22/F01/S01).
   *
   * The Assignment Options card cut its second option off by 30px inside a scroller nobody could
   * see, under the 24px allowance the check above keeps for Tables, Attendance and Vendors. A box
   * whose content is taller than it, with any overflow but `visible`, is either a nested scroller
   * or a clip - and on a frame screen both are wrong, because the page is the scroller.
   */
  test('no box inside any market screen scrolls or clips its content', async ({
    authenticatedPage: page,
  }) => {
    const screens = [
      ...['setup', 'form', 'applications', 'assignment'].map((tab) =>
        marketSetupPath(marketId, tab),
      ),
      ...(['result', 'attendance', 'vendors'] as const).map((s) => marketScreenPath(marketId, s)),
    ];
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(size);
      for (const path of screens) {
        await page.goto(path);
        await expect(page.getByTestId('phase-rail')).toBeVisible({ timeout: 15000 });
        await page.waitForLoadState('networkidle');

        const clipped = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-testid="market-frame-card"] *'))
            .filter((el) => {
              const style = getComputedStyle(el);
              return style.overflowY !== 'visible' && el.scrollHeight > el.clientHeight + 1;
            })
            .map(
              (el) =>
                `${el.tagName.toLowerCase()}.${el.className.toString().split(' ')[0]} ` +
                `(${el.clientHeight} of ${el.scrollHeight}px)`,
            ),
        );
        expect(clipped, `${path} at ${size.width}px`).toEqual([]);
      }
    }
  });

  /**
   * Every market screen is one width (E22/F04/S01). Tables, Vendors and Attendance were
   * `--list-max` while the tabs were `--workspace-max`, so moving between a market's screens made
   * the frame jump 340px and cut the market's name on the narrower ones.
   */
  test('every market screen is one width', async ({ authenticatedPage: page }) => {
    const screens = [
      marketSetupPath(marketId, 'setup'),
      marketSetupPath(marketId, 'assignment'),
      ...(['result', 'attendance', 'vendors'] as const).map((s) => marketScreenPath(marketId, s)),
    ];
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(size);
      const widths: Record<string, number> = {};
      for (const path of screens) {
        await page.goto(path);
        await expect(page.getByTestId('phase-rail')).toBeVisible({ timeout: 15000 });
        widths[path] = await page
          .getByTestId('market-frame-card')
          .evaluate((el) => Math.round(el.getBoundingClientRect().width));
      }
      expect(new Set(Object.values(widths)).size, JSON.stringify(widths)).toBe(1);
    }
  });

  test('a long market name is whole where it fits, and ellipsed with its full name where not', async ({
    authenticatedPage: page,
    request,
  }) => {
    // An ordinary name fits beside the tabs, and is shown whole, with nothing cut.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(marketSetupPath(marketId, 'setup'));
    const ordinary = page.getByTestId('market-bar-title');
    await expect(ordinary).toBeVisible({ timeout: 15000 });
    expect(await ordinary.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    const name = `The Riverside Night Market of Handmade Goods and Small Batch Makers ${Date.now()}`;
    const long = await seedMarketWithVendors(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
      { name },
    );
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(marketSetupPath(long.marketId, 'setup'));
    const title = page.getByTestId('market-bar-title');
    await expect(title).toBeVisible({ timeout: 15000 });

    await expect(title).toHaveAttribute('title', name);

    const fits = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="market-frame"] > *') as HTMLElement;
      return bar.scrollWidth <= bar.clientWidth;
    });
    expect(fits, 'the name pushed the tabs out of the bar').toBe(true);
    await expect(page.getByTestId('market-bar-tab-assignment')).toBeInViewport({ ratio: 1 });
  });

  test('the vendor search stays in view with the frame', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1920, height: 500 });
    await page.goto(marketScreenPath(marketId, 'vendors'));
    await expect(page.getByTestId('vendors-search-input')).toBeVisible({ timeout: 15000 });
    await scrollToBottom(page);

    await expect(page.getByTestId('vendors-search-input')).toBeInViewport();
  });
});
