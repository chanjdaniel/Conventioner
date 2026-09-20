import { test, expect, TEST_USER, BACKEND_URL, NewMarketPage } from './fixtures';
import { ensureTestOrg } from './helpers/seeds';
import type { Page } from '@playwright/test';

/**
 * A scrim stops the mouse. Until `E14/F02/S02` nothing stopped the keyboard, so every modal in the
 * product left the controls behind it in the tab order - reachable, focusable, and firable with
 * Enter. `E14/F02/S04` wired `useInertBehind` into all thirteen.
 *
 * `src/__tests__/modalsHoldThePageInert.test.ts` is what proves all thirteen are wired: it reads the
 * CSS and refuses a full-viewport cover in a component that does not call the composable, so a modal
 * added later cannot skip it. That test cannot say whether the wiring is CORRECT, which is what
 * these do - one per shape, because the shapes are what differ and the wiring within a shape is the
 * same three lines:
 *
 *   - the overlay whose root is always in the DOM and only made visible (`NewMarketOverlay`), where
 *     a mis-wired open state leaves the page inert forever rather than never;
 *   - the overlay whose scrim and panel are separate siblings (the app's navigation drawer), where
 *     naming only the scrim would mark the drawer itself and trap the keyboard in nothing.
 *
 * The third shape - a root that wraps the whole modal and is `v-if`'d in - is the vendor drawer's,
 * covered by `vendors.spec.ts`.
 */

/** Everything the page has marked out of play, by the testid or class that identifies it. */
async function inertRegions(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[inert]')).map(
      (el) => el.getAttribute('data-testid') ?? el.className.toString().split(' ')[0] ?? el.tagName,
    ),
  );
}

/**
 * Whether a control can actually take focus, which is the thing a scrim never governed.
 *
 * Waiting for a committed frame is load-bearing. Chromium only enforces `inert` once the frame
 * carrying it has been committed, so `focus()` called too early still succeeds - the attribute is
 * already in the DOM and `closest('[inert]')` finds it, but the browser has not acted on it yet.
 * A synchronous reflow is not enough; measured, it still let focus through. Two frames are.
 *
 * Without it this helper reports whatever the last frame happened to have computed, and the test
 * passes or fails on timing that has nothing to do with the wiring it is checking. `E15/F01/S01`
 * changed the page font, which shifted that timing and turned the latent flake into a hard failure.
 */
async function canFocus(page: Page, testId: string): Promise<boolean> {
  return page.evaluate(async (id) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    if (!el) return false;
    // Two frames, so the frame that carries the `inert` attribute has been fully committed. One
    // is not enough: the attribute lands during the first, and the browser acts on it in the next.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    el.focus();
    return document.activeElement === el;
  }, testId);
}

test.describe('A modal holds the page out of the keyboard, not just the mouse', () => {
  test.beforeAll(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
  });

  test('the new-market overlay, whose root is always in the DOM', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets');
    await expect(page.getByTestId('markets-create-button')).toBeVisible({ timeout: 10000 });

    // Nothing is marked before anything opens. This is the failure mode of an overlay whose root is
    // always rendered: wire the open state backwards and the page is inert for good.
    expect(await inertRegions(page)).toEqual([]);
    expect(await canFocus(page, 'markets-create-button')).toBe(true);

    await page.getByTestId('markets-create-button').click();
    const overlay = new NewMarketPage(page);
    await expect(overlay.nameInput).toBeVisible({ timeout: 5000 });

    expect(await inertRegions(page)).not.toEqual([]);
    expect(await canFocus(page, 'markets-create-button')).toBe(false);
    // The overlay's own controls are untouched, or there would be nothing to type into.
    await overlay.nameInput.focus();
    await expect(overlay.nameInput).toBeFocused();

    // A corner, not the centre: the dialog is centred in the scrim, so a default click lands on the
    // dialog. That is the overlay's own geometry and predates this change - no spec had clicked this
    // scrim before - but the dismissal itself is what the third criterion is about, so it is worth
    // proving rather than skipping.
    await overlay.overlayBackground.click({ position: { x: 8, y: 8 } });
    await expect(overlay.nameInput).toBeHidden({ timeout: 5000 });

    expect(await inertRegions(page)).toEqual([]);
    expect(await canFocus(page, 'markets-create-button')).toBe(true);
  });

  test('the navigation drawer, whose scrim and panel are separate siblings', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets');
    await expect(page.getByTestId('markets-create-button')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('app-menu-button').click();
    await expect(page.getByTestId('app-nav')).toBeVisible();

    // The page behind is out of play...
    expect(await canFocus(page, 'markets-create-button')).toBe(false);
    // ...and the drawer itself is not, which is the half that naming only the scrim would break.
    const navInert = await page.evaluate(
      () => document.querySelector('[data-testid="app-nav"]')?.closest('[inert]') !== null,
    );
    expect(navInert, 'the drawer marked itself out of play').toBe(false);

    const navButton = page.getByTestId('app-nav').getByRole('button').first();
    await navButton.focus();
    await expect(navButton).toBeFocused();
  });

  /**
   * The same defect standing the other way round, found while fixing the first: the drawer closes by
   * sliding to `left: -300px`, which moves it off screen without taking it out of the tab order. So
   * on every authenticated page a keyboard user could tab into a menu nobody can see (E14/F02/S04).
   */
  test('the closed navigation drawer is not in the tab order either', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets');
    await expect(page.getByTestId('markets-create-button')).toBeVisible({ timeout: 10000 });

    const navButton = page.getByTestId('app-nav').getByRole('button').first();
    await expect(navButton).toBeHidden();
    expect(
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid="app-nav"] button') as HTMLElement | null;
        el?.focus();
        return el !== null && document.activeElement === el;
      }),
      'a link in the closed drawer took focus',
    ).toBe(false);
  });
});
