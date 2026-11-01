import { test, expect } from './fixtures';
import { walkTheScreens, PHONE, type Check } from './helpers/screens';
import {
  rememberFieldsAtRest,
  walkByTab,
  walkTheMenus,
  windowsFocused,
} from './helpers/focusSweep';

/**
 * Focus shows on controls only (E38/F01/S01), on every screen and state the sweeps walk.
 *
 * - A field (`input`, `textarea`, `select`) focused by Tab looks as it did unfocused: no outline,
 *   ring, glow, or border or fill change, on it or on the two boxes around it, which is where the
 *   plan cards and the sign-in page drew theirs. A text field shows its caret and nothing else, by
 *   Daniel's decision on the 2026-10-29 walk.
 * - A control focused by Tab draws the soft halo and no outline, so neither the old ring nor the
 *   browser's own is left anywhere; a control with no shadow of its own may have a box around it
 *   wear the halo, as a market card does for its name. The halo is `--focus-halo` on a light
 *   ground and `--focus-halo-on-dark` on a dark one (the market bar, the vendor drawer's head).
 * - The halo hugs what it marks: its corners are rounded, and a text control with no fill or
 *   border is about as wide as its words, not the row it sits in.
 * - A dialog's window, which AppDialog focuses when no control in it is ready, draws no outline.
 * - Every menu the state shows (`aria-haspopup="menu"`) is opened with Enter and walked with the
 *   arrow keys, since its items are no Tab stop, and each item is judged as a control.
 *
 * It presses Tab rather than calling `focus()`, since `:focus-visible` is what the keyboard gets.
 * Each state is walked at its first size and at a phone's width too: an organizer's screens ship
 * at a desk, but a desk zoomed to 400% is that narrow, and a table too wide for it scrolls, which
 * makes its scroller a keyboard stop of its own.
 */

const focusTest = test.extend<{ check: Check }>({
  check: async ({ page }, use) => {
    await use(async (name) => {
      const state = `${name}, at ${page.viewportSize()?.width}px`;
      // The state's last click leaves the pointer over the page, and a focus that scrolls a box
      // can bring the box around the focused field under it, whose hover fill would read as a look
      // focus drew.
      await page.mouse.move(0, 0);
      const stops = await rememberFieldsAtRest(page);
      const { failures, checked } = await walkByTab(page, state);
      // A state that draws keyboard stops and was walked to none of them proves nothing.
      if (stops > 0) expect(checked, `${state}: Tab reached nothing`).toBeGreaterThan(0);
      failures.push(...(await walkTheMenus(page, state)));
      failures.push(...(await windowsFocused(page, state)));
      expect(failures).toEqual([]);
    });
  },
});

test.describe('Focus shows on controls only, as the soft halo', () => {
  walkTheScreens(focusTest, { everySize: false, alsoAt: PHONE });

  // AppDialog focuses its window when no control is ready to take focus, as Manage market's is
  // not while its market loads; the browser drew its own ring around the whole window.
  test('a dialog opened from the keyboard draws no ring around its window', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/markets');
    const manage = page.getByTestId('market-card-manage-button').first();
    await manage.waitFor();
    await manage.focus();
    await page.keyboard.press('Enter');
    const win = page.getByTestId('manage-market-window');
    await expect(win).toBeFocused();
    expect(await win.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
    await expect(win).toHaveCSS('outline-style', 'none');
  });
});
