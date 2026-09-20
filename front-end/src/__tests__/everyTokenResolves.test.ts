/**
 * A `var(--x)` that resolves to nothing fails silently and catastrophically (E16/F01/S05).
 *
 * `--mm-text-red` was referenced in seven rules and defined in none. It is not a raw value a linter
 * would object to - it is a well-formed reference to nothing - and CSS handles that by making the
 * declaration invalid at computed-value time. Each of the seven failed differently and none of them
 * failed loudly:
 *
 *   - `background: var(--mm-text-red)` reset to its initial value, transparent;
 *   - `border: 1px solid var(--mm-text-red)` dropped the whole shorthand, so 0px;
 *   - `color: var(--mm-text-red)` is inherited, so it silently took the page's own colour.
 *
 * Together, on `.confirm-archive-button`, that rendered white text on a white dialog with no
 * border: the button that permanently archives a market, invisible, under the words "This action
 * cannot be undone."
 *
 * The sibling `--mm-red` was undefined too, but its 24 usages all carried
 * `var(--mm-red, #cc0000)` - so they rendered, nobody noticed, and a fallback literal quietly
 * became the most-used red in the product.
 *
 * Hence two rules, not one: every reference resolves, and no reference carries a fallback. A
 * fallback on a defined token is a second definition waiting to drift; on an undefined one it is
 * what hides the bug.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath } from 'node:path';

const SRC = resolvePath(process.cwd(), 'src');
const GLOBAL_CSS = ['assets/base.css', 'assets/main.css']
  .map((file) => readFileSync(join(SRC, file), 'utf8'))
  .join('\n');

/**
 * Properties this repo defines outside `base.css`, with where and why.
 *
 * Kept as a named list rather than scanning every file for definitions: a token defined next to its
 * only use is a local variable, and one defined in a component but used across the product is the
 * bug this test exists to catch. Naming them makes the difference explicit.
 */
const LOCALLY_DEFINED = new Set(['--priority-columns', '--section-columns']);

/**
 * PrimeVue's own theme tokens, defined by the library's stylesheet at runtime.
 *
 * Matched by prefix rather than listed: the set is the library's to change, and a list of them
 * here would be a second copy of someone else's palette. What this test owns is `--mm-*`.
 */
const LIBRARY_PREFIX = /^--p-/;

function sourceFiles(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full, extensions);
    return extensions.some((e) => entry.endsWith(e)) ? [full] : [];
  });
}

function definedProperties(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
}

interface Reference {
  name: string;
  file: string;
  hasFallback: boolean;
}

function references(): Reference[] {
  const found: Reference[] = [];
  for (const file of sourceFiles(SRC, ['.css', '.vue'])) {
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of source.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,)?/g)) {
      found.push({ name: match[1], file: relative(SRC, file), hasFallback: Boolean(match[2]) });
    }
  }
  return found;
}

describe('every custom property a rule reads is a property something defines', () => {
  it('resolves every reference', () => {
    const defined = definedProperties(GLOBAL_CSS);
    const dangling = references()
      .filter(
        (r) => !defined.has(r.name) && !LOCALLY_DEFINED.has(r.name) && !LIBRARY_PREFIX.test(r.name),
      )
      .map((r) => `${r.file} reads ${r.name}`);

    expect([...new Set(dangling)].sort()).toEqual([]);
  });

  it('carries no fallbacks', () => {
    // `var(--mm-red, #cc0000)` is how an undefined token rendered for months without anyone
    // noticing, and how `#cc0000` became the product's most-used red without being chosen.
    const withFallback = references()
      // A library token legitimately takes one: it is defined by someone else's stylesheet, and
      // the fallback is what renders before that stylesheet arrives. `--mm-*` is ours, and ours
      // are defined in `base.css` unconditionally.
      .filter((r) => r.hasFallback && !LIBRARY_PREFIX.test(r.name))
      .map((r) => `${r.file} falls back on ${r.name}`);

    expect([...new Set(withFallback)].sort()).toEqual([]);
  });
});

describe('the scale exists as tokens', () => {
  // E16/F02 is additive: the tokens land and nothing migrates yet. This is what stops the
  // statement in `docs/design-system.md` and the file that ships from drifting apart while the
  // four slice features work through 1150 stylelint warnings.
  const SCALE = [
    '--text-xs',
    '--text-sm',
    '--text-md',
    '--text-lg',
    '--text-xl',
    '--text-2xl',
    '--space-1',
    '--space-2',
    '--space-3',
    '--space-4',
    '--space-6',
    '--space-8',
    '--space-12',
    '--space-hairline',
    '--radius-control',
    '--radius-card',
    '--radius-pill',
    '--shadow-card',
  ];

  it('defines every step the design language names', () => {
    const defined = definedProperties(GLOBAL_CSS);
    expect(SCALE.filter((token) => !defined.has(token))).toEqual([]);
  });
});
