/**
 * A layout's geometry (T257 ticket 03): a turned table's box, the section palette's order, where a
 * section's name goes, the focus an arrow key moves, and the size a number is drawn at.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_NUMBER_PX,
  PX_PER_MM_AT_100,
  hallOf,
  nearestInDirection,
  numberSizePx,
  overlaps,
  sectionColors,
  sectionLabelAt,
  tableBounds,
  tableCorners,
  readsUpsideDown,
  zoomPercent,
  type Bounds,
} from '@/components/layout/layoutGeometry';

const SIX_FOOT = { widthMm: 1830, depthMm: 760 };

describe("a layout's hall", () => {
  it("is its image's extent at its scale", () => {
    const hall = hallOf({ imageWidth: 800, imageHeight: 600, scalePxPerUnit: 800 / 30_000 });
    expect(hall?.widthMm).toBeCloseTo(30_000);
    expect(hall?.heightMm).toBeCloseTo(22_500);
  });

  it('is none before an image or a scale', () => {
    expect(hallOf({ imageWidth: 800, imageHeight: 600, scalePxPerUnit: null })).toBeNull();
    expect(hallOf({ imageWidth: null, imageHeight: null, scalePxPerUnit: 0.03 })).toBeNull();
  });
});

describe('a turned table', () => {
  it('stands in its own box when it is not turned', () => {
    expect(tableBounds({ xMm: 5000, yMm: 3000, rotation: 0 }, SIX_FOOT)).toEqual({
      left: 4085,
      right: 5915,
      top: 2620,
      bottom: 3380,
    });
  });

  it('turned a quarter stands in a box of its depth by its width', () => {
    const box = tableBounds({ xMm: 5000, yMm: 3000, rotation: 90 }, SIX_FOOT);
    expect(box.left).toBeCloseTo(4620);
    expect(box.right).toBeCloseTo(5380);
    expect(box.top).toBeCloseTo(2085);
    expect(box.bottom).toBeCloseTo(3915);
  });

  it('turns clockwise about its centre', () => {
    // The corner drawn top-left goes to the top-right after a quarter turn clockwise.
    const [first] = tableCorners({ xMm: 0, yMm: 0, rotation: 90 }, SIX_FOOT);
    expect(first.xMm).toBeCloseTo(380);
    expect(first.yMm).toBeCloseTo(-915);
  });

  it('turned 45° stands in a square box', () => {
    const box = tableBounds({ xMm: 0, yMm: 0, rotation: 45 }, SIX_FOOT);
    const half = (1830 + 760) / 2 / Math.SQRT2;
    expect(box.right).toBeCloseTo(half);
    expect(box.bottom).toBeCloseTo(half);
    expect(box.left).toBeCloseTo(-half);
    expect(box.top).toBeCloseTo(-half);
  });

  it('does not overlap a table it only touches', () => {
    const a = tableBounds({ xMm: 0, yMm: 0, rotation: 0 }, SIX_FOOT);
    const b = tableBounds({ xMm: 1830, yMm: 0, rotation: 0 }, SIX_FOOT);
    const c = tableBounds({ xMm: 1829, yMm: 0, rotation: 0 }, SIX_FOOT);
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(a, c)).toBe(true);
  });
});

describe('the section palette', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `s${i + 1}`);

  it('gives sections with no style the colours in order', () => {
    expect([...sectionColors(ids(4), []).values()]).toEqual([1, 2, 3, 4]);
  });

  it('keeps the colour a style names, and skips it for the others', () => {
    const colors = sectionColors(ids(4), [{ sectionId: 's3', color: 1 }]);
    expect(Object.fromEntries(colors)).toEqual({ s1: 2, s2: 3, s3: 1, s4: 4 });
  });

  it('wraps a ninth section to the first colour', () => {
    expect([...sectionColors(ids(10), []).values()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 1, 2]);
  });

  it('reads a style of no palette colour, or of a section not in the layout, as none', () => {
    const colors = sectionColors(ids(2), [
      { sectionId: 's1', color: 9 },
      { sectionId: 's2', color: 1.5 },
      { sectionId: 'gone', color: 1 },
    ]);
    expect(Object.fromEntries(colors)).toEqual({ s1: 1, s2: 2 });
  });
});

describe("a section's name beside its tables", () => {
  const HALL = { widthMm: 36_000, heightMm: 24_000 };
  const LABEL = { widthMm: 3000, heightMm: 700, gapMm: 200 };
  /** A row of `n` six-foot tables, from its first table's centre. */
  const row = (x: number, y: number, n: number, rotation = 0): Bounds[] =>
    Array.from({ length: n }, (_, i) =>
      tableBounds(
        rotation
          ? { xMm: x, yMm: y + i * 1830, rotation }
          : { xMm: x + i * 1830, yMm: y, rotation },
        SIX_FOOT,
      ),
    );

  it('has none for a section with no tables', () => {
    expect(sectionLabelAt({ own: [], taken: [], hall: HALL, ...LABEL })).toBeNull();
  });

  it('goes under a row in the upper half, at its middle, a gap below it', () => {
    const own = row(10_000, 4000, 5);
    const at = sectionLabelAt({ own, taken: own, hall: HALL, ...LABEL });
    expect(at?.xMm).toBeCloseTo(10_000 + 2 * 1830);
    expect(at?.yMm).toBeCloseTo(4380 + 200 + 350);
  });

  it('goes over a row in the lower half', () => {
    const own = row(10_000, 20_000, 5);
    const at = sectionLabelAt({ own, taken: own, hall: HALL, ...LABEL });
    expect(at?.yMm).toBeCloseTo(20_000 - 380 - 200 - 350);
  });

  it('goes beside a column, on the side toward the middle of the hall', () => {
    const west = row(2000, 5000, 6, 90);
    const east = row(34_000, 5000, 6, 90);
    const left = sectionLabelAt({ own: west, taken: west, hall: HALL, ...LABEL });
    const right = sectionLabelAt({ own: east, taken: east, hall: HALL, ...LABEL });
    expect(left?.xMm).toBeCloseTo(2380 + 200 + 1500);
    expect(right?.xMm).toBeCloseTo(34_000 - 380 - 200 - 1500);
    expect(left?.yMm).toBeCloseTo(5000 + 2.5 * 1830);
  });

  it('stands against its own tables, not out on the floor of an L-shaped section', () => {
    // Nine down the west wall and four along the top: the box's right side is the top row's end.
    const own = [...row(1200, 4500, 9, 90), ...row(3500, 1200, 4)];
    const at = sectionLabelAt({ own, taken: own, hall: HALL, ...LABEL })!;
    // Beside the column, at the box's middle height, a gap from the column's own edge.
    expect(at.xMm).toBeCloseTo(1200 + 380 + 200 + 1500);
    expect(at.yMm).toBeCloseTo((1200 - 380 + 4500 + 8 * 1830 + 915) / 2);
  });

  it('slides along the side, off a table of another section', () => {
    const own = row(10_000, 4000, 5);
    // Another section's table stands right under the row's middle.
    const other = tableBounds({ xMm: 10_000 + 2 * 1830, yMm: 5000, rotation: 0 }, SIX_FOOT);
    const taken = [...own, other];
    const at = sectionLabelAt({ own, taken, hall: HALL, ...LABEL })!;
    const label = {
      left: at.xMm - 1500,
      right: at.xMm + 1500,
      top: at.yMm - 350,
      bottom: at.yMm + 350,
    };
    expect(at.yMm).toBeCloseTo(4380 + 200 + 350);
    expect(at.xMm).not.toBeCloseTo(10_000 + 2 * 1830);
    expect(taken.some((box) => overlaps(label, box))).toBe(false);
  });

  it('takes the other side where the first is full', () => {
    const own = row(10_000, 4000, 5);
    const under = row(10_000, 5200, 5);
    const at = sectionLabelAt({ own, taken: [...own, ...under], hall: HALL, ...LABEL });
    expect(at?.yMm).toBeCloseTo(4000 - 380 - 200 - 350);
  });

  it('stays clear of a label already placed', () => {
    const own = row(10_000, 4000, 5);
    const first = sectionLabelAt({ own, taken: own, hall: HALL, ...LABEL })!;
    const placed = {
      left: first.xMm - 1500,
      right: first.xMm + 1500,
      top: first.yMm - 350,
      bottom: first.yMm + 350,
    };
    const second = sectionLabelAt({ own, taken: [...own, placed], hall: HALL, ...LABEL })!;
    expect(second).not.toEqual(first);
  });

  it('never leaves the hall', () => {
    // A row hard against the top and bottom of a hall barely taller than it.
    const hall = { widthMm: 12_000, heightMm: 1000 };
    const own = row(2000, 500, 5);
    const at = sectionLabelAt({ own, taken: own, hall, ...LABEL })!;
    expect(at.xMm - 1500).toBeGreaterThanOrEqual(0);
    expect(at.xMm + 1500).toBeLessThanOrEqual(12_000);
    expect(at.yMm - 350).toBeGreaterThanOrEqual(0);
    expect(at.yMm + 350).toBeLessThanOrEqual(1000);
  });
});

