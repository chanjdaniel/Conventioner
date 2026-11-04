import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath } from 'node:path';
import postcss from 'postcss';
import { parse } from 'vue/compiler-sfc';

/**
 * Every select in the app draws one look (F06 of the 2026-11-02 walk): `.field field--select`, whose
 * chevron is the app's own and which nothing else draws.
 *
 * Eight selects kept a class of their own and the browser's arrow, each written by someone who had
 * not read the primitive. No E2E can reach 50 selects cheaply, so the rule is held from the source,
 * as `modalsHoldThePageInert.test.ts` holds its own: a `<select>` in a template wears both classes,
 * and a select's other classes may size or place it but never draw it, since a scoped rule out-ranks
 * `.field--select`. Nor may any rule of its file that reaches it by `select` or `.field--select`.
 *
 * What it does NOT see, so that the next reader does not assume otherwise:
 *
 * - Only `.vue` files, and only a rule in the select's own file. A select drawn from a shared
 *   stylesheet, or from a parent's `:deep()`, is invisible here.
 * - A `:class` is read for its words, so a variable naming a class is not followed.
 * - A plain `.field` rule is not read, since it reaches a file's inputs too and may well set their
 *   padding, so a select can still be drawn over through it.
 */

// Resolved from the project root rather than `import.meta.url`, for the reason `contrast.test.ts`
// gives: vitest transforms this module, so its `import.meta.url` is not a file: URL.
const SRC = resolvePath(process.cwd(), 'src');

const DRAWS = /^(?:-webkit-|-moz-)?(?:padding|background|appearance)(?:-[a-z-]+)?$/;

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return vueFiles(full);
    return full.endsWith('.vue') ? [full] : [];
  });
}

/** As much of the template's tree as this reads; `compiler-sfc` does not export its types. */
type TemplateNode = {
  tag?: string;
  loc: { source: string };
  children?: TemplateNode[];
  props?: {
    name: string;
    value?: { content: string };
    arg?: { content?: string };
    exp?: { loc: { source: string } };
  }[];
};

/**
 * The `<select>` elements of a component's template, by Vue's own parser, so that a comment's, a
 * script's or a style's `<select>` is no control, and an attribute's `>` ends no tag.
 */
function selectsOf(source: string): TemplateNode[] {
  const walk = (node: TemplateNode): TemplateNode[] => [
    ...(node.tag === 'select' ? [node] : []),
    ...(node.children ?? []).flatMap(walk),
  ];
  const root = parse(source).descriptor.template?.ast as unknown as TemplateNode | undefined;
  return root ? walk(root) : [];
}

/**
 * Whether a selector's subject, what its last compound styles, is a select by its element or by its
 * primitive. An attribute's value, a `:not()` and a `:has()` name what is not styled, so none counts.
 */
