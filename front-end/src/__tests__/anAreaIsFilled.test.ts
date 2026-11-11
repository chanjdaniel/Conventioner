/**
 * Fill an area (T257 ticket 09): a box, or a shape whose corners are clicked, is sent to the
 * placement with what stands in the layout, and its answer is added as one change. The shape
 * being drawn is never in the layout; one whose sides cross cannot be closed. With the request
 * the tool sends, the sentence it says of the answer, and `polygonIsSimple`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FloorplanObject, FloorplanTable } from '@/assets/types/datatypes';
import { polygonIsSimple } from '@/components/layout/layoutGeometry';
import {
  AREA_CROSSES,
  AREA_HAS_TOO_MANY,
  AREA_NEEDS_THREE,
  FILL_CHOICES_AT_FIRST,
  LAYOUT_IS_FULL,
  MAX_FILL_TABLES,
  NOTHING_FITS,
  areaSaid,
  countOf,
  fillChoices,
  fillRequest,
  saidFilled,
  useFillTool,
  type FillAnswer,
} from '@/components/layout/layoutFill';
import type { SavedLayout } from '@/components/layout/layoutSave';
import { useLayoutEditor } from '@/components/layout/useLayoutEditor';

const SIX_FOOT = { id: 'six-foot', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 };
const SQUARE = { id: 'square', name: 'Square 4 ft', widthMm: 1220, depthMm: 1220 };
const TYPES = [SIX_FOOT, SQUARE];
const p = (xMm: number, yMm: number) => ({ xMm, yMm });

function table(id: string, sectionId: string | null, number: number | null, x = 5000, y = 5000) {
  return { id, sectionId, number, tableTypeId: 'six-foot', xMm: x, yMm: y, rotation: 0 };
}

/** A hall 30 m by 22.5 m. */
function aLayout(tables: FloorplanTable[], zones: FloorplanObject['zones'] = []): FloorplanObject {
  return {
    id: 'fp-1',
    locationId: 'loc-upper',
    revision: 3,
    imageGridfsId: 'image-1',
    imageWidth: 800,
    imageHeight: 600,
    scalePxPerUnit: 800 / 30_000,
    tables,
    zones,
    sectionStyles: [],
    startingCounts: [],
  };
}

function aTool(tables: FloorplanTable[] = [], zones: FloorplanObject['zones'] = []) {
  const save = vi.fn((layout: FloorplanObject): Promise<SavedLayout> =>
    Promise.resolve({ floorplan: { ...layout, revision: layout.revision + 1 }, sections: [] }),
  );
  let id = 0;
  const editor = useLayoutEditor({
    save,
    tableTypes: () => TYPES,
    newId: () => `new-${(id += 1)}`,
  });
  editor.adopt(aLayout(tables, zones));
  const chosen = { sectionId: 'gold' as string | null, tableTypeId: 'six-foot' };
  const fill = useFillTool({
    editor,
    tableTypes: () => TYPES,
    sectionId: () => chosen.sectionId,
    tableTypeId: () => chosen.tableTypeId,
  });
  return { editor, fill, chosen, save, tables: () => editor.layout.value!.tables };
}

const placed = (x: number, y: number, rotation = 0) => ({
  x_mm: x,
  y_mm: y,
  rotation,
  width_mm: 1830,
  height_mm: 760,
  table_type_id: 'six-foot',
});

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(fillChoices, FILL_CHOICES_AT_FIRST);
});
afterEach(() => vi.useRealTimers());

