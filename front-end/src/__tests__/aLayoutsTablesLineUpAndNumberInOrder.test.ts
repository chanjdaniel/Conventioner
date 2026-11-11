/**
 * The geometry of many tables at once (T257 ticket 05): the box that selects by centre, a ragged
 * selection lined up and spaced evenly, where a duplicate goes, the order Renumber by position
 * reads a section in, and a table whose section is gone read as in no section.
 */
import { describe, expect, it } from 'vitest';
import {
  alignMoves,
  boxBetween,
  cornersOf,
  duplicateOffset,
  inNoSection,
  readingOrder,
  shapesOverlap,
  spreadMoves,
  tableBounds,
  tableCorners,
  tablesInBox,
  type Bounds,
} from '@/components/layout/layoutGeometry';

const SIX_FOOT = { widthMm: 1830, depthMm: 760 };
const HALL = { widthMm: 30_000, heightMm: 22_500 };

const at = (id: string, xMm: number, yMm: number, rotation = 0) => ({ id, xMm, yMm, rotation });
const box = (left: number, top: number, width = 1000, height = 500): Bounds => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});
const moved = (boxes: Bounds[], moves: { dxMm: number; dyMm: number }[]) =>
  boxes.map((one, index) => ({
    left: one.left + moves[index].dxMm,
    right: one.right + moves[index].dxMm,
    top: one.top + moves[index].dyMm,
    bottom: one.bottom + moves[index].dyMm,
  }));

describe('a box drawn on the floor', () => {
  it('is the same box whichever corner it was drawn from', () => {
    const drawn = { left: 1000, top: 2000, right: 5000, bottom: 6000 };
    expect(boxBetween({ xMm: 1000, yMm: 2000 }, { xMm: 5000, yMm: 6000 })).toEqual(drawn);
    expect(boxBetween({ xMm: 5000, yMm: 6000 }, { xMm: 1000, yMm: 2000 })).toEqual(drawn);
    expect(boxBetween({ xMm: 5000, yMm: 2000 }, { xMm: 1000, yMm: 6000 })).toEqual(drawn);
  });

  it('selects every table whose centre is in it, its edge included, and no other', () => {
    const tables = [
      at('inside', 3000, 3000),
      at('on-the-edge', 5000, 4000),
      // Most of this table is in the box, and its centre is not.
      at('centre-outside', 5100, 3000),
      at('far', 20_000, 20_000),
    ];
    const drawn = { left: 1000, top: 2000, right: 5000, bottom: 6000 };
    expect(tablesInBox(tables, drawn)).toEqual(['inside', 'on-the-edge']);
  });
});

describe('aligning a ragged selection', () => {
  const ragged = [box(1000, 1000), box(2500, 1300, 2000, 800), box(4000, 700)];

  it('brings every left edge to the leftmost', () => {
    const lined = moved(ragged, alignMoves(ragged, 'left'));
    expect(lined.map((one) => one.left)).toEqual([1000, 1000, 1000]);
    // Nothing moves down the page.
    expect(lined.map((one) => one.top)).toEqual([1000, 1300, 700]);
  });

  it('brings every right edge to the rightmost', () => {
    const lined = moved(ragged, alignMoves(ragged, 'right'));
    expect(lined.map((one) => one.right)).toEqual([5000, 5000, 5000]);
  });

  it("brings every centre to the middle of the selection's box, across", () => {
    const lined = moved(ragged, alignMoves(ragged, 'centre'));
    expect(lined.map((one) => (one.left + one.right) / 2)).toEqual([3000, 3000, 3000]);
  });

  it('brings every top to the topmost and every bottom to the lowest', () => {
    expect(moved(ragged, alignMoves(ragged, 'top')).map((one) => one.top)).toEqual([700, 700, 700]);
    expect(moved(ragged, alignMoves(ragged, 'bottom')).map((one) => one.bottom)).toEqual([
      2100, 2100, 2100,
    ]);
  });

  it("brings every centre to the middle of the selection's box, down", () => {
    const lined = moved(ragged, alignMoves(ragged, 'middle'));
    expect(lined.map((one) => (one.top + one.bottom) / 2)).toEqual([1400, 1400, 1400]);
    expect(lined.map((one) => one.left)).toEqual([1000, 2500, 4000]);
  });

  it('reads a turned table by the box it stands in', () => {
    const turned = tableBounds(at('t', 5000, 5000, 90), SIX_FOOT);
    const level = tableBounds(at('l', 9000, 6000), SIX_FOOT);
    const lined = moved([turned, level], alignMoves([turned, level], 'top'));
    expect(lined[0].top).toBeCloseTo(lined[1].top, 6);
  });
});

