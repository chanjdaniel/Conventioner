/**
 * Reading a layout by hand (T257 ticket 12): the arithmetic of a read map's view, which a phone
 * pinches and drags, kept to the hall; how near a tap may fall to a table and still read it; and
 * the read map itself, pinched, dragged and tapped.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import LayoutMap from '@/components/layout/LayoutMap.vue';
import {
  MAX_ZOOM_PX_PER_MM,
  distanceToTable,
  keptView,
  pannedView,
  pinchedView,
  seenView,
} from '@/components/layout/layoutGeometry';

const HALL = { xMm: 0, yMm: 0, widthMm: 30_000, heightMm: 22_500 };

describe('seenView', () => {
  it('is the view itself in a box of its shape', () => {
    expect(seenView(HALL, 400, 300)).toEqual(HALL);
  });

  it('widens a view drawn in a wider box, about its middle', () => {
    const seen = seenView(HALL, 800, 300);
    expect(seen.heightMm).toBe(22_500);
    expect(seen.widthMm).toBe(60_000);
    expect(seen.xMm).toBe(-15_000);
    expect(seen.yMm).toBe(0);
  });

  it('deepens a view drawn in a taller box, about its middle', () => {
    const seen = seenView(HALL, 400, 600);
    expect(seen.widthMm).toBe(30_000);
    expect(seen.heightMm).toBe(45_000);
    expect(seen.yMm).toBe(-11_250);
  });

  it('is the view as given with no box measured', () => {
    expect(seenView(HALL, 0, 0)).toEqual(HALL);
  });
});

describe('pannedView', () => {
  it('moves the view against the finger, at the view’s scale', () => {
    // 400 px across 30 m: 75 mm a pixel.
    const panned = pannedView(HALL, 40, -20, 400);
    expect(panned).toEqual({ xMm: -3000, yMm: 1500, widthMm: 30_000, heightMm: 22_500 });
  });
});

describe('pinchedView', () => {
  it('zooms by the fingers’ spread, the point between them staying under them', () => {
    const start = HALL;
    // Fingers 100 px apart about (200, 150), spread to 200 px apart about the same place.
    const pinched = pinchedView(
      start,
      [
        { x: 150, y: 150 },
        { x: 250, y: 150 },
      ],
      [
        { x: 100, y: 150 },
        { x: 300, y: 150 },
      ],
      400,
    );
    expect(pinched.widthMm).toBeCloseTo(15_000);
    expect(pinched.heightMm).toBeCloseTo(11_250);
    // The hall's middle was under (200, 150) and still is.
    expect(pinched.xMm + (200 / 400) * pinched.widthMm).toBeCloseTo(15_000);
    expect(pinched.yMm + (150 / 300) * pinched.heightMm).toBeCloseTo(11_250);
  });

  it('follows the fingers as they move together', () => {
    const pinched = pinchedView(
      HALL,
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      [
        { x: 140, y: 120 },
        { x: 240, y: 120 },
      ],
      400,
    );
    expect(pinched.widthMm).toBeCloseTo(30_000);
    expect(pinched.xMm).toBeCloseTo(-40 * 75);
    expect(pinched.yMm).toBeCloseTo(-20 * 75);
  });

  it('keeps the view when the fingers start on one point', () => {
    const same = { x: 100, y: 100 };
    expect(pinchedView(HALL, [same, same], [same, { x: 200, y: 100 }], 400)).toEqual(HALL);
  });
});

describe('keptView', () => {
  it('is the whole hall when zoomed out past it, so a pinch out stops there', () => {
    const wide = { xMm: -10_000, yMm: -5000, widthMm: 60_000, heightMm: 45_000 };
    expect(keptView(wide, HALL, 400)).toEqual(HALL);
  });

  it('keeps a zoomed view inside the hall', () => {
    const past = { xMm: -2000, yMm: 20_000, widthMm: 10_000, heightMm: 7500 };
    expect(keptView(past, HALL, 400)).toEqual({
      xMm: 0,
      yMm: 15_000,
      widthMm: 10_000,
      heightMm: 7500,
    });
  });

  it('leaves a view inside the hall as it is', () => {
    const inside = { xMm: 4000, yMm: 3000, widthMm: 10_000, heightMm: 7500 };
    expect(keptView(inside, HALL, 400)).toEqual(inside);
  });

  it('zooms in no further than the editor’s most, about the view’s middle', () => {
    const close = { xMm: 14_900, yMm: 11_200, widthMm: 200, heightMm: 150 };
    const kept = keptView(close, HALL, 400);
    expect(kept.widthMm).toBeCloseTo(400 / MAX_ZOOM_PX_PER_MM);
    expect(kept.heightMm).toBeCloseTo((400 / MAX_ZOOM_PX_PER_MM) * 0.75);
    expect(kept.xMm + kept.widthMm / 2).toBeCloseTo(15_000);
    expect(kept.yMm + kept.heightMm / 2).toBeCloseTo(11_275);
  });

  it('centres a hall drawn in a box of another shape, which cannot move', () => {
    const whole = seenView(HALL, 800, 300);
    const moved = { ...whole, xMm: whole.xMm + 5000 };
    expect(keptView(moved, whole, 800)).toEqual(whole);
  });
});

describe('distanceToTable', () => {
  const size = { widthMm: 1830, depthMm: 760 };

  it('is nothing for a point on the table', () => {
    expect(
      distanceToTable({ xMm: 5500, yMm: 3200 }, { xMm: 5000, yMm: 3000, rotation: 0 }, size),
    ).toBe(0);
  });

  it('is the way to its nearest edge from beside it', () => {
    const table = { xMm: 5000, yMm: 3000, rotation: 0 };
    expect(distanceToTable({ xMm: 5000, yMm: 3500 }, table, size)).toBeCloseTo(120);
    expect(distanceToTable({ xMm: 6115, yMm: 3000 }, table, size)).toBeCloseTo(200);
  });

  it('is the way to a corner from past it', () => {
    const table = { xMm: 0, yMm: 0, rotation: 0 };
    expect(distanceToTable({ xMm: 915 + 30, yMm: 380 + 40 }, table, size)).toBeCloseTo(50);
  });

  it('reads a turned table along its own sides', () => {
    // Turned a quarter: 760 across, 1830 down.
    const table = { xMm: 0, yMm: 0, rotation: 90 };
    expect(distanceToTable({ xMm: 0, yMm: 900 }, table, size)).toBe(0);
    expect(distanceToTable({ xMm: 480, yMm: 0 }, table, size)).toBeCloseTo(100);
  });
});

// ── The read map, by hand ────────────────────────────────────────────────────

/** A hall 30 m by 22.5 m drawn in a box 400 by 300 px: 75 mm a pixel. */
function readMap(props: Record<string, unknown> = {}): VueWrapper {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('data-testid') !== 'layout-map') return new DOMRect(0, 0, 0, 0);
    return new DOMRect(0, 0, 400, 300);
  });
  wrapper = mount(LayoutMap, {
    attachTo: document.body,
    props: {
      layout: {
        id: 'fp-1',
        locationId: 'loc-upper',
        revision: 1,
        imageGridfsId: 'image-1',
        imageWidth: 800,
        imageHeight: 600,
        scalePxPerUnit: 800 / 30_000,
        tables: [
          {
            id: 'g1',
            sectionId: 'sec-gold',
            number: 1,
            tableTypeId: 'six',
            xMm: 15_000,
            yMm: 11_250,
            rotation: 0,
          },
          {
            id: 'g2',
            sectionId: 'sec-gold',
            number: 2,
            tableTypeId: 'six',
            xMm: 3000,
            yMm: 3000,
            rotation: 0,
          },
        ],
        zones: [],
        sectionStyles: [],
        startingCounts: [],
      },
      locationName: 'Upper Hall',
      sections: [
        {
          id: 'sec-gold',
          name: 'Gold row',
          location: { id: 'loc-upper', name: 'Upper Hall' },
          tier: null,
          count: 2,
        },
      ],
      tableTypes: [{ id: 'six', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 }],
      mode: 'read',
      ...props,
    },
  });
  return wrapper;
}

