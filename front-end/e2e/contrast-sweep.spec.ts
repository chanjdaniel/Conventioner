import { test, expect } from './fixtures';
import { settle } from './helpers/settle';
import { walkTheSweptStates, type Check } from './helpers/theSweptStates';
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
 * **A sweep is only worth the states it walks**, so the states are one list, `walkTheSweptStates`,
 * shared with the accessibility sweep.
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
 * An empty failure list is not evidence on its own - it is also what a blank screen returns.
 * `checked` is how many visible text nodes were actually measured, so `expectAA` can tell a screen
 * that passed from a screen that never rendered.
 */
interface Sweep {
  failures: Failure[];
  checked: number;
}

/**
 * Every visible text node's contrast against the ground it is composited onto.
 *
 * The ground is walked up through ancestors and alpha-composited, because a translucent fill over
 * white is a different colour from the fill itself - which is exactly what `--mm-border` as a
 * button was.
 */
async function sweep(page: Page): Promise<Sweep> {
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
      /**
       * The colour an element is painted ON, walking up and compositing.
       *
       * `backgroundColor` alone is not enough: an element painted with a gradient reports
       * `rgba(0,0,0,0)` for it, so the walk sailed past the assignment summary's green card and
       * measured its white text against the page's white - 1:1, thirteen times, and the sweep
       * reported nothing because it was reading the wrong ground rather than a safe one.
       *
       * A gradient's first colour stop is taken as the ground. That is an approximation, and it is
       * the conservative direction for the cards in this product, whose gradients run between two
       * shades of one colour. A gradient between genuinely different colours would need sampling
       * the rendered pixel, which is a different tool than this.
       */
      const backgroundOf = (el: Element): number[] | null => {
        const style = getComputedStyle(el);
        const colour = parse(style.backgroundColor);
        if (colour && (colour[3] === undefined || colour[3] > 0)) return colour;

        const image = style.backgroundImage;
        if (image && image !== 'none') {
          const stop = image.match(/rgba?\([^)]*\)/);
          if (stop) return parse(stop[0]);
        }
        return null;
      };

      const groundOf = (el: Element) => {
        const stack: number[][] = [];
        for (let cur: Element | null = el; cur; cur = cur.parentElement) {
          const colour = backgroundOf(cur);
          if (colour) stack.push(colour);
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
      let checked = 0;
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
        checked++;
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
      return { failures: found.sort((a, b) => a.ratio - b.ratio), checked };
    },
    { normal: AA_NORMAL, large: AA_LARGE },
  );
}

/**
 * A screen with fewer visible text nodes than this has not rendered, whatever it reports.
 *
 * Two, not more: the sparsest state walked is the markets list of an organizer with none, which
 * measures three - its title, New market and "No markets found". The floor is here to catch a
 * blank render, not to pin a design decision about how much copy a screen carries.
 */
const MIN_TEXT_NODES = 2;

async function expectAA(page: Page, state: string): Promise<void> {
  await settle(page);
  const { failures, checked } = await sweep(page);
  expect(
    failures.map((f) => `"${f.text}" ${f.ratio}:1 (needs ${f.needs}) ${f.color} on ${f.ground}`),
    `${state} has text below AA`,
  ).toEqual([]);
  expect(checked, `${state} rendered almost no text, so its pass means nothing`).toBeGreaterThan(
    MIN_TEXT_NODES,
  );
}

const contrastTest = test.extend<{ check: Check }>({
  check: async ({ page }, use) => {
    await use((state) => expectAA(page, state));
  },
});

test.describe('Every rendered text node reaches AA', () => {
  walkTheSweptStates(contrastTest);
});