describe('polygonIsSimple', () => {
  it('takes a triangle, a box and an L, drawn either way round', () => {
    const l = [p(0, 0), p(12, 0), p(12, 4), p(4, 4), p(4, 12), p(0, 12)];
    expect(polygonIsSimple([p(0, 0), p(10, 0), p(0, 10)])).toBe(true);
    expect(polygonIsSimple([p(0, 0), p(10, 0), p(10, 10), p(0, 10)])).toBe(true);
    expect(polygonIsSimple(l)).toBe(true);
    expect(polygonIsSimple([...l].reverse())).toBe(true);
  });

  it('refuses a bow tie, whose sides cross', () => {
    expect(polygonIsSimple([p(0, 0), p(8, 0), p(0, 6), p(8, 6)])).toBe(false);
  });

  it('refuses a shape whose closing side crosses one drawn before it', () => {
    // The last corner is beyond the first side, so the side back to the start crosses it.
    expect(polygonIsSimple([p(0, 0), p(10, 0), p(10, 10), p(5, -5)])).toBe(false);
  });

  it('refuses fewer than three corners, and corners that enclose no floor', () => {
    expect(polygonIsSimple([])).toBe(false);
    expect(polygonIsSimple([p(0, 0), p(10, 0)])).toBe(false);
    expect(polygonIsSimple([p(0, 0), p(5, 0), p(10, 0)])).toBe(false);
    expect(polygonIsSimple([p(0, 0), p(10, 0), p(0, 0)])).toBe(false);
  });

  it('refuses a side that runs back along the one before it, and a corner laid on a side', () => {
    expect(polygonIsSimple([p(0, 0), p(10, 0), p(4, 0), p(4, 8)])).toBe(false);
    // The fourth corner touches the first side from inside.
    expect(polygonIsSimple([p(0, 0), p(10, 0), p(10, 10), p(5, 0), p(0, 10)])).toBe(false);
  });

  it('refuses the same corner twice', () => {
    expect(polygonIsSimple([p(0, 0), p(10, 0), p(10, 10), p(10, 0), p(0, 10)])).toBe(false);
  });
});

describe('what the tool asks of the placement', () => {
  it('sends a box as x, y, width and depth, the hall as the room, and no wall buffer', () => {
    const request = fillRequest(
      aLayout([]),
      TYPES,
      'six-foot',
      { kind: 'box', box: { left: 2000, top: 3000, right: 22_000, bottom: 15_000 } },
      { count: 30, direction: 'across', aisleMm: 1200 },
    );

    expect(request).toEqual({
      walls: [],
      obstacles: [],
      table_types: [
        { id: 'six-foot', name: 'Standard 6 ft', width_mm: 1830, height_mm: 760, max_capacity: 1 },
      ],
      counts: { 'six-foot': 30 },
      scale_px_per_mm: 800 / 30_000,
      room_mm: { width_mm: expect.closeTo(30_000, 6), height_mm: expect.closeTo(22_500, 6) },
      aisle_config: { wallBufferMm: 0, tableSpacingMm: 1200 },
      area_mm: [2000, 3000, 20_000, 12_000],
      existing_mm: [],
      direction: 'across',
    });
  });

  it("sends a drawn shape by its corners, and the rows' direction", () => {
    const corners = [p(0, 0), p(12_000, 0), p(12_000, 4000), p(4000, 4000), p(4000, 12_000)];
    const request = fillRequest(
      aLayout([]),
      TYPES,
      'square',
      { kind: 'shape', corners },
      { count: 12, direction: 'down', aisleMm: 900 },
    );

    expect(request.area_mm).toBeUndefined();
    expect(request.area_polygon_mm).toEqual(corners.map(({ xMm, yMm }) => [xMm, yMm]));
    expect(request.direction).toBe('down');
    expect(request.aisle_config.tableSpacingMm).toBe(900);
    expect(request.table_types[0]).toMatchObject({ id: 'square', width_mm: 1220, height_mm: 1220 });
    expect(request.counts).toEqual({ square: 12 });
  });

  it('sends each table that stands by its four corners as it is turned, and each zone', () => {
    const turned = { ...table('a', 'gold', 1, 10_000, 10_000), rotation: 90 };
    const zone = { id: 'z', label: 'Stage', xMm: 1000, yMm: 2000, widthMm: 4000, depthMm: 3000 };
    const request = fillRequest(
      aLayout([turned], [zone]),
      TYPES,
      'six-foot',
      { kind: 'box', box: { left: 0, top: 0, right: 5000, bottom: 5000 } },
      { count: 5, direction: 'across', aisleMm: 1200 },
    );

    const [corners] = request.existing_mm;
    expect(corners).toHaveLength(4);
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    // A quarter turn: 760 mm across the page and 1830 mm down it.
    expect(Math.min(...xs)).toBeCloseTo(10_000 - 380, 6);
    expect(Math.max(...xs)).toBeCloseTo(10_000 + 380, 6);
    expect(Math.min(...ys)).toBeCloseTo(10_000 - 915, 6);
    expect(Math.max(...ys)).toBeCloseTo(10_000 + 915, 6);
    expect(request.obstacles).toEqual([
      {
        polygon: [
          [1000, 2000],
          [5000, 2000],
          [5000, 5000],
          [1000, 5000],
        ],
        type: 'no_table_zone',
      },
    ]);
  });

  it('asks for no more than the placement places at a time, nor than the layout has room for', () => {
    const area = { kind: 'box', box: { left: 0, top: 0, right: 5000, bottom: 5000 } } as const;
    const choices = { direction: 'across', aisleMm: 1200 } as const;
    const many = Array.from({ length: 990 }, (_, i) => table(`t${i}`, null, null));

    const fit = fillRequest(aLayout([]), TYPES, 'six-foot', area, { ...choices, count: null });
    const nearlyFull = fillRequest(aLayout(many), TYPES, 'six-foot', area, {
      ...choices,
      count: 30,
    });

    expect(MAX_FILL_TABLES).toBe(500);
    expect(fit.counts).toEqual({ 'six-foot': 500 });
    expect(nearlyFull.counts).toEqual({ 'six-foot': 10 });
  });

  it('reads the count typed: a whole number from 1 to the 500 one fill places, else none', () => {
    expect(countOf('30')).toBe(30);
    expect(countOf('500')).toBe(500);
    expect(countOf('501')).toBeNull();
    expect(countOf(' 7 ')).toBe(7);
    expect(countOf('0')).toBeNull();
    expect(countOf('-3')).toBeNull();
    expect(countOf('2.5')).toBeNull();
    expect(countOf('')).toBeNull();
    expect(countOf('many')).toBeNull();
  });
});

