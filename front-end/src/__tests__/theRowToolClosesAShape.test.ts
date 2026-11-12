/**
 * The Row of tables tool's closed shapes and parallel rows (T257 ticket 08): a path of three
 * points or more closes into a shape that stays pending, its tables spread evenly round it; Rows
 * and Aisle place several rows in the one gesture, numbered a row at a time; and an open path's
 * tables are spread to its ends where that is asked. With the sentences said of a closing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FloorplanObject, FloorplanTable } from '@/assets/types/datatypes';
import { SHAPE_NEEDS_THREE, saidClosed, saidOpened } from '@/components/layout/layoutAnnouncements';
import { separation, tableCorners } from '@/components/layout/layoutGeometry';
import {
  MAX_ROWS,
  ROW_CHOICES_AT_FIRST,
  rowChoices,
  rowsOf,
  strokeOptions,
  useRowTool,
} from '@/components/layout/layoutRow';
import type { SavedLayout } from '@/components/layout/layoutSave';
import { useLayoutEditor } from '@/components/layout/useLayoutEditor';

const SIX_FOOT = { id: 'six-foot', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 };
const p = (xMm: number, yMm: number) => ({ xMm, yMm });
/** How a drag is read at 100% zoom, 25 mm to the pixel, with Shift up. */
const STROKE = strokeOptions(0.04, false);

/** A hall 30 m by 22.5 m. */
function aLayout(tables: FloorplanTable[]): FloorplanObject {
  return {
    id: 'fp-1',
    locationId: 'loc-upper',
    revision: 3,
    imageGridfsId: 'image-1',
    imageWidth: 800,
    imageHeight: 600,
    scalePxPerUnit: 800 / 30_000,
    tables,
    zones: [],
    sectionStyles: [],
    startingCounts: [],
  };
}

function aTool(tables: FloorplanTable[] = []) {
  const save = vi.fn((layout: FloorplanObject): Promise<SavedLayout> =>
    Promise.resolve({ floorplan: { ...layout, revision: layout.revision + 1 }, sections: [] }),
  );
  let id = 0;
  const editor = useLayoutEditor({
    save,
    tableTypes: () => [SIX_FOOT],
    newId: () => `new-${(id += 1)}`,
  });
  editor.adopt(aLayout(tables));
  const row = useRowTool({
    editor,
    tableTypes: () => [SIX_FOOT],
    sectionId: () => 'gold',
    tableTypeId: () => 'six-foot',
  });
  return { editor, row, tables: () => editor.layout.value!.tables };
}

/** Eight points round a stage of 3 m radius in the middle of the hall, from its east side. */
const roundTheStage = Array.from({ length: 8 }, (_, i) => {
  const turn = (i * Math.PI) / 4;
  return p(15_000 + 3000 * Math.cos(turn), 11_000 + 3000 * Math.sin(turn));
});

const gapsRound = (tables: Pick<FloorplanTable, 'xMm' | 'yMm' | 'rotation'>[]) =>
  tables.map((table, i) =>
    separation(
      tableCorners(table, SIX_FOOT),
      tableCorners(tables[(i + 1) % tables.length], SIX_FOOT),
    ),
  );

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(rowChoices, ROW_CHOICES_AT_FIRST);
});
afterEach(() => vi.useRealTimers());

