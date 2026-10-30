/**
 * The primitive layer's contract (E16/F04).
 *
 * This is the reference `E16/F05`-`F08` check their migrations against, and it is deliberately a
 * test rather than a demo page: a page would be product surface nobody ships, while a test fails
 * when the contract drifts.
 *
 * What it asserts is the thing tokens could not express. `--radius-control` does not stop a file
 * writing `height: 45px`, and that is where the damage was: five control heights on the login
 * screen, ten on Market Setup, four disabled treatments, sixty button-ish class names.
 *
 * It reads the real `primitives.css` rather than mounting components, for the reason
 * `contrast.test.ts` gives: the file that ships is the file under test. jsdom does not apply
 * stylesheets, so mounting would assert nothing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import postcss from 'postcss';

const SRC = resolvePath(process.cwd(), 'src');
const CSS = readFileSync(join(SRC, 'assets/primitives.css'), 'utf8');
const BASE = readFileSync(join(SRC, 'assets/base.css'), 'utf8');
const PRIMITIVES = postcss.parse(CSS);
const BASE_ROOT = postcss.parse(BASE);

/** Every innermost rule block whose selector list contains `selector`, in source order. */
function blocks(selector: string): string[] {
  const inList = new RegExp(
    `(^|,)\\s*${selector.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\s*(,|$)`,
  );
  const found: string[] = [];
  for (const chunk of CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const opens = chunk.lastIndexOf('{');
    if (opens === -1) continue;
    const selectors = chunk.slice(0, opens).replace(/\s+/g, ' ').trim();
    if (inList.test(selectors)) found.push(chunk.slice(opens + 1));
  }
  return found;
}