describe('the focus, moved by an arrow key', () => {
  const at = (id: string, xMm: number, yMm: number) => ({ id, xMm, yMm });
  const tables = [
    at('a', 0, 0),
    at('b', 2000, 0),
    at('c', 4000, 0),
    at('d', 0, 3000),
    at('e', 2000, 3000),
  ];

  it('goes to the nearest table that way', () => {
    expect(nearestInDirection(tables[0], tables.slice(1), 'right')?.id).toBe('b');
    expect(nearestInDirection(tables[2], tables.slice(0, 2), 'left')?.id).toBe('b');
    expect(nearestInDirection(tables[0], tables.slice(1), 'down')?.id).toBe('d');
    expect(nearestInDirection(tables[4], tables.slice(0, 4), 'up')?.id).toBe('b');
  });

  it('goes nowhere when no table stands that way', () => {
    expect(nearestInDirection(tables[0], tables.slice(1), 'left')).toBeNull();
    expect(nearestInDirection(tables[0], tables.slice(1), 'up')).toBeNull();
  });

  it('reaches only a table within 45° of the arrow', () => {
    const others = [at('steep', 1000, 1500), at('far', 9000, 0)];
    expect(nearestInDirection(at('from', 0, 0), others, 'right')?.id).toBe('far');
    expect(nearestInDirection(at('from', 0, 0), others, 'down')?.id).toBe('steep');
  });

  it('follows a turned row', () => {
    const turned = [at('1', 0, 0), at('2', 1500, 1000), at('3', 3000, 2000)];
    expect(nearestInDirection(turned[0], turned.slice(1), 'right')?.id).toBe('2');
    expect(nearestInDirection(turned[1], [turned[0], turned[2]], 'right')?.id).toBe('3');
  });

  it('takes the one more in line of two as near', () => {
    // Both 5 m away and inside the cone; the first listed stands further off the arrow's line.
    const others = [at('aside', 4000, 3000), at('ahead', 5000, 0)];
    expect(nearestInDirection(at('from', 0, 0), others, 'right')?.id).toBe('ahead');
    expect(nearestInDirection(at('from', 0, 0), [...others].reverse(), 'right')?.id).toBe('ahead');
  });
});

