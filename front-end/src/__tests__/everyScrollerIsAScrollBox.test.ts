import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath } from 'node:path';
import postcss from 'postcss';
import { parse } from 'vue/compiler-sfc';

/**
 * Every in-app scroller is a `ScrollBox`, and only the base stylesheet says anything of a bar (T217).
 *
 * A bar drawn over a dialog's list squared its corners and cut its buttons, and bars across the app
 * were drawn in several ways, each by someone who had not read the rule. So the rule is held from
 * the source, as `modalsHoldThePageInert.test.ts` holds its own: a rule that lets a box scroll, or
 * that speaks of a bar, may stand only in `ScrollBox` and `base.css`.
 *
 * What it does NOT see, so that the next reader does not assume otherwise:
 *
 * - A `:style` binding, or a style set from a script: only what is written as CSS, in a `<style>`,
 *   a `.css` file or a static `style` attribute. The layout sweep's `scroller-without-a-shade`
 *   measures what really scrolls in a browser, and sees those.
 */

// Resolved from the project root rather than `import.meta.url`, for the reason `contrast.test.ts`
// gives: vitest transforms this module, so its `import.meta.url` is not a file: URL.
const SRC = resolvePath(process.cwd(), 'src');

/** The one component that owns a scroller, and the stylesheet holding the one rule on bars. */
const OWNERS = ['components/ScrollBox.vue', 'assets/base.css'];

/**
 * What is not yet converted, as `<file> <selector>`, and it falls on purpose: a conversion takes its
 * line out, since the last test below fails on a line that no longer holds, and the list ends empty.
 * What must never happen is a line added to it: a new scroller is a `ScrollBox`.
 */
const NOT_YET_CONVERTED = [
  // Panes and drawers (ticket 03).
  'components/VendorDrawer.vue .detail-content',
  'components/SidePanel.vue .side-panel__body',
  'components/DoorCodeScreen.vue .door-code',
  'components/elements/ElementTierSetup.vue .sorting-order-container',
  'dev/library/entries/FoldsEntry.vue .library-today-box',
  // Rules that never scrolled, to be deleted (ticket 03).
  'components/elements/ElementSectionSetup.vue .rows',
  'components/elements/ElementTierSetup.vue .rows',
  'components/elements/ElementLocationSetup.vue .rows',
  'components/elements/ElementTierSetup.vue h4',
  'components/elements/ElementSettingContainer.vue .setting-body',
  'components/market/MarketAssignmentTab.vue .settings-body-stacked',
  'components/market/MarketApplicationsTab.vue .settings-body.settings-body-stacked',
  'views/MarketSetupView.vue .settings-body-stacked',
  'views/OrganizationsView.vue .content-block',
  // The floorplan (ticket 04).
  'components/floorplan/FloorplanWorkflow.vue .step-body',
  'components/floorplan/FloorplanWorkflow.vue .step-place',
  'components/floorplan/FloorplanWorkflow.vue .step-save',
  'components/floorplan/SaveFlow.vue .save-dialog-body',
  'components/floorplan/SectionGrouping.vue .sg-panel',
  'components/floorplan/SectionGrouping.vue .sg-dialog',
  // Sideways strips and tables (ticket 05).
  'components/MarketBar.vue .market-bar-tabs',
  'components/PhaseRail.vue .phase-spine',
  'components/MarketPages.vue .market-fits-a-phone .market-pages',
  'components/elements/ElementPricing.vue .pricing-frame',
  'assets/primitives.css .data-table-scroll',
  // Export vendors (ticket 11).
  'components/ExportVendorsDialog.vue .export-table-scroll',
  // The pickers (ticket 16).
  'components/SearchPicker.vue .search-picker-list',
  'components/market/ReviewerPicker.vue .reviewer-picker-list',
];

const LETS_IT_SCROLL = /\b(?:auto|scroll)\b/;

/** Whether a declaration lets its box scroll, or speaks of a bar. */
function speaksOfScrolling(prop: string, value: string): boolean {
  return (
    prop.startsWith('scrollbar-') ||
    (/^overflow(?:-[a-z]+)?$/.test(prop) && LETS_IT_SCROLL.test(value))
  );
}

function fromStylesheet(css: string): string[] {
  const found: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    const drawsABar = rule.selector.includes('::-webkit-scrollbar');
    const scrolls = rule.nodes.some(
      (node) => node.type === 'decl' && speaksOfScrolling(node.prop, node.value),
    );
    if (drawsABar || scrolls) found.push(rule.selector);
  });
  return found;
}

/** As much of the template's tree as this reads; `compiler-sfc` does not export its types. */
type TemplateNode = {
  tag?: string;
  children?: TemplateNode[];
  props?: { name: string; value?: { content: string } }[];
};

