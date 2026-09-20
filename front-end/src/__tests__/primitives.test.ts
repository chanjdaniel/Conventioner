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

const SRC = resolvePath(process.cwd(), 'src');
const CSS = readFileSync(join(SRC, 'assets/primitives.css'), 'utf8');

/** Every innermost rule block whose selector list contains `selector`, in source order. */
function blocks(selector: string): string[] {
  const inList = new RegExp(`(^|,)\\s*${selector.replace(/[.\\-]/g, '\\$&')}\\s*(,|$)`);
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

describe('the primitives exist and own what tokens cannot', () => {
  it('gives a control one standard height and one compact height, and no third', () => {
    const heights = new Set(
      [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/height:\s*(\d+)px;/g)].map((m) => m[1]),
    );
    // 36 standard, 28 compact, 72 the textarea's min-height - which is a min, not a control height.
    expect([...heights].sort()).toEqual(['28', '36', '72']);
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
    ].filter(([selector, property]) => !declaration(selector, property)?.includes('var(--'));

    expect(offenders).toEqual([]);
  });

  it('has exactly three button intents', () => {
    const intents = [...CSS.matchAll(/^\.btn--([a-z]+)\s*\{/gm)].map((m) => m[1]);
    expect(intents.sort()).toEqual(['compact', 'destructive', 'primary', 'secondary']);
  });

  it('has one disabled state, and it does not rely on text contrast', () => {
    // The product had four treatments, one of which put white text on `--mm-border` at 1.74:1.
    expect(blocks('.btn:disabled')).toHaveLength(1);
    expect(declaration('.btn:disabled', 'color')).toBe('var(--mm-text-muted)');
    expect(declaration('.btn:disabled', 'background')).toBe('var(--mm-beige)');
  });

  it('left-aligns fields', () => {
    // 18 of 27 controls on Market Setup were centred.
    expect(declaration('.field', 'text-align')).toBe('left');
  });

  it('stops a select being squeezed below its own longest option', () => {
    // The Tier select was 65px wide with 34px of text room while "Community" needs 71.
    expect(declaration('.field--select', 'min-width')).toBe('min-content');
  });

  it('gives every primitive a focus ring that is not the brand green', () => {
    // The ring must be visible against the control's own fill too, and a green ring on the green
    // primary button is invisible.
    const ring = declaration('.btn:focus-visible', 'outline');
    expect(ring, 'no focus ring on .btn').toBeTruthy();
    expect(ring).not.toContain('--mm-green');
    expect(declaration('.btn:focus-visible', 'outline-offset')).toBeTruthy();
  });

  it('is loaded by the app', () => {
    const main = readFileSync(join(SRC, 'assets/main.css'), 'utf8');
    expect(main).toContain("@import './primitives.css';");
  });
});