function declaration(selector: string, property: string): string | null {
  for (const body of blocks(selector)) {
    const match = body.match(new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`));
    if (match) return match[1].trim();
  }
  return null;
}

/** The first rule whose selector list holds `selector`, in source order, or null. */
function ruleWithSelector(container: postcss.Container, selector: string): postcss.Rule | null {
  let found: postcss.Rule | null = null;
  container.walkRules((rule) => {
    if (!found && rule.selectors?.includes(selector)) found = rule;
  });
  return found;
}

/** The value of `property` in `rule`, or null when the rule or the declaration is absent. */
function valueInRule(rule: postcss.Rule | null, property: string): string | null {
  if (!rule) return null;
  let value: string | null = null;
  rule.walkDecls(property, (decl) => {
    value = decl.value;
  });
  return value;
}

/** The value of `property` in the first rule whose selector list holds `selector`. */
function valueIn(
  container: postcss.Container | null,
  selector: string,
  property: string,
): string | null {
  return container ? valueInRule(ruleWithSelector(container, selector), property) : null;
}

/** The first media at-rule whose params are exactly `params`, or null. */
function mediaAt(container: postcss.Container, params: string): postcss.AtRule | null {
  let found: postcss.AtRule | null = null;
  container.walkAtRules('media', (atRule) => {
    if (!found && atRule.params.trim() === params) found = atRule;
  });
  return found;
}

describe('the primitives exist and own what tokens cannot', () => {
  it('gives a control one standard height and one compact height, and no third', () => {
    // The two heights are tokens, so a phone can raise both to a thumb's target in one place.
    expect(valueIn(PRIMITIVES, '.btn', 'height')).toBe('var(--control-height)');
    expect(valueIn(PRIMITIVES, '.field', 'height')).toBe('var(--control-height)');
    expect(valueIn(PRIMITIVES, '.add-row', 'height')).toBe('var(--control-height)');
    expect(valueIn(PRIMITIVES, '.btn--compact', 'height')).toBe('var(--control-height-compact)');
    // No pixel height is left but the textarea's 72px, which is a min, not a control height.
    const heights = new Set<string>();
    PRIMITIVES.walkDecls(/height$/, (decl) => {
      const pixels = decl.value.match(/^(\d+)px$/);
      if (pixels) heights.add(pixels[1]);
    });
    expect([...heights]).toEqual(['72']);
  });

  it('sets the control heights at 36px and 28px, and at 44px on a phone', () => {
    // A thumb wants 44px (Apple's and Material's guidance; WCAG 2.5.5's AAA target), and the
    // layout sweep fails a phone control under it. A desk keeps 36px and 28px, and WCAG 2.5.8's
    // 24px floor for a target that is not a control.
    expect(valueIn(BASE_ROOT, ':root', '--control-height')).toBe('36px');
    expect(valueIn(BASE_ROOT, ':root', '--control-height-compact')).toBe('28px');
    expect(valueIn(BASE_ROOT, ':root', '--target-min')).toBe('24px');

    const phone = mediaAt(BASE_ROOT, '(width <= 640px)');
    expect(valueIn(phone, ':root', '--control-height')).toBe('44px');
    expect(valueIn(phone, ':root', '--control-height-compact')).toBe('44px');
    expect(valueIn(phone, ':root', '--target-min')).toBe('44px');
  });

  it('sizes and spaces itself from the scale, never from a literal', () => {
    // A primitive that hardcodes a pixel is a primitive that cannot be restyled from one place,
    // which is the whole reason this layer exists.
    const offenders = [
      ['.btn', 'padding'],
      ['.btn', 'border-radius'],
      ['.btn', 'font-size'],
      ['.field', 'padding'],
      ['.field', 'border-radius'],
      ['.field', 'font-size'],
      ['.chip', 'border-radius'],
      ['.chip', 'font-size'],
      ['.add-row', 'padding'],
      ['.add-row', 'border-radius'],
      ['.add-row', 'font-size'],
      ['.add-row', 'gap'],
    ].filter(([selector, property]) => !declaration(selector, property)?.includes('var(--'));

    expect(offenders).toEqual([]);
  });

  it('has exactly three button intents', () => {
    const intents = [...CSS.matchAll(/^\.btn--([a-z]+)\s*\{/gm)].map((m) => m[1]);
    expect(intents.sort()).toEqual(['compact', 'destructive', 'primary', 'secondary']);
  });

  it('marks a pressed toggle with the positive tint and its measured ink', () => {
    // A state, not an intent: the phase filter's toggles stay secondary buttons when pressed.
    expect(declaration(".btn[aria-pressed='true']", 'color')).toBe('var(--mm-text-green)');
    expect(declaration(".btn[aria-pressed='true']", 'background')).toBe(
      declaration('.chip--positive', 'background'),
    );
  });

  it('has one disabled state, and it does not rely on text contrast', () => {
    // The product had four treatments, one of which put white text on `--mm-border` at 1.74:1.
    expect(blocks('.btn:disabled')).toHaveLength(1);
    expect(declaration('.btn:disabled', 'color')).toBe('var(--mm-text-muted-on-beige)');
    expect(declaration('.btn:disabled', 'background')).toBe('var(--mm-beige)');
  });

  it('left-aligns fields', () => {
    // 18 of 27 controls on Market Setup were centred.
    expect(declaration('.field', 'text-align')).toBe('left');
  });

  it('keeps a select inside its column, whatever its options say', () => {
    // `min-content` is the widest option in Firefox alone, so a select of questions or answers
    // ran out of its column and under the next one there, and nowhere the suite runs.
    expect(declaration('.field--select', 'min-width')).toBe('0');
  });

  it('draws nothing around a focused field, the browser default included', () => {
    // Daniel's decision on the 2026-10-29 walk (E38/F01): a field shows its caret and nothing else,
    // by click or by Tab, so an accessibility pass must not put a ring back.
    for (const field of ['input:focus', 'textarea:focus', 'select:focus']) {
      expect(declaration(field, 'outline'), field).toBe('none');
      for (const property of ['box-shadow', 'border', 'border-color', 'background']) {
        expect(declaration(field, property), `${field} ${property}`).toBeNull();
      }
    }
    expect(blocks('.field:focus-visible')).toEqual([]);
    expect(blocks('.field:focus')).toEqual([]);
  });

  it('owns the add-row control, so five files stop owning a copy of it', () => {
    // `.add-container` was used by four plan cards and styled in none of them - where the plus
    // looked centred, it was centred by accident of a parent flex column. Beside it,
    // `.icon-add-round { width: 40px; height: 40px }` was declared identically in SIX files, one of
    // which never used the icon at all.
    expect(blocks('.add-row')).not.toHaveLength(0);
    expect(declaration('.add-row', 'align-items')).toBe('center');
    expect(declaration('.add-row', 'justify-content')).toBe('center');
  });

  it('sizes the add-row icon from its own type rather than a literal', () => {
    // A pixel here would be a sixth copy of the thing this primitive replaced, and it would break
    // the control-height contract above: that set is control heights, and an icon is not one.
    for (const property of ['width', 'height']) {
      expect(declaration('.add-row__icon', property)).toMatch(/em$/);
    }
  });

  it('is loaded by the app', () => {
    const main = readFileSync(join(SRC, 'assets/main.css'), 'utf8');
    expect(main).toContain("@import './primitives.css';");
  });
});
