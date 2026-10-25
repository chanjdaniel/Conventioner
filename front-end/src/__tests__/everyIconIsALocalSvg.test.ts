/**
 * The copied Lucide icons draw like the font they replaced, and carry their licence (T45).
 *
 * Five floorplan icons were glyphs of an icon font (`<i class="pi pi-*">`), whose next major is
 * proprietary and whose repository is archived (ADR 0015). They are now Lucide icons (ISC), copied
 * into `components/icons/` beside the app's other icons. Each draws at `1em` in `currentColor`,
 * hidden from assistive technology, so the `font-size` and `color` rules written for the font size
 * and colour it the same way; and ISC's notice travels with the copies, as the licence asks. The
 * font itself, as a dependency, is `theAppOwnsItsComponents.test.ts`'s.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { mount } from '@vue/test-utils';
import type { Component } from 'vue';
import IconCloudUpload from '@/components/icons/IconCloudUpload.vue';
import IconImage from '@/components/icons/IconImage.vue';
import IconList from '@/components/icons/IconList.vue';
import IconPencil from '@/components/icons/IconPencil.vue';
import IconTrash from '@/components/icons/IconTrash.vue';

const ICONS = resolvePath(process.cwd(), 'src/components/icons');
const LICENCE = 'LICENSE-lucide.txt';

/** Each copied icon. */
const LUCIDE: Array<{ file: string; component: Component }> = [
  { file: 'IconCloudUpload.vue', component: IconCloudUpload },
  { file: 'IconImage.vue', component: IconImage },
  { file: 'IconList.vue', component: IconList },
  { file: 'IconPencil.vue', component: IconPencil },
  { file: 'IconTrash.vue', component: IconTrash },
];

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

  it("ships Lucide's ISC notice beside them", () => {
    const path = join(ICONS, LICENCE);
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('ISC License');
    expect(text).toContain('Copyright (c) 2026 Lucide Icons and Contributors');
    expect(text).toContain('copyright notice and this permission notice appear in all copies');
  });
});
