/**
 * A refusal reads in red, whatever the card (T210, Daniel's answer 11): the Discord card's refusals
 * and Market Setup's failed plan save read in yellow, beside the Vendors row's red. Yellow is a
 * warning's.
 *
 * Read from the stylesheets that ship, as `primitives.test.ts` reads its own: happy-dom applies
 * none, so a mounted component would assert nothing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import postcss from 'postcss';
import { parse as parseSfc } from 'vue/compiler-sfc';

/** The last `color` the file's styles give `selector` in a rule of its own, outside any query. */
function colourOf(file: string, selector: string): string | null {
  const { descriptor } = parseSfc(readFileSync(resolvePath(process.cwd(), 'src', file), 'utf8'));
  let colour: string | null = null;
  for (const style of descriptor.styles) {
    postcss.parse(style.content).walkRules((rule) => {
      if (rule.parent?.type !== 'root' || !rule.selectors.includes(selector)) return;
      rule.walkDecls('color', (decl) => {
        colour = decl.value;
      });
    });
  }
  return colour;
}

describe('a refusal', () => {
  const red = colourOf('views/VendorsView.vue', '.error-text');

  it('reads in red on the Vendors row', () => {
    expect(red).toBe('var(--mm-red)');
  });

  it.each([
    ['the Discord card', 'components/market/MarketDiscordCard.vue', '.discord-error'],
    // The plan's status line (T271) draws a save that failed on the way and one the server refused.
    [
      "Market Setup's failed plan save",
      'components/market/PlanSaveStatus.vue',
      '.plan-save-status--failed',
    ],
    [
      "Market Setup's refused plan save",
      'components/market/PlanSaveStatus.vue',
      '.plan-save-status--refused',
    ],
  ])('reads in the same red on %s', (_where, file, selector) => {
    expect(colourOf(file, selector)).toBe(red);
  });
});
