// @vitest-environment node
/**
 * The spacing scale's lint rule (T81).
 *
 * `docs/design-system.md` said the spacing migration was done while `src` still declared raw 10px,
 * 6px and 5px well over a hundred times: nothing refused one. `stylelint.config.js` now holds
 * every margin, padding and gap to the `--space-*` tokens, and this test runs the real config
 * through Stylelint, so the allowed values and the warning/error split are asserted against the
 * file that `npm run lint:css` reads.
 *
 * T81's review found the rule's edges (T82): any bare number passed inside `calc()`, `auto` passed
 * on a padding or a gap, values ran together with no space between them, and the values a phone's
 * safe area needs were refused.
 */
import { describe, expect, it } from 'vitest';
import { resolve as resolvePath } from 'node:path';
import stylelint from 'stylelint';

const RULE = 'declaration-property-value-allowed-list';
const MIGRATED = 'src/views/LoginView.vue';
const BETA = 'src/components/floorplan/SaveFlow.vue';

async function spacingFindings(file: string, declaration: string) {
  const { results } = await stylelint.lint({
    code: `<template><p /></template>\n<style scoped>\n.x {\n  ${declaration};\n}\n</style>\n`,
    codeFilename: resolvePath(process.cwd(), file),
    configFile: resolvePath(process.cwd(), 'stylelint.config.js'),
  });
  return results[0].warnings.filter((w) => w.rule === RULE);
}

describe('margins, paddings and gaps keep to the spacing scale', () => {
  it.each([
    'margin: 0',
    'margin: 0 auto',
    'padding: var(--space-2) var(--space-4)',
    'padding: var(--space-hairline) var(--space-2)',
    'margin-top: var(--space-12)',
    'padding-inline: var(--space-6)',
    'gap: var(--card-grid-gap)',
    'row-gap: var(--space-1)',
    'column-gap: var(--space-3)',
    'margin-top: var(--banner-h)',
    'margin: 0 0 0 calc(-1 * var(--space-2))',
    'padding-bottom: calc(var(--space-12) + var(--space-12))',
    'margin-top: calc(var(--banner-h) + var(--space-4))',
    'padding-left: var(--space-6) !important',
    // The CSS-wide keywords, as the whole value.
    'margin: inherit',
    'padding: initial',
    'gap: unset',
    'margin-top: revert',
    // A phone's safe area, alone, added to a token, or as the larger of the two.
    'padding-bottom: env(safe-area-inset-bottom)',
    'padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom))',
    'padding-left: max(var(--space-4), env(safe-area-inset-left))',
    'padding: 0 max(var(--space-4), env(safe-area-inset-right, 0))',
    'margin-top: min(var(--space-8), var(--space-12))',
    'gap: clamp(var(--space-2), var(--space-4), var(--space-6))',
    // A percentage padding, which keeps a box's proportions as it scales.
    'padding-top: 56.25%',
  ])('allows %s', async (declaration) => {
    expect(await spacingFindings(MIGRATED, declaration)).toEqual([]);
  });

  it.each([
    'padding: 10px',
    'padding: 8px',
    'margin: 0px',
    'margin-bottom: 1rem',
    'margin-bottom: -1px',
    'gap: 6px var(--space-2)',
    'column-gap: 20px',
    'padding: var(--space-5)',
    'margin: calc(100% - 8px)',
    // A bare number inside calc() is a raw size, or no size at all.
    'padding: calc(var(--space-1) * 1.5)',
    'margin: calc(0.5 * var(--space-1))',
    'gap: calc(var(--space-2) + 3)',
    'margin-top: calc(2 * var(--space-12))',
    'margin: calc(-2 * var(--space-2))',
    // `auto` is a margin's, and invalid on a padding or a gap.
    'padding: auto',
    'padding-left: auto',
    'gap: auto',
    'row-gap: auto',
    // Values run together.
    'margin: 0auto',
    'padding: var(--space-2)var(--space-4)',
    // A keyword is the whole value, a percentage is a padding's, and only the safe area is env().
    'margin: 0 inherit',
    'margin-top: 10%',
    'gap: 5%',
    'padding-top: env(keyboard-inset-height)',
    'padding-left: max(var(--space-4), 10px)',
  ])('refuses %s', async (declaration) => {
    expect(await spacingFindings(MIGRATED, declaration)).toHaveLength(1);
  });

  it('errors in a migrated file and warns in one off the list', async () => {
    const [migrated] = await spacingFindings(MIGRATED, 'padding: 10px');
    const [beta] = await spacingFindings(BETA, 'padding: 10px');

    expect(migrated.severity).toBe('error');
    expect(beta.severity).toBe('warning');
    expect(beta.text).toContain('--space-*');
  });
});
