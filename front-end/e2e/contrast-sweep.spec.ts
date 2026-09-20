import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg, seedPublishedMarketWithAssignments } from './helpers/seeds';
import type { Page } from '@playwright/test';

/**
 * Every rendered text node reaches WCAG AA, on the ground it is actually painted on (E16/F01/S05).
 *
 * `src/__tests__/contrast.test.ts` asserts the palette and is kept: it fails in milliseconds with a
 * precise message when `base.css` changes, where this sweep would only say "something on the
 * Applications screen went dark". What it cannot see is a USAGE. Two failures proved that:
 *
 *   - the Skip button put white text on `--mm-border`, at **1.74:1**. That token is exempt from the
 *     contract on the stated grounds that it "never carries text", so the unit test was structurally
 *     incapable of noticing that it had been made into a fill.
 *   - the current-phase label rendered `--mm-green` on the rail's `#fbfbfa` at **4.43:1**. The token
 *     is correct - 4.59 on white - but white was not the ground it was used on.
 *
 * **A sweep is only worth the states it walks.** A twenty-screen pass missed the invisible
 * archive-confirmation button entirely, because nobody opened that dialog. So the dialogs, menus and
 * disabled controls below are named deliberately, and the list is part of the deliverable.
 */

const AA_NORMAL = 4.5;
const AA_LARGE = 3;

interface Failure {
  text: string;
  ratio: number;
  needs: number;
  color: string;
  ground: string;
}

/**
 * Every visible text node's contrast against the ground it is composited onto.
 *
 * The ground is walked up through ancestors and alpha-composited, because a translucent fill over
 * white is a different colour from the fill itself - which is exactly what `--mm-border` as a
 * button was.
 */
async function failures(page: Page): Promise<Failure[]> {
  return page.evaluate(
    ({ normal, large }) => {
      const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      const luminance = ([r, g, b]: number[]) =>
        0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const parse = (value: string) => {
        const parts = value.match(/[\d.]+/g);
        return parts ? parts.slice(0, 4).map(Number) : null;
      };
      const over = (fg: number[], bg: number[]) => {
        const alpha = fg[3] === undefined ? 1 : fg[3];
        return [0, 1, 2].map((i) => alpha * fg[i] + (1 - alpha) * bg[i]);
      };
      const groundOf = (el: Element) => {
        const stack: number[][] = [];
        for (let cur: Element | null = el; cur; cur = cur.parentElement) {
          const colour = parse(getComputedStyle(cur).backgroundColor);
          if (colour && (colour[3] === undefined || colour[3] > 0)) stack.push(colour);
        }
        let ground = [255, 255, 255];
        for (let i = stack.length - 1; i >= 0; i--) ground = over(stack[i], ground);
        return ground;
      };
      const ratio = (a: number[], b: number[]) => {
        const [hi, lo] = luminance(a) > luminance(b) ? [a, b] : [b, a];
        return (luminance(hi) + 0.05) / (luminance(lo) + 0.05);
      };

      const found: Failure[] = [];
      const seen = new Set<string>();
      document.querySelectorAll('*').forEach((el) => {
        const own = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? '')
          .join(' ')
          .trim();
        if (!own) return;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || +style.opacity === 0)
          return;
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return;

        const fg = parse(style.color);
        if (!fg) return;
        const ground = groundOf(el);
        const value = ratio(over(fg, ground), ground);

        const size = parseFloat(style.fontSize);
        const isLarge = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
        const needs = isLarge ? large : normal;
        if (value >= needs - 0.005) return;

        const key = own.slice(0, 30) + style.color + ground.join();
        if (seen.has(key)) return;
        seen.add(key);
        found.push({
          text: own.slice(0, 40),
          ratio: Math.round(value * 100) / 100,
          needs,
          color: style.color,
          ground: `rgb(${ground.map(Math.round).join(',')})`,
        });
      });
      return found.sort((a, b) => a.ratio - b.ratio);
    },
    { normal: AA_NORMAL, large: AA_LARGE },
  );
}

async function expectAA(page: Page, state: string): Promise<void> {
  const bad = await failures(page);
  expect(
    bad.map((f) => `"${f.text}" ${f.ratio}:1 (needs ${f.needs}) ${f.color} on ${f.ground}`),
    `${state} has text below AA`,
  ).toEqual([]);
}

test.describe('Every rendered text node reaches AA', () => {
  let marketId: string;
  let marketSlug: string;
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
    marketSlug = seeded.marketSlug;

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

  test('the screens', async ({ authenticatedPage: page }) => {
    await openTheSeededMarket(page);
    for (const [state, url, ready] of [
      ['markets', '/markets', 'markets-create-button'],
      ['market plan', '/market-setup', 'setup-dates-date-display-0'],
      [
        'assignment results',
        '/market-setup?tab=assignment',
        'assignment-results-download-csv-button',
      ],
      ['tables', `/markets/${marketId}/tables`, 'tables-count-assigned'],
      ['vendors', '/vendors', 'vendors-search-input'],
      ['attendance', `/markets/${marketId}/attendance`, 'attendance-status-heading'],
    ] as const) {
      await page.goto(url);
      await expect(page.getByTestId(ready)).toBeVisible({ timeout: 15000 });
      await expectAA(page, state);
    }
  });

  test('sign-in, and the public check-in page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('login-submit-button')).toBeVisible({ timeout: 10000 });
    await expectAA(page, '/login');

    await page.goto(`/${marketSlug}/check-in`);
    await expect(page.getByTestId('attendance-checkin-market-name')).toBeVisible({
      timeout: 10000,
    });
    await expectAA(page, '/check-in');
  });

  test('the states a screenshot pass never opens', async ({ authenticatedPage: page }) => {
    // The invisible archive-confirmation button lived here, behind two clicks, and a twenty-screen
    // walk never found it.
    await openTheSeededMarket(page);
    await page.goto(`/markets/${marketId}/tables`);
    await expect(page.getByTestId('tables-count-assigned')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('phase-rail-menu-button').click();
    await expect(page.locator('.rail-menu-item').first()).toBeVisible();
    await expectAA(page, 'the phase-rail menu');

    await page.locator('.rail-menu-item--end').click();
    await expect(page.getByTestId('archive-confirm-dialog')).toBeVisible({ timeout: 5000 });
    await expectAA(page, 'the archive confirmation');

    // And the button is actually there, which is the whole of S01.
    const archive = page.locator('.confirm-archive-button');
    const painted = await archive.evaluate((el) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, border: style.borderWidth };
    });
    expect(painted.background, 'the archive button has no fill').not.toBe('rgba(0, 0, 0, 0)');

    // Leave the market as it was found. Cancel, never confirm: archiving is permanent, so a spec
    // that went through with it would only pass once.
    await page.getByTestId('archive-confirm-cancel').click();
    await expect(page.getByTestId('archive-confirm-dialog')).toBeHidden();
  });

  test('the new-market dialog, where a disabled primary lives', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets');
    await page.getByTestId('markets-create-button').click();
    await expect(page.getByTestId('new-market-name-input')).toBeVisible({ timeout: 5000 });
    await expectAA(page, 'the new-market dialog');
  });
});