describe("a table's number on the screen", () => {
  it('holds its size wherever the table has the room, however far in', () => {
    expect(numberSizePx(SIX_FOOT, 2, PX_PER_MM_AT_100)).toBe(MAX_NUMBER_PX);
    expect(numberSizePx(SIX_FOOT, 2, PX_PER_MM_AT_100 * 8)).toBe(MAX_NUMBER_PX);
  });

  it('shrinks to fit a table drawn small', () => {
    // A 6 ft table at 1 px to 50 mm is 15.2 px deep.
    expect(numberSizePx(SIX_FOOT, 1, 0.02)).toBeCloseTo(15.2 * 0.7);
  });

  it('shrinks for a long number on a short table', () => {
    const square = { widthMm: 600, depthMm: 600 };
    expect(numberSizePx(square, 3, PX_PER_MM_AT_100)).toBeCloseTo((24 * 0.85) / 1.8);
  });

  it('is left out where it could not be read', () => {
    expect(numberSizePx(SIX_FOOT, 1, PX_PER_MM_AT_100 / 10)).toBe(0);
  });

  it('never reads upside down', () => {
    expect(readsUpsideDown(0)).toBe(false);
    expect(readsUpsideDown(90)).toBe(false);
    expect(readsUpsideDown(91)).toBe(true);
    expect(readsUpsideDown(180)).toBe(true);
    expect(readsUpsideDown(270)).toBe(true);
    expect(readsUpsideDown(271)).toBe(false);
    expect(readsUpsideDown(-90)).toBe(true);
  });

  it('reads a scale as a zoom', () => {
    expect(zoomPercent(PX_PER_MM_AT_100)).toBe(100);
    expect(zoomPercent(0.004)).toBe(10);
    expect(zoomPercent(0.32)).toBe(800);
  });
});