const viewBox = (map: VueWrapper) => map.attributes('viewBox')!.split(' ').map(Number);

/** The view is the whole hall, to a float's last place (the hall is the image over its scale). */
function expectWhole(map: VueWrapper) {
  viewBox(map).forEach((side, i) => expect(side).toBeCloseTo([0, 0, 30_000, 22_500][i]));
}

async function pointer(
  map: VueWrapper,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  id: number,
  x: number,
  y: number,
  on: Element = map.element,
) {
  on.dispatchEvent(
    new PointerEvent(type, {
      pointerId: id,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
      bubbles: true,
    }),
  );
  await nextTick();
}

/** Two fingers spread from 100 px apart to 200 px apart about the hall's middle. */
async function pinchOut(map: VueWrapper) {
  await pointer(map, 'pointerdown', 1, 150, 150);
  await pointer(map, 'pointerdown', 2, 250, 150);
  await pointer(map, 'pointermove', 1, 100, 150);
  await pointer(map, 'pointermove', 2, 300, 150);
  await pointer(map, 'pointerup', 1, 100, 150);
  await pointer(map, 'pointerup', 2, 300, 150);
  map.element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200, clientY: 150 }));
  await nextTick();
}

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
});

describe('a read map, by hand', () => {
  it('shows the whole hall, and lets one finger scroll the page', () => {
    const map = readMap();
    expectWhole(map);
    expect((map.element as SVGElement).style.touchAction).toBe('pan-y');
  });

  it('zooms by a pinch about the fingers, and then keeps one finger for itself', async () => {
    const map = readMap();
    await pinchOut(map);
    const [x, y, width, height] = viewBox(map);
    expect(width).toBeCloseTo(15_000);
    expect(height).toBeCloseTo(11_250);
    expect(x + width / 2).toBeCloseTo(15_000);
    expect(y + height / 2).toBeCloseTo(11_250);
    expect((map.element as SVGElement).style.touchAction).toBe('none');
    // The pinch's own click reads nothing.
    expect(map.emitted('activate')).toBeUndefined();
  });

  it('is dragged by one finger once zoomed, and the drag reads nothing', async () => {
    const map = readMap();
    await pinchOut(map);
    const [before] = viewBox(map);
    const table = map.get('[data-table-id="g1"]').element;
    await pointer(map, 'pointerdown', 3, 200, 150, table);
    await pointer(map, 'pointermove', 3, 160, 150, table);
    await pointer(map, 'pointerup', 3, 160, 150, table);
    table.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 160, clientY: 150 }));
    await nextTick();
    // 40 px at 37.5 mm a pixel.
    expect(viewBox(map)[0]).toBeCloseTo(before + 1500);
    expect(map.emitted('activate')).toBeUndefined();
  });

  it('drags nothing at the whole hall, which a drag cannot leave', async () => {
    const map = readMap();
    await pointer(map, 'pointerdown', 1, 200, 150);
    await pointer(map, 'pointermove', 1, 120, 100);
    await pointer(map, 'pointerup', 1, 120, 100);
    expectWhole(map);
  });

  it('reads a table tapped, though the finger moved a few pixels', async () => {
    const map = readMap();
    const table = map.get('[data-table-id="g1"]').element;
    await pointer(map, 'pointerdown', 1, 200, 150, table);
    await pointer(map, 'pointermove', 1, 204, 153, table);
    await pointer(map, 'pointerup', 1, 204, 153, table);
    table.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 204, clientY: 153 }));
    expect(map.emitted('activate')).toEqual([['g1']]);
  });

  it('reads a tap the browser sends no click for, as after a drag', async () => {
    const map = readMap();
    const table = map.get('[data-table-id="g1"]').element;
    await pointer(map, 'pointerdown', 1, 200, 150, table);
    await pointer(map, 'pointerup', 1, 200, 150, table);
    expect(map.emitted('activate')).toEqual([['g1']]);
  });

  it('reads a click with no press before it, as a screen reader sends', async () => {
    const map = readMap();
    map
      .get('[data-table-id="g2"]')
      .element.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 40, clientY: 40 }));
    expect(map.emitted('activate')).toEqual([['g2']]);
  });

  it('reads the table a tap falls just beside, and nothing further off', async () => {
    const map = readMap();
    const floor = map.get('.layout-map__floor').element;
    // g2's top edge is at 2620 mm, 34.9 px down: a tap 10 px above it reads it.
    floor.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 40, clientY: 25 }));
    // 20 px above it reads nothing.
    floor.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 40, clientY: 15 }));
    expect(map.emitted('activate')).toEqual([['g2']]);
  });

  it('tells each table given the focus', async () => {
    const map = readMap();
    (map.get('[data-table-id="g2"]').element as SVGGElement).focus();
    await nextTick();
    expect(map.emitted('focused')).toEqual([['g2']]);
  });

  it('is not looked round by hand when its view is given, as the editor gives it', async () => {
    const view = { xMm: 0, yMm: 0, widthMm: 30_000, heightMm: 22_500 };
    const map = readMap({ mode: 'edit', view });
    await pinchOut(map);
    expect(viewBox(map)).toEqual([0, 0, 30_000, 22_500]);
    expect((map.element as SVGElement).style.touchAction).toBe('');
  });
});
