import { test, expect } from './fixtures';
import { walkTheScreens, signIn, type Check } from './helpers/screens';
import { marketScreenPath } from './helpers/marketScreens';
import type { Page } from '@playwright/test';

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
 *
 * It presses Tab rather than calling `focus()`, since `:focus-visible` is what the keyboard gets.
 */

/** The halos' outer colours, as the browser computes `--focus-halo` and `--focus-halo-on-dark`. */
const HALO = 'rgba(54, 130, 111, 0.35)';
const HALO_ON_DARK = 'rgba(255, 255, 255, 0.35)';

/** How much wider than its words a text control's box may be: room for a marker before them. */
const WORDS_SLACK = 24;

/** The most Tab presses one state takes before its walk is cut short. */
const MOST_PRESSES = 150;

interface Walk {
  failures: string[];
  checked: number;
  /** How many keyboard stops the state draws, so a state with none is not read as a blank one. */
  stops: number;
}

/** The page's half of the sweep, installed on `window` by `installTheSweep`. */
interface SweepInPage {
  /** How a box looks: its outline, shadow, border colours and fill. */
  focusSweepLook: (el: Element) => string;
  /** What cuts off the halo `wearer` draws outside its edge, or null when it is drawn whole. */
  focusSweepClipper: (wearer: Element) => string | null;
}

