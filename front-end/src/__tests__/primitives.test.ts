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
import { parse as parseSfc } from 'vue/compiler-sfc';

const SRC = resolvePath(process.cwd(), 'src');
const PRIMITIVES = postcss.parse(readFileSync(join(SRC, 'assets/primitives.css'), 'utf8'));
const BASE = postcss.parse(readFileSync(join(SRC, 'assets/base.css'), 'utf8'));
const MAIN = postcss.parse(readFileSync(join(SRC, 'assets/main.css'), 'utf8'));

/** Every rule in `container`, at any depth, whose selector list holds `selector`, in source order. */
function rulesWith(container: postcss.Container, selector: string): postcss.Rule[] {
  const found: postcss.Rule[] = [];
  container.walkRules((rule) => {
    if (rule.selectors.includes(selector)) found.push(rule);
  });
  return found;
}

/** The value `rule` gives `property` itself, the last one winning, or null. */
function ownValue(rule: postcss.Rule, property: string): string | null {
  let value: string | null = null;
  for (const node of rule.nodes) {
    if (node.type === 'decl' && node.prop === property) value = node.value;
  }
  return value;
}

/** The value of `property` in the first rule whose selector list holds `selector` and sets it. */
function declaration(
  container: postcss.Container | null,
  selector: string,
  property: string,
): string | null {
  if (!container) return null;
  for (const rule of rulesWith(container, selector)) {
    const value = ownValue(rule, property);
    if (value !== null) return value;
  }
  return null;
}

/** The media rule holding a `:root` rule that sets `--control-height`, whatever its query says. */
function phoneOverride(root: postcss.Root): postcss.AtRule | null {
  for (const rule of rulesWith(root, ':root')) {
    const parent = rule.parent;
    if (parent?.type === 'atrule' && (parent as postcss.AtRule).name === 'media') {
      if (ownValue(rule, '--control-height') !== null) return parent as postcss.AtRule;
    }
  }
  return null;
}

