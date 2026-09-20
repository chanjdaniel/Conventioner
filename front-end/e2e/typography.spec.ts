import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg, seedPublishedMarketWithAssignments } from './helpers/seeds';
import type { Page } from '@playwright/test';

/**
 * Every control renders in the product's own typeface (E15/F01/S01).
 *
 * `src/__tests__/everyControlRendersInOutfit.test.ts` proves the two halves of the rule exist in the
 * stylesheets - `body` names Outfit, and the controls inherit it. It cannot say what the browser
 * actually paints, which is what this does, because the bug it guards against was invisible in the
 * source: a `<button>` with no font rule looks fine in CSS and renders in Arial.
 *
 * Measured before the fix, across ten screens: **61 elements in Arial and 56 in Inter**, including
 * every field value and column header on the market plan.
 *
 * The assertion is deliberately "not a user-agent default" rather than a list of allowed families.
 * A list would have to be updated by whoever adds a third face, and the thing worth catching is not
 * "an unexpected family" but "nobody chose this at all" - which is exactly what Arial at
 * 13.3333px means.
 */

/** The families a browser falls back to when nothing in the page chose one. */
const USER_AGENT_DEFAULTS =
  /^(Arial|Helvetica|Times New Roman|Times|serif|sans-serif|-apple-system)$/;

interface Rendered {
  family: string;
  size: string;
  text: string;
  tag: string;
}

/**
 * Every visible element that either carries its own text or is a control.
 *
 * Controls are included even when empty, because an empty `<input>` still renders its placeholder
 * and its typed value in whatever face it inherited - and the inputs were the whole finding.
 */
async function renderedFaces(page: Page): Promise<Rendered[]> {
  return page.evaluate(() => {
    const out: Rendered[] = [];
    document.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;

      const ownText = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join(' ')
        .trim();
      const isControl = /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
      if (!ownText && !isControl) return;

      out.push({
        family: cs.fontFamily.split(',')[0].replace(/["']/g, ''),
        size: cs.fontSize,
        text: (ownText || el.getAttribute('placeholder') || '').slice(0, 40),
        tag: el.tagName,
      });
    });
    return out;
  });
}

async function expectNoUserAgentFont(page: Page, screen: string): Promise<void> {
  const rendered = await renderedFaces(page);
  expect(rendered.length, `${screen} rendered nothing to check`).toBeGreaterThan(0);

  const fallenThrough = rendered
    .filter((r) => USER_AGENT_DEFAULTS.test(r.family))
    .map((r) => `${r.tag} "${r.text}" in ${r.family} at ${r.size}`);

  expect(fallenThrough, `${screen} has controls the product never styled`).toEqual([]);
}

test.describe('No element falls through to a user-agent font', () => {
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

  /**
   * `/market-setup` reads its market from `localStorage`, so a bare `goto` renders an empty shell
   * and this spec would pass by having nothing to check. Same injection `date-display-timezone`
   * and `market-pipeline` use.
   */
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

  test('the sign-in screen, which is where the fallback was worst', async ({ page }) => {
    // Three typefaces and five control heights lived here: the mode tabs, both inputs and the Show
    // toggle were Arial, the submit button Outfit, the sign-out button Inter.
    await page.goto('/login');
    await expectNoUserAgentFont(page, '/login');
  });

  test('the market plan, where every field value was Inter', async ({ authenticatedPage }) => {
    await openTheSeededMarket(authenticatedPage);
    await authenticatedPage.goto('/market-setup');
    await expect(authenticatedPage.getByTestId('setup-dates-date-display-0')).toBeVisible({
      timeout: 10000,
    });

    await expectNoUserAgentFont(authenticatedPage, '/market-setup');
  });

  test('the tables view, where a heading row sets Merge One on its children', async ({
    authenticatedPage,
  }) => {
    // This screen is why removing a component's `font-family` is not a blind find-and-replace:
    // the date heading sets Merge One on the whole row, so `.section-heading-meta` has to opt back
    // out. Twenty-four chips silently became headings when that declaration was first removed.
    await openTheSeededMarket(authenticatedPage);
    await authenticatedPage.goto(`/markets/${marketId}/tables`);
    await expect(authenticatedPage.getByTestId('tables-count-assigned')).toBeVisible({
      timeout: 10000,
    });

    await expectNoUserAgentFont(authenticatedPage, '/tables');

    const metaFace = await authenticatedPage
      .locator('.section-heading-meta')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, ''));
    expect(metaFace, 'the section meta chip should not inherit the heading face').toBe('Outfit');
  });

  test('the public check-in page, which no organizer login protects', async ({ page }) => {
    await page.goto(`/${marketSlug}/check-in`);
    await expect(page.getByTestId('attendance-checkin-market-name')).toBeVisible({
      timeout: 10000,
    });

    await expectNoUserAgentFont(page, '/check-in');
  });
});
