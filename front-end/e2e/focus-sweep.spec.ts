import { test, expect } from './fixtures';
import { walkTheScreens, type Check } from './helpers/screens';
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
 *   wear the halo, as a market card does for its name: `--focus-halo` on a light ground, `--focus-halo-on-dark` on a
 *   dark one (the market bar, the vendor drawer's head).
 *
 * It presses Tab rather than calling `focus()`, since `:focus-visible` is what the keyboard gets.
 */

/** The halos' outer colours, as the browser computes `--focus-halo` and `--focus-halo-on-dark`. */
const HALO = 'rgba(54, 130, 111, 0.35)';
const HALO_ON_DARK = 'rgba(255, 255, 255, 0.35)';

/** The most Tab presses one state takes before its walk is cut short. */
const MOST_PRESSES = 150;

interface Walk {
  failures: string[];
  checked: number;
  /** How many keyboard stops the state draws, so a state with none is not read as a blank one. */
  stops: number;
}

/**
 * Installs the page's half of the sweep: how a box looks, and where a control's halo falls. Then
 * marks every field and the two boxes around it with how they look with nothing focused.
 */
async function rememberFieldsAtRest(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sweep = window as unknown as { focusSweepLook: (el: Element) => string };
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
      ({ halo, haloOnDark }) => {
        const look = (window as unknown as { focusSweepLook: (el: Element) => string })
          .focusSweepLook;
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
        // A control with no shadow of its own may have a box up to four levels around it wear the halo,
        // as a market card does for its name.
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
        }
        return { id, name, problems };
      },
      { halo: HALO, haloOnDark: HALO_ON_DARK },
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
      expect(failures).toEqual([]);
    });
  },
});

test.describe('Focus shows on controls only, as the soft halo', () => {
  walkTheScreens(focusTest, { everySize: false });
});