describe('a path closed into a shape', () => {
  it('cannot close with fewer than three points', () => {
    const { row } = aTool();
    row.addPoint(p(2000, 3000));
    row.addPoint(p(9000, 3000));
    expect(row.closable.value).toBe(false);
    expect(row.close()).toBe(false);
    expect(row.closed.value).toBe(false);
    row.addPoint(p(9000, 9000));
    expect(row.closable.value).toBe(true);
  });

  it('closes into a ring that stays pending, its tables spread evenly, the seam like the rest', () => {
    const { row, tables } = aTool();
    rowChoices.side = 'left';
    for (const point of roundTheStage) row.addPoint(point);
    const open = row.poses.value.length;
    expect(row.close()).toBe(true);
    expect(row.closed.value).toBe(true);
    expect(row.pending.value).toBe(true);
    expect(tables()).toEqual([]);
    expect(row.poses.value).toHaveLength(10);
    expect(row.poses.value.length).toBeGreaterThanOrEqual(open);
    const gaps = gapsRound(row.poses.value);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
    expect(Math.min(...gaps)).toBeGreaterThan(0);
    // Its count is written where it was closed, and the pointer no longer carries the path.
    expect(row.countAt.value).toEqual(roundTheStage[0]);
    row.hoverAt(p(1000, 1000));
    expect(row.poses.value).toHaveLength(10);
    expect(row.countAt.value).toEqual(roundTheStage[0]);
  });

  it('takes no further point, and opens again as it was', () => {
    const { row } = aTool();
    for (const point of roundTheStage) row.addPoint(point);
    const open = row.poses.value;
    row.close();
    row.addPoint(p(1000, 1000));
    expect(row.points.value).toHaveLength(8);
    expect(row.closable.value).toBe(false);
    expect(row.close()).toBe(false);
    expect(row.open()).toBe(true);
    expect(row.closed.value).toBe(false);
    expect(row.poses.value).toEqual(open);
    expect(row.open()).toBe(false);
  });

  it('is shown closed while the pointer rests on its first point, and not after', () => {
    const { row } = aTool();
    rowChoices.side = 'left';
    for (const point of roundTheStage) row.addPoint(point);
    row.hoverClose(true);
    expect(row.closing.value).toBe(true);
    expect(row.closed.value).toBe(false);
    expect(row.poses.value).toHaveLength(10);
    expect(row.runs.value[0].at(-1)).toEqual(row.runs.value[0][0]);
    row.hoverAt(p(1000, 1000));
    expect(row.closing.value).toBe(false);
    expect(row.runs.value.at(-1)!.at(-1)).toEqual(p(1000, 1000));
  });

  it('is shown open again once the keys take the path, or a point is laid', () => {
    const { row } = aTool();
    for (const point of roundTheStage.slice(0, 3)) row.addPoint(point);
    row.hoverClose(true);
    row.moveCrosshair(p(4000, 4000));
    expect(row.closing.value).toBe(false);
    row.hoverClose(true);
    row.addPoint(roundTheStage[3]);
    expect(row.closing.value).toBe(false);
    expect(row.runs.value[0].at(-1)).toEqual(roundTheStage[3]);
  });

  it('is no shape of three points on two places', () => {
    const { row } = aTool();
    row.addPoint(p(2000, 3000));
    row.addPoint(p(22_000, 3000));
    row.addPoint(p(2000, 3000));
    expect(row.closable.value).toBe(false);
    expect(row.close()).toBe(false);
    row.takePoint();
    // A point laid twice on one place is one corner.
    row.addPoint(p(22_000, 3000));
    expect(row.closable.value).toBe(false);
    row.addPoint(p(22_000, 9000));
    expect(row.closable.value).toBe(true);
  });

  it('shows nothing closed of a path too short to close', () => {
    const { row } = aTool();
    row.addPoint(p(2000, 3000));
    row.addPoint(p(22_000, 3000));
    row.hoverClose(true);
    expect(row.poses.value).toHaveLength(10);
  });

  it('is open again once a point taken back leaves it fewer than three', () => {
    const { row } = aTool();
    for (const point of roundTheStage.slice(0, 3)) row.addPoint(point);
    row.close();
    row.takePoint();
    expect(row.closed.value).toBe(false);
  });

  it('is placed as a ring numbered from the first point clicked, in the direction drawn', () => {
    const { row, tables, editor } = aTool();
    rowChoices.side = 'left';
    for (const point of roundTheStage) row.addPoint(point);
    row.close();
    const added = row.place();
    expect(added.map((table) => table.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(tables()).toHaveLength(10);
    expect(editor.selection.value).toHaveLength(10);
    const turnOf = (table: FloorplanTable) => {
      const turn = Math.atan2(table.yMm - 11_000, table.xMm - 15_000);
      return turn < 0 ? turn + 2 * Math.PI : turn;
    };
    const turns = added.map(turnOf);
    for (let i = 1; i < turns.length; i += 1) expect(turns[i]).toBeGreaterThan(turns[i - 1]);
    // As kept, rounded, no table is over another and the gaps are still one gap.
    const gaps = gapsRound(added);
    expect(Math.min(...gaps)).toBeGreaterThan(0);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
    // The next path begins open.
    expect(row.closed.value).toBe(false);
    expect(row.pending.value).toBe(false);
    editor.undo();
    expect(tables()).toEqual([]);
  });

  it('is dropped whole, closing and all', () => {
    const { row } = aTool();
    for (const point of roundTheStage) row.addPoint(point);
    row.close();
    expect(row.drop()).toBe(true);
    expect(row.closed.value).toBe(false);
    expect(row.points.value).toEqual([]);
  });
});

describe('several rows in one gesture', () => {
  it('reads the rows typed as a whole number from 1, no more than it may place', () => {
    expect(rowsOf('3')).toBe(3);
    expect(rowsOf(' 2 ')).toBe(2);
    expect(rowsOf('2.9')).toBe(2);
    expect(rowsOf('')).toBe(1);
    expect(rowsOf('0')).toBe(1);
    expect(rowsOf('-4')).toBe(1);
    expect(rowsOf('rows')).toBe(1);
    expect(rowsOf('500')).toBe(MAX_ROWS);
  });

  it('places two straight rows an aisle apart, the first row numbered whole, then the next', () => {
    const { row } = aTool();
    rowChoices.rows = '2';
    row.strokeTo([p(2000, 3000), p(22_000, 3000)], STROKE);
    expect(row.poses.value).toHaveLength(20);
    const added = row.place();
    expect(added.map((table) => table.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const first = added.slice(0, 10);
    const second = added.slice(10);
    for (const table of first) expect(table.yMm).toBeCloseTo(3380, 2);
    // A table's depth and the aisle of 120 cm on: 1.2 m of clear floor between the rows.
    for (const table of second) expect(table.yMm).toBeCloseTo(3380 + 760 + 1200, 2);
    expect(second.map((table) => table.xMm)).toEqual(first.map((table) => table.xMm));
  });

  it('holds the aisle typed, in centimetres, and stands rows back to back at none', () => {
    const { row } = aTool();
    rowChoices.rows = '2';
    rowChoices.aisleCm = '200';
    row.strokeTo([p(2000, 3000), p(22_000, 3000)], STROKE);
    expect(row.poses.value[10].yMm - row.poses.value[0].yMm).toBeCloseTo(760 + 2000, 6);
    rowChoices.aisleCm = '0';
    expect(row.poses.value[10].yMm - row.poses.value[0].yMm).toBeCloseTo(760, 6);
  });

  it('offsets the rows to the side the tables stand on', () => {
    const { row } = aTool();
    rowChoices.rows = '2';
    rowChoices.side = 'left';
    row.strokeTo([p(2000, 9000), p(22_000, 9000)], STROKE);
    expect(row.poses.value[0].yMm).toBeCloseTo(9000 - 380, 6);
    expect(row.poses.value[10].yMm).toBeCloseTo(9000 - 380 - 1960, 6);
  });

  it('places rings within rings round a closed shape', () => {
    const { row } = aTool();
    rowChoices.side = 'left';
    rowChoices.rows = '2';
    for (const point of roundTheStage) row.addPoint(point);
    row.close();
    const poses = row.poses.value;
    expect(poses.length).toBeGreaterThan(20);
    const inner = poses.slice(0, 10);
    const outer = poses.slice(10);
    const away = (pose: { xMm: number; yMm: number }) =>
      Math.hypot(pose.xMm - 15_000, pose.yMm - 11_000);
    expect(Math.max(...inner.map(away))).toBeLessThan(Math.min(...outer.map(away)));
    const gaps = gapsRound(outer);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
  });

  it('never shows more tables across its rows than the layout may still hold', () => {
    const standing = Array.from({ length: 985 }, (_, i) => ({
      id: `t-${i}`,
      sectionId: null,
      number: null,
      tableTypeId: 'six-foot',
      xMm: 29_000,
      yMm: 22_000,
      rotation: 0,
    }));
    const { row } = aTool(standing);
    rowChoices.rows = '2';
    row.strokeTo([p(2000, 3000), p(22_000, 3000)], STROKE);
    expect(row.poses.value).toHaveLength(15);
  });
});

describe('an open path spread evenly to its ends', () => {
  it('ends its last table at the end of the path where that is asked, the gaps equal', () => {
    const { row } = aTool();
    row.strokeTo([p(2000, 3000), p(22_000, 3000)], STROKE);
    const packed = row.poses.value;
    expect(packed.at(-1)!.xMm).toBeCloseTo(2000 + 18_300 - 915, 3);
    rowChoices.spread = true;
    const poses = row.poses.value;
    expect(poses).toHaveLength(10);
    expect(poses[0].xMm).toBeCloseTo(2915, 3);
    expect(poses.at(-1)!.xMm).toBeCloseTo(22_000 - 915, 1);
    const steps = poses.slice(1).map((pose, i) => pose.xMm - poses[i].xMm);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(0.1);
  });
});

describe('what is said of a closing', () => {
  it('says the shape closed with what it holds, opened again, and what a shape takes', () => {
    expect(saidClosed(10)).toBe('Closed. 10 tables.');
    expect(saidClosed(1)).toBe('Closed. 1 table.');
    expect(saidClosed(0)).toBe('Closed. No tables yet.');
    expect(saidOpened(9)).toBe('Opened again. 9 tables.');
    expect(SHAPE_NEEDS_THREE).toBe('A shape takes three points or more.');
  });
});