/** The tag of each element whose static `style` attribute lets it scroll. */
function fromTemplate(root: TemplateNode): string[] {
  const own = (root.props ?? []).some((prop) => {
    if (prop.name !== 'style' || !prop.value) return false;
    let found = false;
    postcss.parse(prop.value.content).walkDecls((decl) => {
      found ||= speaksOfScrolling(decl.prop, decl.value);
    });
    return found;
  });
  return [...(own ? [`<${root.tag}>`] : []), ...(root.children ?? []).flatMap(fromTemplate)];
}

/** What in one source file lets a box scroll or speaks of a bar, as `<file> <selector>`. */
function scrollersIn(file: string, source: string): string[] {
  if (OWNERS.includes(file)) return [];
  if (file.endsWith('.css')) return fromStylesheet(source).map((found) => `${file} ${found}`);
  const { descriptor } = parse(source);
  const template = descriptor.template?.ast as unknown as TemplateNode | undefined;
  return [
    ...descriptor.styles.flatMap((style) => fromStylesheet(style.content)),
    ...(template ? fromTemplate(template) : []),
  ].map((found) => `${file} ${found}`);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(?:vue|css)$/.test(full) ? [full] : [];
  });
}

function everyScroller(): string[] {
  return sourceFiles(SRC).flatMap((file) =>
    scrollersIn(relative(SRC, file), readFileSync(file, 'utf-8')),
  );
}

describe('the guard itself', () => {
  it.each([
    ['overflow-y', '<style scoped>.list { overflow-y: auto; }</style>', '.list'],
    ['overflow-x', '<style>.strip { overflow-x: scroll; }</style>', '.strip'],
    ['either side of the shorthand', '<style>.box { overflow: hidden auto; }</style>', '.box'],
    ['a rule in a media query', '<style>@media print { .a b { overflow: auto; } }</style>', '.a b'],
    ['a bar hidden by hand', '<style>.strip { scrollbar-width: none; }</style>', '.strip'],
    ['a bar coloured by hand', '<style>.strip { scrollbar-color: red blue; }</style>', '.strip'],
    [
      'a bar drawn by hand',
      '<style>.b::-webkit-scrollbar { width: 8px; }</style>',
      '.b::-webkit-scrollbar',
    ],
    ['a style attribute', '<template><div style="overflow: auto"></div></template>', '<div>'],
    [
      'a style attribute deep in the template',
      '<template><p><b v-if="a"><i style="height: 1px; overflow-y: scroll"></i></b></p></template>',
      '<i>',
    ],
  ])('fires on %s', (_name, source, found) => {
    expect(scrollersIn('components/Fixture.vue', source)).toEqual([
      `components/Fixture.vue ${found}`,
    ]);
  });

  it('fires on a stylesheet', () => {
    expect(scrollersIn('assets/fixture.css', '.table { overflow-x: auto; }')).toEqual([
      'assets/fixture.css .table',
    ]);
  });

  it.each([
    ['a box that only clips', '<style>.box { overflow: hidden; }</style>'],
    ['a box in print', '<style>@media print { .box { overflow: visible; } }</style>'],
    ['an ellipsis', '<style>.name { text-overflow: ellipsis; }</style>'],
    ['a scroll margin', '<style>.field { scroll-margin: 8px; }</style>'],
    ['the words in a comment', '<style>/* overflow: auto; scrollbar-width: none; */</style>'],
    ['the words on screen', '<template><p>overflow: auto</p></template>'],
    ['a style attribute that only clips', '<template><p style="overflow: hidden"></p></template>'],
    ['a script', '<script setup>const overflow = "overflow: auto";</script>'],
  ])('is quiet on %s', (_name, source) => {
    expect(scrollersIn('components/Fixture.vue', source)).toEqual([]);
  });

  it('is quiet on what owns a scroller and on the one rule on bars', () => {
    expect(
      scrollersIn('components/ScrollBox.vue', '<style>.a { overflow: auto; }</style>'),
    ).toEqual([]);
    expect(scrollersIn('assets/base.css', '.a { scrollbar-width: none; }')).toEqual([]);
  });

  it('reads the files that hold the rule', () => {
    const files = sourceFiles(SRC).map((file) => relative(SRC, file));
    expect(files).toEqual(expect.arrayContaining(OWNERS));
  });
});

describe('every in-app scroller is a ScrollBox', () => {
  it('has no scroller or rule on a bar outside ScrollBox and base.css, but the named list', () => {
    const unnamed = everyScroller().filter((found) => !NOT_YET_CONVERTED.includes(found));
    expect(
      unnamed,
      'a box that scrolls is a ScrollBox, and the one rule on bars is in base.css ' +
        '(docs/design-system.md#the-primitive-layer)',
    ).toEqual([]);
  });

  it('names only what is still to convert, so the list can only fall', () => {
    const found = everyScroller();
    expect(
      NOT_YET_CONVERTED.filter((named) => !found.includes(named)),
      'converted: take these out of NOT_YET_CONVERTED',
    ).toEqual([]);
  });
});
