import type { Page } from '@playwright/test';

/**
 * The contrast sweep's measures, run in the page: every visible text node's contrast against the
 * ground it is composited onto (E16/F01/S05), and every disabled control drawing the one disabled
 * state's line (T162). `contrast-sweep.spec.ts` runs them over every screen, and
 * `contrast-measure.spec.ts` shows them fixture pages with each defect they are meant to catch.
 */

export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;

export interface Failure {
  text: string;
  ratio: number;
  needs: number;
  color: string;
  ground: string;
}

/**
 * An empty failure list is not evidence on its own - it is also what a blank screen returns.
 * `checked` is how many visible text nodes were actually measured, so a caller can tell a screen
 * that passed from a screen that never rendered.
 */
export interface Sweep {
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
export async function sweep(page: Page): Promise<Sweep> {
  return page.evaluate(
    ({ normal, large }) => {
      const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      const luminance = ([r, g, b]: number[]) =>
        0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      // A `color-mix()` computes to `color(srgb r g b / a)`, its channels 0 to 1: read as 0 to
      // 255, the floorplan's hovered Sections button measured as black (E38/F01/S01).
      const parse = (value: string) => {
        const parts = value
          .match(/[\d.]+/g)
          ?.slice(0, 4)
          .map(Number);
        if (!parts) return null;
        if (!value.startsWith('color(srgb')) return parts;
        return parts.map((part, i) => (i < 3 ? part * 255 : part));
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

        // An ancestor's opacity dims the text it holds as much as the text's own does: a line at
        // 0.8 drew the Vendors page's 4.59:1 green counts at 3.2:1 (T162). So the opacities up the
        // chain multiply into the colour's own alpha before it is laid over its ground.
        let shown = 1;
        for (let cur: Element | null = el; cur; cur = cur.parentElement) {
          shown *= +getComputedStyle(cur).opacity;
        }
        if (shown === 0) return;
        const colour = parse(style.color);
        if (!colour) return;
        const fg = [...colour.slice(0, 3), (colour[3] ?? 1) * shown];
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
 * Every shown disabled control that draws no line around itself, each as `<tag>.<class> "words"`.
 *
 * The one disabled state (`.btn:disabled`, `docs/design-system.md`) is beige inside a `--mm-border`
 * line. A control of a component's own drawn with `border: none` took the beige and the ink and drew
 * no line, so Publish Results disabled read as a beige patch beside the bar's Publish Market, which
 * had one (T162). A checkbox, a radio, a range and a file input are drawn by the browser and stay
 * out of it, as does a control drawn as words with no fill (a link's look, as "Resend code in 30s"
 * is), and a control in a disabled `<fieldset>`: the settled plan is read as it stands, its
 * calendar and its fields as they were written.
 */
export async function disabledWithoutLine(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ownDrawing = new Set(['checkbox', 'radio', 'range', 'file', 'color', 'hidden']);
    const transparent = (value: string) => {
      const parts = value.match(/[\d.]+/g)?.map(Number);
      return !parts || (parts.length > 3 && parts[3] === 0);
    };
    const found: string[] = [];
    document
      .querySelectorAll<HTMLElement>(
        'button:disabled, input:disabled, select:disabled, textarea:disabled',
      )
      .forEach((el) => {
        if (el instanceof HTMLInputElement && ownDrawing.has(el.type)) return;
        // A form disabled as a whole, as a settled plan is, is a record read as it stands, not a
        // control that is unavailable among others that are.
        if (el.closest('fieldset:disabled')) return;
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden') return;
        // A control drawn as words, a link's look, has no box to draw a line around: with no fill
        // it is not the one disabled state's beige box. A box has a fill, and its line is checked.
        if (transparent(style.backgroundColor)) return;
        const drawn = ['top', 'right', 'bottom', 'left'].every(
          (side) =>
            parseFloat(style.getPropertyValue(`border-${side}-width`)) >= 1 &&
            style.getPropertyValue(`border-${side}-style`) !== 'none' &&
            !transparent(style.getPropertyValue(`border-${side}-color`)),
        );
        if (drawn) return;
        const words = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
        const name = el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? '';
        found.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${words || name}"`);
      });
    return found;
  });
}