/** Installs the page's half of the sweep: how a box looks, and what clips a control's halo. */
async function installTheSweep(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sweep = window as unknown as SweepInPage;
    sweep.focusSweepClipper = (wearer) => {
      // How far the halo reaches outside the edge: the widest of its rings not drawn inset.
      const reach = Math.max(
        0,
        ...getComputedStyle(wearer)
          .boxShadow.split(/,(?![^(]*\))/)
          .filter((ring) => !ring.includes('inset'))
          .map((ring) => Number(ring.match(/0px 0px 0px ([\d.]+)px/)?.[1] ?? 0)),
      );
      if (reach === 0) return null;
      const halo = wearer.getBoundingClientRect();
      // Up the chain of containing blocks: a box only clips what is placed inside it.
      let child: Element = wearer;
      for (let box = wearer.parentElement; box && box !== document.body; box = box.parentElement) {
        const placed = getComputedStyle(child).position;
        if (placed === 'fixed') return null;
        const b = getComputedStyle(box);
        if (placed === 'absolute' && b.position === 'static') continue;
        child = box;
        if (b.overflowX === 'visible' && b.overflowY === 'visible') continue;
        // What `overflow` clips to: the box inside its border.
        const edge = box.getBoundingClientRect();
        const cut = [
          halo.left - reach < edge.left + parseFloat(b.borderLeftWidth) - 0.5,
          halo.right + reach > edge.right - parseFloat(b.borderRightWidth) + 0.5,
          halo.top - reach < edge.top + parseFloat(b.borderTopWidth) - 0.5,
          halo.bottom + reach > edge.bottom - parseFloat(b.borderBottomWidth) + 0.5,
        ];
        if (cut.some(Boolean)) {
          const name = box.tagName.toLowerCase() + (box.className ? `.${box.className}` : '');
          const sides = ['left', 'right', 'top', 'bottom'].filter((_, i) => cut[i]).join(' ');
          return `${name} (overflow ${b.overflowX} ${b.overflowY}), at its ${sides}`;
        }
      }
      return null;
    };
    sweep.focusSweepLook = (el) => {
      const s = getComputedStyle(el);
      return [
        s.outlineStyle === 'none'
          ? 'none'
          : `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
        s.boxShadow,
        s.borderTopColor,
        s.borderRightColor,
        s.borderBottomColor,
        s.borderLeftColor,
        s.backgroundColor,
      ].join(' | ');
    };
  });
}

/**
 * Marks every field and the two boxes around it with how they look with nothing focused, and
 * says how many keyboard stops the state draws.
 */
async function rememberFieldsAtRest(page: Page): Promise<number> {
  await installTheSweep(page);
  return page.evaluate(() => {
    const sweep = window as unknown as SweepInPage;
    (document.activeElement as HTMLElement | null)?.blur();
    for (const field of document.querySelectorAll('input, textarea, select')) {
      let el: Element | null = field;
      for (let depth = 0; el && depth < 3; depth++, el = el.parentElement) {
        (el as HTMLElement).dataset.lookAtRest = sweep.focusSweepLook(el);
      }
    }
    const stops =
      'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>(stops)).filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && !el.closest('[inert]') && !el.matches(':disabled');
    }).length;
  });
}

/** Presses Tab through the state and judges each element it lands on. */
async function walkByTab(page: Page, state: string): Promise<Omit<Walk, 'stops'>> {
  const failures: string[] = [];
  let checked = 0;
  const seen = new Set<string>();
  for (let press = 0; press < MOST_PRESSES; press++) {
    await page.keyboard.press('Tab');
    const verdict = await page.evaluate(
      ({ halo, haloOnDark, wordsSlack }) => {
        const { focusSweepLook: look, focusSweepClipper: clipper } =
          window as unknown as SweepInPage;
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        // Every transition run to its end, so what is read is the focused look, not a frame of it.
        for (const animation of document.getAnimations()) {
          if (animation.effect?.getTiming().iterations !== Infinity) animation.finish();
        }
        el.dataset.focusWalkId ??= String(Math.random());
        const id = el.dataset.focusWalkId;
        const name =
          el.tagName.toLowerCase() +
          (el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : '') +
          (typeof el.className === 'string' && el.className.trim()
            ? `.${el.className.trim().split(/\s+/).join('.')}`
            : '');
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return { id, name, problems: null };

        const problems: string[] = [];
        const isField =
          el.matches('textarea, select') ||
          (el.matches('input') &&
            !el.matches('[type=button], [type=submit], [type=reset], [type=image]'));
        if (isField) {
          let node: Element | null = el;
          for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
            const atRest = (node as HTMLElement).dataset.lookAtRest;
            const now = look(node);
            // A field drawn after the snapshot has nothing to compare, but draws no outline either.
            if (atRest === undefined) {
              if (depth === 0 && !now.startsWith('none |')) problems.push(`a field drew ${now}`);
              continue;
            }
            if (now !== atRest) {
              const which = depth === 0 ? 'the field' : `the box ${depth} up`;
              problems.push(`${which} changed on focus: ${atRest} -> ${now}`);
            }
          }
          return { id, name, problems };
        }

        const s = getComputedStyle(el);
        if (s.outlineStyle !== 'none' && s.outlineWidth !== '0px') {
          problems.push(`a control drew an outline: ${s.outlineStyle} ${s.outlineWidth}`);
        }
        // The ground the halo is drawn on: the first ancestor with a fill.
        let ground: number[] = [255, 255, 255];
        for (let node = el.parentElement; node; node = node.parentElement) {
          const fill = getComputedStyle(node)
            .backgroundColor.match(/[\d.]+/g)
            ?.map(Number);
          if (fill && (fill[3] ?? 1) > 0.5) {
            ground = fill;
            break;
          }
        }
        const dark = 0.2126 * ground[0] + 0.7152 * ground[1] + 0.0722 * ground[2] < 96;
        const wanted = dark ? haloOnDark : halo;
        // A control with no shadow of its own may have a box up to four levels around it wear
        // the halo, as a market card does for its name.
        const wears = (node: Element) => getComputedStyle(node).boxShadow.includes(wanted);
        let worn = wears(el);
        for (
          let node = el.parentElement, up = 1;
          !worn && s.boxShadow === 'none' && node && up <= 4;
          node = node.parentElement, up++
        ) {
          worn = wears(node);
        }
        if (!worn) {
          const which = dark ? 'halo for a dark ground' : 'halo';
          problems.push(`a control drew no ${which}: box-shadow ${s.boxShadow}`);
          return { id, name, problems };
        }

        // The halo hugs what it marks: rounded, and around a text control's words rather than
        // the row it sits in.
        let wearer: Element = el;
        while (!wears(wearer) && wearer.parentElement) wearer = wearer.parentElement;
        const w = getComputedStyle(wearer);
        const corners = [
          w.borderTopLeftRadius,
          w.borderTopRightRadius,
          w.borderBottomRightRadius,
          w.borderBottomLeftRadius,
        ];
        if (corners.some((corner) => parseFloat(corner) === 0)) {
          problems.push(`a halo with square corners: border-radius ${corners.join(' ')}`);
        }
        const clippedBy = clipper(wearer);
        if (clippedBy) problems.push(`a halo cut off by ${clippedBy}`);
        const unfilled = (w.backgroundColor.match(/[\d.]+/g)?.map(Number)[3] ?? 1) === 0;
        const unbordered = ['top', 'right', 'bottom', 'left'].every(
          (side) => parseFloat(w.getPropertyValue(`border-${side}-width`)) === 0,
        );
        if (wearer === el && unfilled && unbordered) {
          const words = document.createRange();
          words.selectNodeContents(el);
          const room =
            box.width -
            parseFloat(w.paddingLeft) -
            parseFloat(w.paddingRight) -
            words.getBoundingClientRect().width;
          // A marker drawn before the words, as a disclosure's is, takes about 16px.
          if (room > wordsSlack) {
            problems.push(`a text control's halo runs ${Math.round(room)}px past its words`);
          }
        }
        return { id, name, problems };
      },
      { halo: HALO, haloOnDark: HALO_ON_DARK, wordsSlack: WORDS_SLACK },
    );
    if (!verdict) continue;
    if (seen.has(verdict.id)) break;
    seen.add(verdict.id);
    if (!verdict.problems) continue;
    checked++;
    for (const problem of verdict.problems) failures.push(`${state}: ${verdict.name}: ${problem}`);
  }
  return { failures, checked };
}