describe('spacing a selection evenly', () => {
  it('across: the outer two stay and the gaps between the boxes are made equal', () => {
    // Given out of order: the spacing reads them left to right.
    const boxes = [box(9000, 0), box(0, 0), box(1200, 300, 2000), box(4000, 0)];
    const spaced = moved(boxes, spreadMoves(boxes, 'across'));
    expect(spaced[1].left).toBe(0);
    expect(spaced[0].left).toBe(9000);
    const inOrder = [spaced[1], spaced[2], spaced[3], spaced[0]];
    const gaps = inOrder.slice(1).map((one, index) => one.left - inOrder[index].right);
    // 10 m from end to end less 5 m of tables leaves 5 m for three gaps.
    gaps.forEach((gap) => expect(gap).toBeCloseTo(5000 / 3, 6));
    // Nothing moves down the page.
    expect(spaced.map((one) => one.top)).toEqual([0, 0, 300, 0]);
  });

  it('down: the same, top to bottom', () => {
    const boxes = [box(0, 0), box(0, 600), box(300, 4000)];
    const spaced = moved(boxes, spreadMoves(boxes, 'down'));
    expect(spaced.map((one) => one.top)).toEqual([0, 2000, 4000]);
    expect(spaced.map((one) => one.left)).toEqual([0, 0, 300]);
  });

  it('moves nothing with fewer than three', () => {
    const boxes = [box(0, 0), box(5000, 0)];
    expect(spreadMoves(boxes, 'across')).toEqual([
      { dxMm: 0, dyMm: 0 },
      { dxMm: 0, dyMm: 0 },
    ]);
  });
});

describe('where a duplicate goes', () => {
  const shape = (left: number, top: number, width = 1830, height = 760) =>
    cornersOf(box(left, top, width, height));
  const row = [shape(1000, 1000), shape(2830, 1000)];

  it('is one table depth and 300 mm down from its original', () => {
    expect(duplicateOffset(row, row, 760, HALL)).toEqual({ dxMm: 0, dyMm: 1060 });
  });

  it('is the next free place to the right when down is taken', () => {
    const below = shape(1500, 2100);
    // The selection is 3,660 mm wide: one width and 300 mm to the right.
    expect(duplicateOffset(row, [...row, below], 760, HALL)).toEqual({ dxMm: 3960, dyMm: 0 });
    // And the next place again when that is taken too.
    const beside = shape(5200, 1000);
    expect(duplicateOffset(row, [...row, below, beside], 760, HALL)).toEqual({
      dxMm: 7920,
      dyMm: 0,
    });
  });

  it('goes right when down would put a centre past the wall', () => {
    const low = [shape(1000, 22_000)];
    expect(duplicateOffset(low, low, 760, HALL)).toEqual({ dxMm: 2130, dyMm: 0 });
  });

  it('is down after all, over what stands there, when no place is free', () => {
    // As wide as the hall nearly, with a row under it and one over it.
    const wide = [shape(1000, 1000, 28_000)];
    const below = shape(1000, 2000, 28_000);
    const above = shape(1000, 0, 28_000);
    expect(duplicateOffset(wide, [...wide, below, above], 760, HALL)).toEqual({
      dxMm: 0,
      dyMm: 1060,
    });
  });

  it('goes left, then up the page, where the walls leave no place down or right', () => {
    // A row along the foot of the hall, wider than half of it: nothing is down, and one width
    // to the right is past the east wall.
    const low = [shape(8000, 22_000, 21_000)];
    expect(duplicateOffset(low, low, 760, HALL)).toEqual({ dxMm: 0, dyMm: -1060 });
    // A short row in the south-east corner goes left.
    const corner = [shape(27_000, 22_000, 2500)];
    expect(duplicateOffset(corner, corner, 760, HALL)).toEqual({ dxMm: -2800, dyMm: 0 });
  });

  it('judges a turned table as it stands, not by the box round it', () => {
    // Turned 30°, the box round a six foot table is 1,573 mm tall, and a copy 1,060 mm down
    // still stands clear of the table itself.
    const turned = [tableCorners(at('t', 9000, 5000, 30), SIX_FOOT)];
    expect(duplicateOffset(turned, turned, 760, HALL)).toEqual({ dxMm: 0, dyMm: 1060 });
  });
});