describe('what the tool says of the answer', () => {
  it('says all that were asked for', () => {
    expect(saidFilled(30, 30, false)).toBe('Placed 30.');
  });

  it('says how many of those asked for fitted', () => {
    expect(saidFilled(24, 30, false)).toBe('Placed 24 of 30; the rest did not fit.');
  });

  it('says when the placement ran out of time', () => {
    expect(saidFilled(24, 30, true)).toBe(
      'Placed 24 of 30 - Fill an area ran out of time before the rest.',
    );
  });

  it('says how many fitted when as many as fit were asked for', () => {
    expect(saidFilled(137, null, false)).toBe('Placed 137.');
    expect(saidFilled(1, null, false)).toBe('Placed 1.');
    expect(saidFilled(40, null, true)).toBe(
      'Placed 40 - Fill an area ran out of time before the rest.',
    );
  });

  it('says so when nothing fitted', () => {
    expect(saidFilled(0, 30, false)).toBe(NOTHING_FITS);
    expect(saidFilled(0, null, false)).toBe(NOTHING_FITS);
    expect(saidFilled(0, 30, true)).toBe(
      'Placed 0 of 30 - Fill an area ran out of time before the rest.',
    );
  });

  it('says the layout is full where it had room for fewer than were asked for, and all of those stand', () => {
    expect(saidFilled(10, 30, false, 10)).toBe(
      'Placed 10 of 30. A layout holds at most 1,000 tables.',
    );
    expect(saidFilled(10, null, false, 10)).toBe('Placed 10. A layout holds at most 1,000 tables.');
    // Fewer than the layout had room for: the area was what stopped it.
    expect(saidFilled(6, 30, false, 10)).toBe('Placed 6 of 30; the rest did not fit.');
  });

  it('says a fill places 500 at a time where as many as fit came to that', () => {
    expect(saidFilled(500, null, false, 500)).toBe(
      'Placed 500, the most one fill places. Fill again for more.',
    );
    expect(saidFilled(500, 500, false, 500)).toBe('Placed 500.');
    expect(saidFilled(499, null, false, 500)).toBe('Placed 499.');
  });

  it('names the area in the dialog by its size or its corners', () => {
    expect(areaSaid({ kind: 'box', box: { left: 0, top: 0, right: 12_040, bottom: 8000 } })).toBe(
      'A box 12.0 m by 8.0 m',
    );
    expect(
      areaSaid({ kind: 'shape', corners: [p(0, 0), p(1, 0), p(1, 1), p(0, 1), p(0, 0.5)] }),
    ).toBe('A shape of 5 corners');
  });
});