function reachesASelect(selector: string): boolean {
  const subject = selector
    .replace(/\[[^\]]*\]/g, '')
    .replace(/:(?:not|has)\([^)]*\)/g, '')
    .trim()
    .split(/[\s>+~]+/)
    .pop();
  return /(?<![\w.#-])select(?![\w-])|\.field--select(?![\w-])/.test(subject ?? '');
}

/** What is wrong with each `<select>` of a single-file component's source, in words. */
function faultsOf(source: string): string[] {
  const rules = parse(source).descriptor.styles.flatMap((style) => {
    const found: { selector: string; properties: string[] }[] = [];
    postcss.parse(style.content).walkRules((rule) => {
      const properties = rule.nodes.flatMap((node) => (node.type === 'decl' ? [node.prop] : []));
      found.push(...rule.selectors.map((selector) => ({ selector, properties })));
    });
    return found;
  });

  const selects = selectsOf(source);

  // Whichever select it reaches: a rule naming the element or the primitive names no one of them.
  const drawnOver = selects.length
    ? rules
        .filter(({ selector }) => reachesASelect(selector))
        .flatMap(({ selector, properties }) =>
          properties
            .filter((p) => DRAWS.test(p))
            .map(
              (property) => `a rule of this file draws a select: "${selector}" sets ${property}`,
            ),
        )
    : [];

  const faultsOfEach = selects.flatMap((select) => {
    const attribute = (attr: string) =>
      select.props?.find((prop) => prop.name === attr)?.value?.content;
    const binding = select.props?.find(
      (prop) => prop.name === 'bind' && prop.arg?.content === 'class',
    );

    const name = attribute('data-testid') ?? select.loc.source.split('\n')[0];
    const worn = attribute('class')?.split(/\s+/) ?? [];
    const bound = binding?.exp?.loc.source.match(/[A-Za-z_][\w-]*/g) ?? [];

    const faults = ['field', 'field--select']
      .filter((primitive) => !worn.includes(primitive))
      .map((primitive) => `${name}: does not wear .${primitive}`);

    for (const own of [...worn, ...bound]) {
      if (own === 'field' || own === 'field--select') continue;
      const names = new RegExp(`\\.${own}(?![\\w-])`);
      for (const { selector, properties } of rules) {
        if (!names.test(selector)) continue;
        for (const property of properties.filter((p) => DRAWS.test(p))) {
          faults.push(`${name}: its class .${own} sets ${property} in "${selector}"`);
        }
      }
    }
    return faults;
  });
  return [...faultsOfEach, ...drawnOver];
}

describe('faultsOf, on a component written for it', () => {
  const sfc = (template: string, style = '') =>
    `<script setup lang="ts">\n// a <select> in a comment\n</script>\n<template>${template}</template>\n<style scoped>${style}</style>`;

  it('passes a select wearing the primitive, and a class that only sizes it', () => {
    const source = sfc(
      '<select class="field field--select narrow"></select>',
      '.narrow { max-width: 260px; height: 28px; }',
    );
    expect(faultsOf(source)).toEqual([]);
  });

  it('fails a select with neither class, and one with only one of them', () => {
    expect(faultsOf(sfc('<select class="dropdown"></select>'))).toHaveLength(2);
    expect(faultsOf(sfc('<select></select>'))).toHaveLength(2);
    expect(faultsOf(sfc('<select class="field"></select>'))).toEqual([
      expect.stringContaining('does not wear .field--select'),
    ]);
  });

  it('ignores a <select> in a template comment or in the script', () => {
    expect(faultsOf(sfc('<!-- the <select> below --><div></div>'))).toEqual([]);
    const inScript = `<script setup>const html = '<select class="dropdown"></select>'</script ><template><div></div></template>`;
    expect(faultsOf(inScript)).toEqual([]);
  });

  it('finds a select however deep it stands, behind a v-if or in a slot', () => {
    const source = sfc(
      '<div><template v-if="open"><AppDialog><select class="field"></select></AppDialog></template></div>',
    );
    expect(faultsOf(source)).toEqual([expect.stringContaining('does not wear .field--select')]);
  });

  for (const selector of ['.row:has(select)', '.row:has(> select)', '.row:has(.field--select)']) {
    it(`leaves alone "${selector}", which draws the row and not the select`, () => {
      const source = sfc(
        '<select class="field field--select"></select>',
        `${selector} { padding: 0; }`,
      );
      expect(faultsOf(source)).toEqual([]);
    });
  }

  it('still reads a select that a :has() narrows, which it does draw', () => {
    const source = sfc(
      '<select class="field field--select"></select>',
      'select:has(option:checked) { padding: 0; }',
    );
    expect(faultsOf(source)).toEqual([expect.stringContaining('sets padding')]);
  });

  it('reads a tag whose attribute holds a ">"', () => {
    const source = sfc(
      '<select @change="(e) => pick(e)" class="dropdown" data-testid="the-one"></select>',
    );
    expect(faultsOf(source)[0]).toContain('the-one');
  });

  for (const property of [
    'padding',
    'padding-right',
    'background',
    'background-color',
    'appearance',
    '-webkit-appearance',
  ]) {
    it(`fails an extra class whose rule sets ${property}`, () => {
      const source = sfc(
        '<select class="field field--select own"></select>',
        `.own { width: 100%; ${property}: x; }`,
      );
      expect(faultsOf(source)).toEqual([expect.stringContaining(`sets ${property}`)]);
    });
  }

  it('reads a bound class, a state and a compound selector', () => {
    const source = sfc(
      `<select class="field field--select" :class="{ error: bad }"></select>`,
      '.form .error:hover { background: red; }',
    );
    expect(faultsOf(source)).toEqual([expect.stringContaining('.error sets background')]);
  });

  it('leaves alone a rule of a class the select does not wear, and one that only names it longer', () => {
    const source = sfc(
      '<select class="field field--select own"></select>',
      '.other { padding: 0; } .own-label { padding: 0; }',
    );
    expect(faultsOf(source)).toEqual([]);
  });

  for (const selector of [
    '.wrapper .field--select',
    '.field--select:disabled',
    '.wrapper select',
    '.own select',
    'select.own-state',
    '.wrapper :deep(select)',
  ]) {
    it(`fails a rule that draws the select by its element or primitive: ${selector}`, () => {
      const source = sfc(
        '<div class="wrapper"><select class="field field--select"></select></div>',
        `${selector} { width: auto; background: none; padding: 0; appearance: auto; }`,
      );
      expect(faultsOf(source)).toEqual([
        expect.stringContaining('sets background'),
        expect.stringContaining('sets padding'),
        expect.stringContaining('sets appearance'),
      ]);
    });
  }

  it('reads each selector of a list apart, so a neighbour in it faults nothing', () => {
    const source = sfc(
      '<select class="field field--select"></select>',
      '.label, .wrapper select { padding: 0; }',
    );
    expect(faultsOf(source)).toEqual([expect.stringContaining('".wrapper select" sets padding')]);
    const neighbour = sfc(
      '<select class="field field--select"></select>',
      '.label, .wrapper select { width: auto; } .label { padding: 0; }',
    );
    expect(faultsOf(neighbour)).toEqual([]);
  });

  it('passes such a rule that only sizes or places the select', () => {
    const source = sfc(
      '<div class="pricing-currency"><select class="field field--select"></select></div>',
      '.pricing-currency .field--select { width: auto; margin-right: auto; } .field--select.error { border-color: red; }',
    );
    expect(faultsOf(source)).toEqual([]);
  });

  it('leaves alone a plain .field rule, which reaches inputs too, and a select it does not reach', () => {
    const source = sfc(
      '<select class="field field--select"></select>',
      '.wrapper .field { padding: 0; } .field--select-note { padding: 0; } .select { padding: 0; } select option { padding: 0; } [data-kind="select"] { padding: 0; } :not(select) { padding: 0; }',
    );
    expect(faultsOf(source)).toEqual([]);
  });

  it('reads such a rule only in a file with a select of its own', () => {
    expect(faultsOf(sfc('<div></div>', '.wrapper select { padding: 0; }'))).toEqual([]);
  });

  it('takes a rule out of a media query, and no comment for a rule', () => {
    const inMedia = sfc(
      '<select class="field field--select own"></select>',
      '@media (max-width: 1px) { .own { padding: 0; } }',
    );
    expect(faultsOf(inMedia)).toHaveLength(1);
    const inComment = sfc(
      '<select class="field field--select own"></select>',
      '/* .own { padding: 0; } */',
    );
    expect(faultsOf(inComment)).toEqual([]);
  });
});

describe('every select in the app', () => {
  it('wears the primitive, and its own classes never draw it', () => {
    const faults = vueFiles(SRC).flatMap((file) =>
      faultsOf(readFileSync(file, 'utf-8')).map((fault) => `${relative(SRC, file)}: ${fault}`),
    );
    expect(faults).toEqual([]);
  });

  it('finds the selects at all', () => {
    const count = vueFiles(SRC).reduce(
      (sum, file) => sum + selectsOf(readFileSync(file, 'utf-8')).length,
      0,
    );
    // A floor, so a broken reader cannot pass by seeing nothing; 50 when this was written.
    expect(count).toBeGreaterThan(40);
  });
});
