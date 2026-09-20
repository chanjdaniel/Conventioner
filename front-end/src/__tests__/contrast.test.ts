/**
 * The contrast contract.
 *
 * A token's NAME is its declaration. A token whose name says it carries text must reach WCAG AA
 * against the grounds it appears on; a token that only paints lines or fills is exempt. That is
 * the whole rule, and it lives here rather than in a sidecar map because a second artifact can
 * fall out of step with the CSS, and a name cannot fall out of step with itself.
 *
 * A lint rule was the alternative. It would have to infer which background each usage sits on,
 * which is the hard problem; naming makes that declarative instead.
 *
 * This parses the real `assets/base.css` rather than importing values from TypeScript, so the
 * file that ships is the file under test.
 *
 * Four text colours failed before this existed: `--mm-yellow` as text at 2.15, `--mm-grey` at
 * 1.67, `--mm-green` at 2.65, and a hardcoded `#2196F3` link at 3.12.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const AA_NORMAL = 4.5;

type Rgb = [number, number, number];

// Resolved from the project root rather than `import.meta.url`: vitest transforms this module,
// so its `import.meta.url` is not a file: URL and `fileURLToPath` refuses it.
const BASE_CSS = readFileSync(resolvePath(process.cwd(), 'src/assets/base.css'), 'utf8');

/**
 * Whether a token's value is a colour at all.
 *
 * `base.css` also holds the type, spacing, radius and elevation scale (E16/F02), and a contrast
 * contract has nothing to say about `12px`. Filtering on the VALUE rather than keeping a list of
 * non-colour names means a token added to the scale later needs no edit here, while a colour added
 * later still has to declare itself as ink or paint below - which is the whole point of that rule.
 */
function isColour(value: string): boolean {
  return /^(#|rgb|hsl)/i.test(value.trim());
}

function parseTokens(css: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  // Strip comments first: they quote old values ("was 2.65"), which would otherwise parse.
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, name, value] of withoutComments.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (isColour(value)) tokens[name] = value.trim();
  }
  return tokens;
}

function toRgb(value: string): Rgb | null {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = value.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+))?\s*\)$/i,
  );
  if (!rgba) return null;
  const [r, g, b] = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
  if (rgba[4] === undefined) return [r, g, b];
  // A translucent token is only meaningful over a ground, so callers composite it themselves.
  return [r, g, b];
}

function alphaOf(value: string): number {
  const m = value.match(/^rgba\([^)]*[,/]\s*([\d.]+)\s*\)$/i);
  return m ? Number(m[1]) : 1;
}

function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => Math.round(alpha * fg[i] + (1 - alpha) * bg[i])) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

const tokens = parseTokens(BASE_CSS);

function resolve(name: string): Rgb {
  const raw = tokens[name];
  if (raw === undefined) throw new Error(`${name} is not declared in base.css`);
  const rgb = toRgb(raw);
  if (!rgb) throw new Error(`${name} is "${raw}", which this test cannot read`);
  return rgb;
}

/** A token composited over the ground it is used on, so alpha is accounted for. */
function inkOn(name: string, ground: Rgb): Rgb {
  return over(resolve(name), alphaOf(tokens[name]), ground);
}

const WHITE: Rgb = [255, 255, 255];

describe('the palette carries a contrast contract', () => {
  const LIGHT_GROUNDS: Array<[string, Rgb]> = [
    ['white', WHITE],
    ['--mm-beige', resolve('--mm-beige')],
  ];

  // Names that declare "I am text on a light ground".
  const INK_ON_LIGHT = [
    '--mm-black',
    '--mm-text-muted',
    '--mm-text-yellow',
    '--mm-text-link',
    // Ink on a green TINT, and on white it is darker still - so white is the harder of its two
    // grounds to state here, and the tint pairing is measured by the rendered sweep.
    '--mm-text-green',
    // --mm-green is here AND in FILLS below: it reaches 4.5 both as ink on white and as a fill
    // under white text, so it is one colour doing both jobs. Asserting both directions is what
    // keeps that true.
    '--mm-green',
  ];

  for (const token of INK_ON_LIGHT) {
    for (const [groundName, ground] of LIGHT_GROUNDS) {
      // Beige is a card fill, not a page ground, and only --mm-black is ever set on it today.
      // Hold the rest to white only, and say so rather than silently skipping.
      if (groundName === '--mm-beige' && token !== '--mm-black') continue;
      it(`${token} is legible on ${groundName}`, () => {
        expect(contrast(inkOn(token, ground), ground)).toBeGreaterThanOrEqual(AA_NORMAL);
      });
    }
  }

  it('--mm-text-muted-on-dark is legible on --mm-black', () => {
    const ground = resolve('--mm-black');
    expect(contrast(inkOn('--mm-text-muted-on-dark', ground), ground)).toBeGreaterThanOrEqual(
      AA_NORMAL,
    );
  });

  it('--color-text is legible on --color-background, which is what body sets', () => {
    const ground = resolve('--color-background');
    expect(contrast(inkOn('--color-text', ground), ground)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  // Fills carry text too, and the reciprocal check is what forces a darker green rather than a
  // per-button judgement call. Each fill declares which ink it is legible under.
  const FILLS: Array<[string, 'white' | '--mm-black']> = [
    ['--mm-green', 'white'],
    ['--mm-yellow', '--mm-black'],
    ['--mm-beige', '--mm-black'],
    // Added by E16/F01, and declared as fills here on purpose. Three of the nine reds they retired
    // could not carry white text at all - #f44336, the Reject button, was 3.68 - and that went
    // unnoticed because a hardcoded colour has no name to hold to a contract.
    ['--mm-red', 'white'],
    ['--mm-blue', 'white'],
  ];

  for (const [fill, ink] of FILLS) {
    it(`${ink} is legible on the ${fill} fill`, () => {
      const inkRgb = ink === 'white' ? WHITE : resolve('--mm-black');
      expect(contrast(inkRgb, resolve(fill))).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  }

  it('white is never put on --mm-yellow, which is a black-text fill', () => {
    // Stated as a test so the reason survives: white on this yellow is 2.15, and someone will
    // eventually reach for it because every other fill in the product takes white.
    expect(contrast(WHITE, resolve('--mm-yellow'))).toBeLessThan(AA_NORMAL);
  });

  it('exempts only tokens that never carry text', () => {
    // If a token is added to base.css, it is either ink (and covered above) or paint (and listed
    // here). A name that is neither should fail this, which is the point.
    const known = new Set([
      ...INK_ON_LIGHT,
      '--mm-text-muted-on-dark',
      '--color-text',
      '--color-background',
      ...FILLS.map(([f]) => f),
      // Lines and hover states. These never sit under text.
      '--mm-border',
      '--hover-grey',
    ]);
    const unaccounted = Object.keys(tokens).filter((t) => !known.has(t));
    expect(unaccounted).toEqual([]);
  });
});