describe('the shape being drawn', () => {
  it('is never in the layout: corners are laid, moved and taken back with nothing saved', () => {
    const { fill, tables, save, editor } = aTool([table('a', 'gold', 1)]);

    fill.addPoint(p(1000, 1000));
    fill.addPoint(p(9000, 1000));
    fill.addPoint(p(9000, 7000));
    fill.movePoint(1, p(8000, 1000));
    expect(fill.points.value).toEqual([p(1000, 1000), p(8000, 1000), p(9000, 7000)]);
    expect(fill.takePoint()).toBe(true);
    expect(fill.points.value).toHaveLength(2);
    expect(fill.pending.value).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(tables()).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
    expect(editor.canUndo.value).toBe(false);
  });

  it('is drawn through the pointer while it is over the map, and through its corners alone once the keys have it', () => {
    const { fill } = aTool();
    fill.addPoint(p(1000, 1000));
    fill.addPoint(p(9000, 1000));

    fill.hoverAt(p(9000, 7000));
    expect(fill.outline.value).toEqual([p(1000, 1000), p(9000, 1000), p(9000, 7000)]);

    fill.moveCrosshair(p(5000, 5000));
    expect(fill.outline.value).toEqual([p(1000, 1000), p(9000, 1000)]);
    expect(fill.crosshair.value).toEqual(p(5000, 5000));
  });

  it('closes into an area of three corners or more, and no further corner is laid on it', () => {
    const { fill } = aTool();
    fill.addPoint(p(1000, 1000));
    fill.addPoint(p(9000, 1000));
    expect(fill.closable.value).toBe(false);
    expect(fill.close()).toBe(AREA_NEEDS_THREE);
    expect(fill.area.value).toBeNull();

    fill.addPoint(p(9000, 7000));
    expect(fill.closable.value).toBe(true);
    expect(fill.close()).toBeNull();
    expect(fill.area.value).toEqual({
      kind: 'shape',
      corners: [p(1000, 1000), p(9000, 1000), p(9000, 7000)],
    });
    fill.addPoint(p(1000, 7000));
    expect(fill.points.value).toHaveLength(3);
  });

  it('counts a corner laid on the one before it once', () => {
    const { fill } = aTool();
    fill.addPoint(p(1000, 1000));
    fill.addPoint(p(9000, 1000));
    fill.addPoint(p(9000, 1000));

    expect(fill.closable.value).toBe(false);
    expect(fill.close()).toBe(AREA_NEEDS_THREE);
  });

  it('cannot be closed while its sides cross, and can once a corner is moved', () => {
    const { fill } = aTool();
    for (const corner of [p(0, 0), p(8000, 0), p(0, 6000), p(8000, 6000)]) fill.addPoint(corner);

    expect(fill.crosses.value).toBe(true);
    expect(fill.close()).toBe(AREA_CROSSES);
    expect(fill.area.value).toBeNull();
    expect(fill.points.value).toHaveLength(4);

    fill.movePoint(2, p(8000, 6000));
    fill.movePoint(3, p(0, 6000));
    expect(fill.crosses.value).toBe(false);
    expect(fill.close()).toBeNull();
  });

  it('is a box when dragged: the area between the press and the release', () => {
    const { fill } = aTool();

    fill.dragTo([p(9000, 7000), p(1000, 1000)]);
    expect(fill.pending.value).toBe(true);
    expect(fill.box.value).toEqual({ left: 1000, top: 1000, right: 9000, bottom: 7000 });
    expect(fill.closeBox()).toBe(true);

    expect(fill.area.value).toEqual({
      kind: 'box',
      box: { left: 1000, top: 1000, right: 9000, bottom: 7000 },
    });
    expect(fill.box.value).toBeNull();
  });

  it('is no box when the drag ran along one line: it encloses no floor', () => {
    const { fill } = aTool();

    fill.dragTo([p(1000, 5000), p(9000, 5000)]);
    expect(fill.closeBox()).toBe(false);
    expect(fill.area.value).toBeNull();
    expect(fill.pending.value).toBe(false);

    fill.dragTo([p(0, 1000), p(0, 9000)]);
    expect(fill.closeBox()).toBe(false);
    expect(fill.area.value).toBeNull();
  });

  it('closes with 50 corners and not with 51', () => {
    const { fill } = aTool();
    const round = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        p(
          15_000 + 9000 * Math.cos((2 * Math.PI * i) / count),
          11_000 + 9000 * Math.sin((2 * Math.PI * i) / count),
        ),
      );

    for (const corner of round(51)) fill.addPoint(corner);
    expect(fill.close()).toBe(AREA_HAS_TOO_MANY);
    expect(fill.area.value).toBeNull();

    fill.drop();
    for (const corner of round(50)) fill.addPoint(corner);
    expect(fill.close()).toBeNull();
  });

  it('given up, a drawn shape is its corners again and a box is gone', () => {
    const { fill } = aTool();
    for (const corner of [p(0, 0), p(8000, 0), p(8000, 6000)]) fill.addPoint(corner);
    fill.close();

    fill.cancel();
    expect(fill.area.value).toBeNull();
    expect(fill.points.value).toHaveLength(3);
    expect(fill.pending.value).toBe(true);

    expect(fill.drop()).toBe(true);
    expect(fill.pending.value).toBe(false);
    fill.dragTo([p(0, 0), p(5000, 5000)]);
    fill.closeBox();
    fill.cancel();
    expect(fill.area.value).toBeNull();
    expect(fill.pending.value).toBe(false);
    expect(fill.drop()).toBe(false);
  });
});