describe('two shapes', () => {
  const square = cornersOf(box(0, 0, 1000, 1000));

  it('overlap when they share floor, and not when they only touch', () => {
    expect(shapesOverlap(square, cornersOf(box(999, 0, 1000, 1000)))).toBe(true);
    expect(shapesOverlap(square, cornersOf(box(1000, 0, 1000, 1000)))).toBe(false);
    expect(shapesOverlap(square, cornersOf(box(200, 200, 100, 100)))).toBe(true);
  });

  it('are apart when a turned one clears the corner its box would cover', () => {
    // A square turned 45° about (1700, 1700): its box reaches back over the first square's corner,
    // and the square itself does not.
    const diamond = tableCorners(at('d', 1700, 1700, 45), { widthMm: 1400, depthMm: 1400 });
    expect(shapesOverlap(square, diamond)).toBe(false);
    expect(
      shapesOverlap(
        square,
        tableCorners(at('d', 1400, 1400, 45), { widthMm: 1400, depthMm: 1400 }),
      ),
    ).toBe(true);
  });
});

describe('the order Renumber by position reads a section in', () => {
  const sized = (table: ReturnType<typeof at>) => tableBounds(table, SIX_FOOT);
  const order = (tables: ReturnType<typeof at>[]) =>
    readingOrder(tables, sized).map((table) => table.id);

  it('is rows from the top, each from the left', () => {
    expect(
      order([
        at('d', 6000, 5000),
        at('b', 6000, 2000),
        at('c', 2000, 5000),
        at('a', 2000, 2000),
        at('e', 4000, 9000),
      ]),
    ).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps a ragged row one row: within half a table depth of where the row began', () => {
    // 760 mm deep: 380 mm either way is the same row, and 400 mm down is the next.
    expect(
      order([at('c', 6000, 2000), at('a', 2000, 2300), at('b', 4000, 1950), at('d', 1000, 2360)]),
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reads a turned table by the box it stands in: a column of them is one table a row', () => {
    // Turned a quarter, each stands 1,830 mm tall: 800 mm apart they are still one row.
    expect(
      order([at('b', 5000, 2800, 90), at('a', 2000, 2000, 90), at('c', 8000, 2400, 90)]),
    ).toEqual(['a', 'b', 'c']);
  });

  it('keeps the order given between two tables on one spot', () => {
    expect(order([at('first', 2000, 2000), at('second', 2000, 2000)])).toEqual(['first', 'second']);
  });
});

describe('a table whose section is gone', () => {
  const tables = [
    { id: 'g1', sectionId: 'gold', number: 1 },
    { id: 'x1', sectionId: 'removed', number: 1 },
    { id: 'loose', sectionId: null, number: null },
  ];

  it('is in no section, and has no number', () => {
    expect(inNoSection(tables, ['gold', 'silver'])).toEqual([
      tables[0],
      { id: 'x1', sectionId: null, number: null },
      tables[2],
    ]);
  });

  it('gives the same tables back when every section stands', () => {
    expect(inNoSection(tables, ['gold', 'removed'])).toBe(tables);
  });
});
