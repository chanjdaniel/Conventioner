/**
 * Every icon is a local SVG component, and the copied ones carry their licence (T45).
 *
 * Five floorplan icons were glyphs of an icon font (`<i class="pi pi-*">`), whose next major is
 * proprietary and whose repository is archived (ADR 0015). They are now Lucide icons (ISC), copied
 * into `components/icons/` beside the app's other icons. Two things are asserted, because either
 * alone lets the problem back:
 *
 *   1. Nothing uses the font's classes, which with the font gone draw nothing at all; the font
 *      itself, as a dependency, is `theAppOwnsItsComponents.test.ts`'s.
 *   2. Each copied Lucide icon draws at `1em` in `currentColor`, hidden from assistive technology,
 *      so the `font-size` and `color` rules written for the font size and colour it the same way;
 *      and ISC's notice travels with the copies, as the licence asks.
 *
 * What it does NOT see: an icon drawn by a component library's own markup, or a class built from
 * a string at runtime.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath } from 'node:path';
import { mount } from '@vue/test-utils';
import type { Component } from 'vue';
import IconCloudUpload from '@/components/icons/IconCloudUpload.vue';
import IconImage from '@/components/icons/IconImage.vue';
import IconList from '@/components/icons/IconList.vue';
import IconPencil from '@/components/icons/IconPencil.vue';
import IconTrash from '@/components/icons/IconTrash.vue';

const ROOT = process.cwd();
const SRC = resolvePath(ROOT, 'src');
const ICONS = join(SRC, 'components/icons');
const LICENCE = 'LICENSE-lucide.txt';

/** Each copied icon, by the Lucide name it was copied from. */
const LUCIDE: Array<{ lucide: string; file: string; component: Component }> = [
  { lucide: 'cloud-upload', file: 'IconCloudUpload.vue', component: IconCloudUpload },
  { lucide: 'image', file: 'IconImage.vue', component: IconImage },
  { lucide: 'list', file: 'IconList.vue', component: IconList },
  { lucide: 'pencil', file: 'IconPencil.vue', component: IconPencil },
  { lucide: 'trash', file: 'IconTrash.vue', component: IconTrash },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(vue|ts|css)$/.test(entry) ? [full] : [];
  });
}

describe('nothing uses the icon font', () => {
  const files = sourceFiles(SRC).filter((f) => !f.endsWith('everyIconIsALocalSvg.test.ts'));

  it('no source uses a `pi pi-` class', () => {
    const offenders = files.filter((f) => /\bpi pi-/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });
});

describe('the copied Lucide icons', () => {
  it.each(LUCIDE)(
    '$file draws at 1em in currentColor, hidden from assistive technology',
    (icon) => {
      const svg = mount(icon.component).find('svg');
      expect(svg.attributes()).toMatchObject({
        width: '1em',
        height: '1em',
        stroke: 'currentColor',
        'aria-hidden': 'true',
      });
    },
  );

  it.each(LUCIDE)('$file names its Lucide source and the licence beside it', (icon) => {
    const source = readFileSync(join(ICONS, icon.file), 'utf8');
    expect(source).toContain(`Lucide \`${icon.lucide}\``);
    expect(source).toContain(LICENCE);
  });

  it("ships Lucide's ISC notice beside them", () => {
    const path = join(ICONS, LICENCE);
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('ISC License');
    expect(text).toContain('Copyright (c) 2026 Lucide Icons and Contributors');
    expect(text).toContain('copyright notice and this permission notice appear in all copies');
  });
});
