import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg, seedPublishedMarketWithAssignments } from './helpers/seeds';
import type { Page } from '@playwright/test';

/**
 * A screen is a card of one of two widths that grows to its content while the page scrolls
 * (E16/F03, the build of claims-and-room ticket 01, which holds the measurements).
 *
 * The product had four page widths and four gutters, and the workspace was `width: 80%;
 * height: 80%` - scaffolding from the first commit of that view in Feb 2025. At 1920x1080 it gave
 * the plan a 547px window for 1,032px of content and could not scroll the page at all. Even the
 * emptiest possible plan is 812px, so no market ever fit.
 *
 * The width assertions are against the tokens rather than against numbers, so this spec does not
 * have to be edited when ticket 07 amends `--list-max`. What it pins is that there are TWO of them
 * and every screen uses one - which is what stops a fifth being added quietly.
 */

async function tokens(page: Page): Promise<{ workspace: number; list: number }> {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      workspace: parseFloat(root.getPropertyValue('--workspace-max')),
      list: parseFloat(root.getPropertyValue('--list-max')),
    };
  });
}

async function contentWidth(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => Math.round(el.getBoundingClientRect().width));
}

test.describe('Every organizer screen sizes itself the same way', () => {
  let marketId: string;
  let market: unknown;

  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const seeded = await seedPublishedMarketWithAssignments(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    marketId = seeded.marketId;
    const response = await request.get(`${BACKEND_URL}/markets/${marketId}`, {
      headers: { 'X-Owner-Email': TEST_USER.email },
    });
    market = ((await response.json()) as { market: unknown }).market;
  });

  async function openTheSeededMarket(page: Page): Promise<void> {
    await page.goto('/login');
    await page.evaluate(
      ({ m, user }) => {
        localStorage.setItem('market', JSON.stringify(m));
        localStorage.setItem('user', JSON.stringify(user));
      },
      { m: market, user: TEST_USER.email },
    );
  }

  test('there are two widths, and each screen uses one of them', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openTheSeededMarket(page);
    const { workspace, list } = await tokens(page);
    expect(workspace, '--workspace-max is not defined').toBeGreaterThan(0);
    expect(list, '--list-max is not defined').toBeGreaterThan(0);

    await page.goto('/market-setup?tab=setup');
    await expect(page.getByTestId('setup-dates-date-display-0')).toBeVisible({ timeout: 15000 });
    expect(await contentWidth(page, '.market-setup-body')).toBe(workspace);

    await page.goto(`/markets/${marketId}/tables`);
    await expect(page.getByTestId('tables-count-assigned')).toBeVisible({ timeout: 15000 });
    expect(await contentWidth(page, '.tables-card')).toBe(list);
  });

  test('no screen caps its own height, and the page is what scrolls', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openTheSeededMarket(page);
    await page.goto('/market-setup?tab=setup');
    await expect(page.getByTestId('setup-dates-date-display-0')).toBeVisible({ timeout: 15000 });

    // The plan is taller than the window on any real market, so the PAGE must be what scrolls.
    const shape = await page.evaluate(() => {
      const de = document.documentElement;
      const boxed = Array.from(document.querySelectorAll('*'))
        .filter((el) => {
          const style = getComputedStyle(el);
          return /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 24;
        })
        .map(
          (el) =>
            `${el.className.toString().split(' ')[0] || el.tagName} hides ${el.scrollHeight - el.clientHeight}px`,
        );
      return { pageScrolls: de.scrollHeight > de.clientHeight, boxed };
    });

    expect(shape.pageScrolls, 'the page does not scroll, so something else must be').toBe(true);
    expect(shape.boxed, 'a screen is hiding its content inside a box').toEqual([]);
  });

  test('no control on the plan is narrower than its own longest value', async ({
    authenticatedPage: page,
  }) => {
    // Equal thirds gave Section Setup - four columns and a delete control - the same width as
    // Location Setup, which needs one. That is the sole cause of the Tier select rendering 65px
    // wide with 34px of text room, so every tier read "Pr...", "St...", "Co...".
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openTheSeededMarket(page);
    await page.goto('/market-setup?tab=setup');
    await expect(page.getByTestId('setup-dates-date-display-0')).toBeVisible({ timeout: 15000 });

    const truncated = await page.evaluate(() => {
      const measure = document.createElement('canvas').getContext('2d');
      if (!measure) return [];
      return Array.from(document.querySelectorAll('select'))
        .map((select) => {
          const style = getComputedStyle(select);
          measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          const label = select.options[select.selectedIndex]?.text ?? '';
          const needed = measure.measureText(label).width;
          const box = select.getBoundingClientRect();
          // 18px for the native arrow.
          const room =
            box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 18;
          return needed > room
            ? `"${label}" needs ${Math.round(needed)}px, has ${Math.round(room)}px`
            : '';
        })
        .filter(Boolean);
    });

    expect(truncated).toEqual([]);
  });
});
