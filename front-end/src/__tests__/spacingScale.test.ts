// @vitest-environment node
/**
 * The spacing scale's lint rule (T81).
 *
 * `docs/design-system.md` said the spacing migration was done while `src` still declared raw 10px,
 * 6px and 5px well over a hundred times: nothing refused one. `.stylelintrc.json` now holds every
 * margin, padding and gap to the `--space-*` tokens, and this test runs the real config through
 * Stylelint, so the allowed values and the warning/error split are asserted against the file that
 * `npm run lint:css` reads.
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
    configFile: resolvePath(process.cwd(), '.stylelintrc.json'),
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
    'padding-bottom: calc(2 * var(--space-12))',
    'padding-left: var(--space-6) !important',
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