describe('the answer', () => {
  const answer = (tables: ReturnType<typeof placed>[], timedOut = false): FillAnswer => ({
    placed_tables: tables,
    timed_out: timedOut,
  });

  it("is added as ordinary tables of the section and type chosen, numbered on from the section's own in reading order, selected", () => {
    const { fill, tables, editor } = aTool([table('a', 'gold', 1), table('b', 'gold', 2, 8000)]);
    fill.dragTo([p(0, 10_000), p(10_000, 20_000)]);
    fill.closeBox();

    // The second row first, as no placement answers but a careless one.
    const added = fill.add(
      answer([
        placed(915, 12_330),
        placed(2745, 12_330),
        placed(915, 10_380),
        placed(2745, 10_380),
      ]),
    );

    expect(added.map((one) => [one.number, one.xMm, one.yMm])).toEqual([
      [3, 915, 10_380],
      [4, 2745, 10_380],
      [5, 915, 12_330],
      [6, 2745, 12_330],
    ]);
    expect(added.every((one) => one.sectionId === 'gold' && one.tableTypeId === 'six-foot')).toBe(
      true,
    );
    expect(tables()).toHaveLength(6);
    expect(editor.selection.value).toEqual(added.map((one) => one.id));
    expect(fill.area.value).toBeNull();
    expect(fill.pending.value).toBe(false);
  });

  it('keeps the turn of rows that run down the page', () => {
    const { fill } = aTool();
    fill.dragTo([p(0, 0), p(5000, 10_000)]);
    fill.closeBox();

    const added = fill.add(answer([placed(380, 915, 90), placed(380, 2745, 90)]));

    expect(added.map((one) => one.rotation)).toEqual([90, 90]);
  });

  it('is one step of undo, however many tables it holds', () => {
    const { fill, tables, editor } = aTool([table('a', 'gold', 1)]);
    fill.dragTo([p(0, 10_000), p(20_000, 20_000)]);
    fill.closeBox();
    fill.add(answer(Array.from({ length: 30 }, (_, i) => placed(915 + i * 500, 12_000))));
    expect(tables()).toHaveLength(31);

    editor.undo();

    expect(tables()).toHaveLength(1);
    expect(editor.canUndo.value).toBe(false);
  });

  it('adds tables in no section where none is chosen, numberless', () => {
    const { fill, chosen } = aTool();
    chosen.sectionId = null;

    const added = fill.add(answer([placed(915, 380)]));

    expect(added).toMatchObject([{ sectionId: null, number: null }]);
  });

  it('that holds no table changes nothing, and the area is done with', () => {
    const { fill, editor, tables } = aTool();
    fill.dragTo([p(0, 0), p(500, 500)]);
    fill.closeBox();

    expect(fill.add(answer([]))).toEqual([]);

    expect(tables()).toHaveLength(0);
    expect(editor.canUndo.value).toBe(false);
    expect(fill.area.value).toBeNull();
  });

  it('never fills a layout past the most it holds', () => {
    const full = Array.from({ length: 1000 }, (_, i) => table(`t${i}`, null, null));
    const area = { kind: 'box', box: { left: 0, top: 0, right: 5000, bottom: 5000 } } as const;

    const request = fillRequest(aLayout(full), TYPES, 'six-foot', area, {
      count: 30,
      direction: 'across',
      aisleMm: 1200,
    });

    expect(request.counts).toEqual({ 'six-foot': 0 });
    expect(LAYOUT_IS_FULL).toBe('A layout holds at most 1,000 tables.');
  });
});
