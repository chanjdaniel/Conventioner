/**
 * The copied Lucide icon draws like the text around it (T45).
 *
 * Five floorplan icons were glyphs of an icon font (`<i class="pi pi-*">`), whose next major is
 * proprietary and whose repository is archived (ADR 0015), and became Lucide icons (ISC), copied
 * into `components/icons/`; they went with the floorplan beta (T257), and `check`, copied the same
 * way for the searchable picker's chips, is the one left. It draws at `1em` in `currentColor`,
 * hidden from assistive technology, so the `font-size` and `color` around it size and colour it.
 * Its licence is `theLucideNoticeReachesTheBundle.test.ts`'s, and the font itself, as a
 * dependency, is `theAppOwnsItsComponents.test.ts`'s.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import IconCheck from '@/components/icons/IconCheck.vue';

describe('the copied Lucide icon', () => {
  it('draws at 1em in currentColor, hidden from assistive technology', () => {
    const svg = mount(IconCheck).find('svg');
    expect(svg.attributes()).toMatchObject({
      width: '1em',
      height: '1em',
      stroke: 'currentColor',
      'aria-hidden': 'true',
    });
  });
});