describe('the primitives exist and own what tokens cannot', () => {
  it('gives a control one standard height and one compact height, and no third', () => {
    // The two heights are tokens, so a phone can raise both to a thumb's target in one place.
    expect(declaration(PRIMITIVES, '.btn', 'height')).toBe('var(--control-height)');
    expect(declaration(PRIMITIVES, '.field', 'height')).toBe('var(--control-height)');
    expect(declaration(PRIMITIVES, '.add-row', 'height')).toBe('var(--control-height)');
    expect(declaration(PRIMITIVES, '.btn--compact', 'height')).toBe(
      'var(--control-height-compact)',
    );
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
    expect(declaration(BASE, ':root', '--control-height')).toBe('36px');
    expect(declaration(BASE, ':root', '--control-height-compact')).toBe('28px');
    expect(declaration(BASE, ':root', '--target-min')).toBe('24px');

    const phone = phoneOverride(BASE);
    expect(declaration(phone, ':root', '--control-height')).toBe('44px');
    expect(declaration(phone, ':root', '--control-height-compact')).toBe('44px');
    expect(declaration(phone, ':root', '--target-min')).toBe('44px');
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
      ['.chip--small', 'padding'],
      ['.chip--small', 'border-radius'],
      ['.data-table', 'font-size'],
      ['.data-table :is(th, td)', 'padding'],
      ['.data-table thead th', 'font-size'],
      ['.data-table-scroll', 'border-radius'],
      ['.add-row', 'padding'],
      ['.add-row', 'border-radius'],
      ['.add-row', 'font-size'],
      ['.add-row', 'gap'],
    ].filter(
      ([selector, property]) => !declaration(PRIMITIVES, selector, property)?.includes('var(--'),
    );

    expect(offenders).toEqual([]);
  });

  it('has exactly three button intents', () => {
    // A modifier on its own, at the top level: `.btn--secondary.btn--destructive` is a weight.
    const intents = PRIMITIVES.nodes
      .flatMap((node) => (node.type === 'rule' ? node.selectors : []))
      .filter((selector) => /^\.btn--[a-z]+$/.test(selector))
      .map((selector) => selector.slice('.btn--'.length));
    expect(intents.sort()).toEqual(['compact', 'destructive', 'primary', 'secondary']);
  });

  it("gives a row's destructive action the secondary weight, in the destructive ink", () => {
    // Not a fourth intent: destructive at secondary weight, so a list of people is not a column of
    // filled red buttons (E38/F15/S01). Its ink is `--mm-red` on white, 5.44:1 (`contrast.test.ts`).
    const quiet = '.btn--secondary.btn--destructive';
    expect(declaration(PRIMITIVES, quiet, 'background')).toBe('white');
    expect(declaration(PRIMITIVES, quiet, 'color')).toBe('var(--mm-red)');
    expect(declaration(PRIMITIVES, quiet, 'border-color')).toBe(
      declaration(PRIMITIVES, '.btn--secondary', 'border-color'),
    );
    expect(declaration(PRIMITIVES, quiet, 'font-weight')).toBe('400');
  });

  it('marks a pressed toggle with the positive tint and its measured ink', () => {
    // A state, not an intent: the phase filter's toggles stay secondary buttons when pressed.
    expect(declaration(PRIMITIVES, ".btn[aria-pressed='true']", 'color')).toBe(
      'var(--mm-text-green)',
    );
    expect(declaration(PRIMITIVES, ".btn[aria-pressed='true']", 'background')).toBe(
      declaration(PRIMITIVES, '.chip--positive', 'background'),
    );
  });

  it('has one disabled state, and it does not rely on text contrast', () => {
    // The product had four treatments, one of which put white text on `--mm-border` at 1.74:1.
    expect(rulesWith(PRIMITIVES, '.btn:disabled')).toHaveLength(1);
    expect(declaration(PRIMITIVES, '.btn:disabled', 'color')).toBe('var(--mm-text-muted-on-beige)');
    expect(declaration(PRIMITIVES, '.btn:disabled', 'background')).toBe('var(--mm-beige)');
  });

  it('left-aligns fields', () => {
    // 18 of 27 controls on Market Setup were centred.
    expect(declaration(PRIMITIVES, '.field', 'text-align')).toBe('left');
  });

  it('keeps a select inside its column, whatever its options say', () => {
    // `min-content` is the widest option in Firefox alone, so a select of questions or answers
    // ran out of its column and under the next one there, and nowhere the suite runs.
    expect(declaration(PRIMITIVES, '.field--select', 'min-width')).toBe('0');
  });

  it("draws a select's chevron itself, from a file, and leaves room for it", () => {
    // Daniel's F06: the browser's arrow sat about 5px from the right edge with the text about 17px
    // from the left. A `data:` image would be refused by `img-src 'self' blob:` once the policy
    // enforces, so it is a file from `public/`, whose absolute URL Vite leaves alone.
    expect(declaration(PRIMITIVES, '.field--select', 'appearance')).toBe('none');
    expect(declaration(PRIMITIVES, '.field--select', 'padding-right')).toBe(
      'calc(var(--space-3) + var(--space-3) + var(--space-3))',
    );
    expect(declaration(PRIMITIVES, '.field--select', 'background-image')).toBe(
      "url('/icons/select-chevron.svg')",
    );
    expect(declaration(PRIMITIVES, '.field--select', 'background-repeat')).toBe('no-repeat');
    expect(declaration(PRIMITIVES, '.field--select', 'background-position')).toBe(
      'right var(--space-3) center',
    );
    expect(declaration(PRIMITIVES, '.field--select', 'background-size')).toBe(
      'var(--space-3) var(--space-2)',
    );
    expect(declaration(PRIMITIVES, '.field--select', 'text-overflow')).toBe('ellipsis');
  });

  it('keeps a disabled select its chevron, muted, in the one disabled state', () => {
    expect(declaration(PRIMITIVES, '.field--select:disabled', 'background-image')).toBe(
      "url('/icons/select-chevron-disabled.svg')",
    );
    // Chromium's own sheet fades a disabled `appearance: none` select to 0.7.
    expect(declaration(PRIMITIVES, '.field--select:disabled', 'opacity')).toBe('1');
    // The shorthand out-ranks `.field--select` and would reset the image, its position and size.
    expect(declaration(PRIMITIVES, '.field:disabled', 'background-color')).toBe('var(--mm-beige)');
    expect(declaration(PRIMITIVES, '.field:disabled', 'background')).toBeNull();
  });

  it("keeps the browser's own arrow in forced colours", () => {
    // The file's dark stroke would vanish on a dark forced canvas.
    let forced: postcss.AtRule | null = null;
    PRIMITIVES.walkAtRules('media', (atRule) => {
      if (atRule.params === '(forced-colors: active)') forced = atRule;
    });
    expect(declaration(forced, '.field--select', 'appearance')).toBe('auto');
    expect(declaration(forced, '.field--select', 'background-image')).toBe('none');
    expect(declaration(forced, '.field--select', 'padding-right')).toBe('var(--space-3)');
    // A disabled select's own image out-ranks a rule on `.field--select` alone.
    expect(declaration(forced, '.field--select:disabled', 'background-image')).toBe('none');
  });

  it("draws the chevron's two files in the tokens' own ink", () => {
    // A file cannot read a `var()`, so its colours are the tokens' values, held here.
    const file = (name: string) =>
      readFileSync(resolvePath(process.cwd(), 'public/icons', name), 'utf8');
    const attribute = (svg: string, name: string) =>
      new RegExp(`\\s${name}="([^"]+)"`).exec(svg)?.[1] ?? null;
    const black = declaration(BASE, ':root', '--mm-black');
    const muted = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(
      declaration(BASE, ':root', '--mm-text-muted-on-beige') ?? '',
    );
    const blackAsRgb = [1, 3, 5].map((at) => parseInt(black!.slice(at, at + 2), 16).toString());
    expect(muted?.slice(1, 4)).toEqual(blackAsRgb);

    const enabled = file('select-chevron.svg');
    expect(attribute(enabled, 'stroke')).toBe(black);
    expect(attribute(enabled, 'stroke-opacity')).toBeNull();

    const disabled = file('select-chevron-disabled.svg');
    expect(attribute(disabled, 'stroke')).toBe(black);
    expect(attribute(disabled, 'stroke-opacity')).toBe(muted?.[4]);
  });

  it('draws nothing around a focused field, the browser default included', () => {
    // Daniel's decision on the 2026-10-29 walk (E38/F01): a field shows its caret and nothing else,
    // by click or by Tab, so an accessibility pass must not put a ring back.
    for (const field of ['input:focus', 'textarea:focus', 'select:focus']) {
      expect(declaration(PRIMITIVES, field, 'outline'), field).toBe('none');
      for (const property of ['box-shadow', 'border', 'border-color', 'background']) {
        expect(declaration(PRIMITIVES, field, property), `${field} ${property}`).toBeNull();
      }
    }
    expect(rulesWith(PRIMITIVES, '.field:focus-visible')).toEqual([]);
    expect(rulesWith(PRIMITIVES, '.field:focus')).toEqual([]);
  });

  it('draws a green border on a focused button, taking no room', () => {
    // Daniel's word on 2026-11-04: "green border instead of the thick green ring". An outline inside
    // the edge, so focus moves nothing and it lies over the button's own border.
    expect(declaration(BASE, ':root', '--focus-border-width')).toBe('2px');
    expect(declaration(BASE, ':root', '--focus-border')).toBe('var(--mm-green)');
    expect(declaration(BASE, ':root', '--focus-border-offset')).toBe(
      'calc(-1 * var(--focus-border-width))',
    );
    const buttons = [
      '.btn:focus-visible',
      '.add-row:focus-visible',
      '.drag-handle:focus-visible',
      '.step-button:focus-visible',
      'button:focus-visible',
      "[role='button']:focus-visible",
    ];
    for (const button of buttons) {
      expect(declaration(PRIMITIVES, button, 'outline'), button).toBe(
        'var(--focus-border-width) solid var(--focus-border)',
      );
      expect(declaration(PRIMITIVES, button, 'outline-offset'), button).toBe(
        'var(--focus-border-offset)',
      );
      expect(declaration(PRIMITIVES, button, 'box-shadow'), button).toBeNull();
    }
  });

  it('takes the deep green where the plain green would not show', () => {
    for (const button of ['.btn--primary', '.btn--destructive', ".btn[aria-pressed='true']"]) {
      expect(declaration(PRIMITIVES, button, '--focus-border'), button).toBe(
        'var(--focus-border-on-fill)',
      );
    }
    // A row's destructive action is red ink on white, where the plain green shows.
    expect(declaration(PRIMITIVES, '.btn--secondary.btn--destructive', '--focus-border')).toBe(
      'var(--mm-green)',
    );
  });

  it('gives every other control the soft halo rather than a ring', () => {
    // Daniel's choice C on the 2026-10-29 walk: a white gap then a translucent green glow. The dark
    // bar's halo is white. A link drawn as a `.btn` is a button.
    expect(declaration(BASE, ':root', '--focus-halo')).toBe(
      '0 0 0 2px white, 0 0 0 5px rgba(54, 130, 111, 0.35)',
    );
    expect(declaration(BASE, ':root', '--focus-halo-on-dark')).toBe(
      '0 0 0 3px rgba(255, 255, 255, 0.35)',
    );
    const controls = [
      'a:not(.btn):focus-visible',
      'summary:focus-visible',
      // The phase rail's spine, a keyboard stop while it scrolls, has no rule of its own.
      "[tabindex='0']:not(.btn, button, [role='button']):focus-visible",
    ];
    for (const control of controls) {
      expect(declaration(PRIMITIVES, control, 'box-shadow'), control).toBe('var(--focus-halo)');
      expect(declaration(PRIMITIVES, control, 'outline'), control).toBe('none');
    }
  });

  it('owns the add-row control, so five files stop owning a copy of it', () => {
    // `.add-container` was used by four plan cards and styled in none of them - where the plus
    // looked centred, it was centred by accident of a parent flex column. Beside it,
    // `.icon-add-round { width: 40px; height: 40px }` was declared identically in SIX files, one of
    // which never used the icon at all.
    expect(rulesWith(PRIMITIVES, '.add-row')).not.toHaveLength(0);
    expect(declaration(PRIMITIVES, '.add-row', 'align-items')).toBe('center');
    expect(declaration(PRIMITIVES, '.add-row', 'justify-content')).toBe('center');
  });

  it('sizes the add-row icon from its own type rather than a literal', () => {
    // A pixel here would be a sixth copy of the thing this primitive replaced, and it would break
    // the control-height contract above: that set is control heights, and an icon is not one.
    for (const property of ['width', 'height']) {
      expect(declaration(PRIMITIVES, '.add-row__icon', property)).toMatch(/em$/);
    }
  });

  it('makes a link on a line of its own a target, in the link ink', () => {
    // WCAG 2.5.8's floor at a desk and a thumb's 44px on a phone, both from the one token, as a
    // line box with no padding so the link still sits on its text (T79).
    expect(declaration(PRIMITIVES, '.link-alone', 'display')).toBe('inline-flex');
    expect(declaration(PRIMITIVES, '.link-alone', 'align-items')).toBe('center');
    expect(declaration(PRIMITIVES, '.link-alone', 'min-height')).toBe('var(--target-min)');
    expect(declaration(PRIMITIVES, '.link-alone', 'padding')).toBeNull();
    expect(declaration(PRIMITIVES, '.link-alone', 'color')).toBe('var(--mm-text-link)');
    expect(declaration(PRIMITIVES, '.link-alone', 'font-size')).toBe('var(--text-sm)');
    expect(declaration(PRIMITIVES, '.link-alone', 'text-decoration')).toBe('none');
    expect(declaration(PRIMITIVES, '.link-alone:hover', 'text-decoration')).toBe('underline');
  });

  it('owns the link on a line of its own, so the sign-in pages stop owning a copy of it', () => {
    // The class `.link` or `.link-alone` in a selector, and not a longer name that starts so.
    const NAMES_A_LINK_CLASS = /\.link(-alone)?(?![\w-])/;
    // Four views each declared the same `.link` rule (T82 note 5).
    const views = [
      'EmailVerificationView',
      'LoginView',
      'PasswordResetRequestView',
      'PasswordResetView',
    ];
    for (const view of views) {
      const { descriptor } = parseSfc(readFileSync(join(SRC, `views/${view}.vue`), 'utf8'));
      for (const style of descriptor.styles) {
        // Any rule naming either class counts, whatever else its selector says: `.link:hover`,
        // `.form-links .link-alone` and `a.link` are copies too.
        const copies: string[] = [];
        postcss.parse(style.content).walkRules((rule) => {
          if (rule.selectors.some((selector) => NAMES_A_LINK_CLASS.test(selector))) {
            copies.push(rule.selector);
          }
        });
        expect(copies, view).toEqual([]);
      }
      expect(descriptor.template?.content, view).toContain('class="link-alone"');
    }
  });

  it("eases a link's colour alone, so its focus halo appears at once", () => {
    // `transition: 0.4s` eased every property, so a link's halo rounded its corners and faded in
    // over 0.4s where a button's appears at once (T181).
    expect(declaration(MAIN, 'a', 'transition')).toBe('color 0.4s');
  });

  it('is loaded by the app', () => {
    const imports: string[] = [];
    MAIN.walkAtRules('import', (atRule) => {
      imports.push(atRule.params);
    });
    expect(imports).toContain("'./primitives.css'");
  });
});