const focusTest = test.extend<{ check: Check }>({
  check: async ({ page }, use) => {
    await use(async (state) => {
      const stops = await rememberFieldsAtRest(page);
      const { failures, checked } = await walkByTab(page, state);
      // A state that draws keyboard stops and was walked to none of them proves nothing.
      if (stops > 0) expect(checked, `${state}: Tab reached nothing`).toBeGreaterThan(0);
      expect([...failures, ...(await windowsFocused(page, state))]).toEqual([]);
    });
  },
});

/**
 * Focuses each dialog window the state shows, as AppDialog does when it opens with no control
 * ready, and says which drew an outline. Focus moved by a script after a Tab is `:focus-visible`,
 * so the window is focused as a keyboard user's would be.
 */
async function windowsFocused(page: Page, state: string): Promise<string[]> {
  return page.evaluate((state) => {
    const failures: string[] = [];
    for (const win of document.querySelectorAll<HTMLElement>("[role='dialog'][tabindex='-1']")) {
      win.focus();
      if (!win.matches(':focus-visible')) {
        failures.push(`${state}: a dialog window was focused, but not as a keyboard user's`);
        continue;
      }
      const s = getComputedStyle(win);
      if (s.outlineStyle !== 'none' && s.outlineWidth !== '0px') {
        failures.push(
          `${state}: a dialog window drew an outline: ${s.outlineStyle} ${s.outlineWidth}`,
        );
      }
    }
    return failures;
  }, state);
}

test.describe('Focus shows on controls only, as the soft halo', () => {
  const { seed } = walkTheScreens(focusTest, { everySize: false });

  // The phase rail's menu items are no Tab stop, so the walk never reaches them: the arrow keys
  // move among them. The menu's own box clips what is drawn past its edge, which hid their halo.
  test("the phase rail's menu, worked from the keyboard, shows each item's halo whole", async ({
    page,
  }) => {
    await signIn(page, 'organizer', seed());
    await page.goto(marketScreenPath(seed().review.marketId, 'applications'));
    const button = page.getByTestId('phase-rail-menu-button');
    await button.waitFor();
    await installTheSweep(page);
    await button.focus();
    await page.keyboard.press('Enter');
    const items = page.locator('.rail-menu-item');
    await expect(items.first()).toBeFocused();

    const failures: string[] = [];
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      await expect(item).toBeFocused();
      const verdict = await item.evaluate((el, halo) => {
        const s = getComputedStyle(el);
        if (!el.matches(':focus-visible')) return "not focused as a keyboard user's";
        if (!s.boxShadow.includes(halo)) return `no halo: box-shadow ${s.boxShadow}`;
        const clippedBy = (window as unknown as SweepInPage).focusSweepClipper(el);
        return clippedBy && `a halo cut off by ${clippedBy}`;
      }, HALO);
      if (verdict) failures.push(`${(await item.textContent())?.trim()}: ${verdict}`);
      await page.keyboard.press('ArrowDown');
    }
    expect(failures).toEqual([]);
  });

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
