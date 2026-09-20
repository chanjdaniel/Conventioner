/**
 * Every control renders in the product's own typeface (E15/F01/S01).
 *
 * `<button>`, `<input>`, `<select>` and `<textarea>` do not inherit `font-family` from their
 * ancestors - the user agent sets it. Only five rules in this repo said `font: inherit`, so most
 * controls in the product rendered in **Arial** while the text around them rendered in Outfit.
 * Measured on `/login`, the first screen any organizer sees: three typefaces and five control
 * heights, two of the controls at `13.3333px`, which is the browser's own default and the tell
 * that they had never been styled at all.
 *
 * The obvious one-line fix is wrong. `button { font: inherit }` on its own makes every control
 * render **Inter**, because that is what `body` declared - while the 274 Outfit rules around them
 * stayed Outfit. So the rule has two halves and this test asserts both:
 *
 *   1. `body` declares the product's UI face, and Inter is gone.
 *   2. The controls inherit it.
 *
 * It parses the real stylesheets rather than importing values, for the reason `contrast.test.ts`
 * gives: the file that ships is the file under test.
 *
 * What it does NOT see, so the next reader does not assume otherwise:
 *
 * - It reads `base.css` and `main.css` only. A control restyled from a component's own scoped
 *   `<style>` is invisible here; `e2e/typography.spec.ts` is what walks the rendered product.
 * - It checks that the inheriting rule EXISTS, not that nothing later overrides it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath } from 'node:path';

const SRC = resolvePath(process.cwd(), 'src');
const BASE_CSS = readFileSync(join(SRC, 'assets/base.css'), 'utf8');
const MAIN_CSS = readFileSync(join(SRC, 'assets/main.css'), 'utf8');
const GLOBAL_CSS = `${BASE_CSS}\n${MAIN_CSS}`;

/** The family every non-heading surface in the product is set in. */
const UI_FACE = 'Outfit';

/**
 * Every innermost `{...}` block whose selector list contains `selector`, in source order.
 *
 * All of them, not the first: CSS cascades, and `main.css` targets `button` twice - once for
 * `cursor: pointer` and once for the font. Matching only the first is how this helper originally
 * reported a correct stylesheet as broken.
 */
function ruleBlocks(css: string, selector: string): string[] {
  const inList = new RegExp(`(^|,)\\s*${selector}\\s*(,|$)`);
  const blocks: string[] = [];
  // Split rather than match: a global regex consumes the `}` it matched, so the next rule has no
  // `}` left to anchor against and every rule after the first goes unseen.
  for (const chunk of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const opens = chunk.lastIndexOf('{');
    if (opens === -1) continue;
    const preamble = chunk.slice(0, opens);
    // For a rule nested in an at-rule the preamble still carries `@media (...) {`; the selector
    // list is whatever follows the innermost brace before this one.
    const selectors = preamble
      .slice(preamble.lastIndexOf('{') + 1)
      .replace(/\s+/g, ' ')
      .trim();
    if (inList.test(selectors)) blocks.push(chunk.slice(opens + 1));
  }
  return blocks;
}

function sourceFiles(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full, extensions);
    return extensions.some((e) => entry.endsWith(e)) ? [full] : [];
  });
}

describe('the product has one UI typeface', () => {
  it('declares it on body', () => {
    const [body] = ruleBlocks(BASE_CSS, 'body');
    expect(body, 'base.css should declare a body rule').toBeDefined();

    const declared = body.match(/font-family:([^;]+);/);
    expect(declared, 'body should declare a font-family').not.toBeNull();

    const firstFamily = declared![1]
      .split(',')[0]
      .trim()
      .replace(/^['"]|['"]$/g, '');
    expect(firstFamily).toBe(UI_FACE);
  });

  it('does not mention Inter anywhere in src', () => {
    // Inter was body's declared face while 274 component rules overrode it to Outfit. It survived
    // in two rules and in the one place nothing overrode it - the form controls, which do not
    // inherit font-family and fell through to the user agent's Arial instead.
    // Comments are stripped first. Several of them name Inter on purpose - explaining what was
    // there and why it went is the point of them - and a guard that forbids saying the word would
    // just delete its own reason for existing.
    const withoutComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    const offenders = sourceFiles(SRC, ['.css', '.vue', '.ts'])
      .filter((file) => !file.endsWith('everyControlRendersInOutfit.test.ts'))
      .filter((file) => /\bInter\b/.test(withoutComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(SRC, file));

    expect(offenders).toEqual([]);
  });
});

describe('form controls inherit the page font', () => {
  it('has a global rule making them inherit', () => {
    // `font` rather than `font-family`: the shorthand brings size and weight along, and a control
    // left at the user agent's 13.3333px is as wrong as one left in Arial.
    const blocks = ruleBlocks(GLOBAL_CSS, 'button');
    expect(blocks.length, 'a global rule should target button').toBeGreaterThan(0);
    expect(blocks.some((b) => /\bfont:\s*inherit\b/.test(b))).toBe(true);
  });

  it('covers every control element, not just button', () => {
    // A select left out is a select in Arial, and selects are where the market plan lives.
    for (const control of ['button', 'input', 'select', 'textarea']) {
      const blocks = ruleBlocks(GLOBAL_CSS, control);
      expect(blocks.length, `no global rule targets ${control}`).toBeGreaterThan(0);
      expect(
        blocks.some((b) => /\bfont:\s*inherit\b/.test(b)),
        `${control} does not inherit its font`,
      ).toBe(true);
    }
  });
});
