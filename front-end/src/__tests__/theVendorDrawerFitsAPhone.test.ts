/**
 * The vendor drawer's panel is as tall as the window a phone shows, not the window behind its
 * browser bar (T217): `100vh` there is the height with the bar hidden, so the panel's foot, the
 * drawer's last actions, sat under the bar. `100dvh` follows the bar; `100vh` stays before it for a
 * browser that has no `dvh`.
 *
 * Headless Chromium has no browser bar, so no spec can show the foot covered; this reads the
 * stylesheet that ships, as `primitives.test.ts` does.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import postcss from 'postcss';
import { parse as parseSfc } from 'vue/compiler-sfc';

const DRAWER = join(resolvePath(process.cwd(), 'src'), 'components/VendorDrawer.vue');

/** Every `height` the drawer's styles give `.detail-panel` outside a media query, in order. */
function panelHeights(): string[] {
  const { descriptor } = parseSfc(readFileSync(DRAWER, 'utf8'));
  const heights: string[] = [];
  for (const style of descriptor.styles) {
    postcss.parse(style.content).walkRules((rule) => {
      if (rule.parent?.type !== 'root' || !rule.selectors.includes('.detail-panel')) return;
      rule.walkDecls('height', (decl) => {
        heights.push(decl.value);
      });
    });
  }
  return heights;
}

describe("the vendor drawer's panel", () => {
  it('is the height of the window a phone shows, after a fallback for a browser with no dvh', () => {
    expect(panelHeights()).toEqual(['100vh', '100dvh']);
  });
});
