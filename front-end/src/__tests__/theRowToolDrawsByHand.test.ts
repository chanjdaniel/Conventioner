/**
 * The Row of tables tool's line drawn by hand (T257 ticket 15): a stroke in hand shows its row as
 * it reads; let go, a straight one is its two ends, placed as the straight drag was, and a curved
 * one becomes a pending path of a few points that is finished: it follows no pointer and takes no
 * further point, and is otherwise a clicked path. With the sentence the live region says of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FloorplanObject, FloorplanTable } from '@/assets/types/datatypes';
import { saidCurveDrawn } from '@/components/layout/layoutAnnouncements';
import { separation, tableCorners, type PointMm } from '@/components/layout/layoutGeometry';
import {
  MAX_STROKE_SAMPLES,
  ROW_CHOICES_AT_FIRST,
  STROKE_PX,
  rowChoices,
  strokeOptions,
  useRowTool,
} from '@/components/layout/layoutRow';
import type { SavedLayout } from '@/components/layout/layoutSave';
import { useLayoutEditor } from '@/components/layout/useLayoutEditor';
import { SHAPES, hand, p, sampled, truth } from './helpers/drawnByHand';

const SIX_FOOT = { id: 'six-foot', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 };
const TYPES = [SIX_FOOT];
/** How a drag is read at 100% zoom, 25 mm to the pixel. */
const STROKE = strokeOptions(0.04, false);
const SHIFT = strokeOptions(0.04, true);

/** A curve moved into the hall. */
const at = (curve: readonly PointMm[], dx: number, dy: number) =>
  curve.map((point) => p(point.xMm + dx, point.yMm + dy));
/** The S, the ring 10 m across and a quarter of a 5 m circle, as strokes with no hand in them. */
const S = at(sampled(SHAPES.s, 250), 8000, 3000);
const RING = at(sampled(SHAPES.ring, 250), 12_000, 6000);
const QUARTER = at(sampled(truth([{ len: (Math.PI / 2) * 5000, k: 1 / 5000 }]), 250), 8000, 8000);

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
    tableTypes: () => TYPES,
    newId: () => `new-${(id += 1)}`,
  });
  editor.adopt(aLayout(tables));
  const row = useRowTool({
    editor,
    tableTypes: () => TYPES,
    sectionId: () => 'gold',
    tableTypeId: () => 'six-foot',
  });
  return { editor, row, tables: () => editor.layout.value!.tables };
}

/** A tool with a curved stroke let go: the S, pending. */
function withTheSDrawn() {
  const tool = aTool();
  tool.row.strokeTo(S, STROKE);
  expect(tool.row.endStroke()).toBe('curve');
  return tool;
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(rowChoices, ROW_CHOICES_AT_FIRST);
});
afterEach(() => vi.useRealTimers());

describe("a stroke's numbers", () => {
  it('are screen pixels, turned into millimetres by the view', () => {
    expect(STROKE_PX).toEqual({
      keep: 2,
      step: 4,
      smooth: 16,
      tolerance: 12,
      gap: 8,
      close: 24,
      straight: 10,
      straightMost: 24,
    });
    expect(MAX_STROKE_SAMPLES).toBe(2000);
    expect(strokeOptions(0.04, false)).toEqual({
      stepMm: 100,
      smoothMm: 400,
      toleranceMm: 300,
      gapMm: 200,
      closeWithinMm: 600,
      straightWithinMm: 250,
      straightMostMm: 600,
      straight: false,
    });
    // Zoomed in four times, a quarter of the millimetres; Shift is the straight row.
    expect(strokeOptions(0.16, true)).toMatchObject({ toleranceMm: 75, straight: true });
  });
});

describe('a stroke in hand', () => {
  it('shows a straight row between its ends while it is nearly straight', () => {
    const { row } = aTool();
    expect(row.stroking.value).toBe(false);
    row.strokeTo(at(hand(SHAPES.line, 25, 1), 2000, 3000), STROKE);
    expect(row.stroking.value).toBe(true);
    expect(row.pending.value).toBe(true);
    expect(row.points.value).toEqual([]);
    expect(row.runs.value).toEqual([[p(2000, 3000), p(22_000, 3000)]]);
    expect(row.poses.value).toHaveLength(10);
    expect(row.countAt.value).toEqual(p(22_000, 3000));
    expect(row.closeAt.value).toBeNull();
  });

  it('shows the row along its smoothed line where it curves, the count at the pointer', () => {
    const { row } = aTool();
    row.strokeTo(S, STROKE);
    expect(row.points.value).toEqual([]);
    expect(row.runs.value).toHaveLength(1);
    // The line itself, a point every 100 mm, not a path through a few points.
    expect(row.runs.value[0].length).toBeGreaterThan(190);
    expect(row.poses.value).toHaveLength(10);
    expect(row.countAt.value).toEqual(S.at(-1));
    expect(row.drawn.value).toBe(false);
  });

  it('is the straight row from its press to the pointer while Shift is held, with no move', () => {
    const { row } = aTool();
    row.strokeTo(S, STROKE);
    const curved = row.runs.value;
    row.strokeTo(S, SHIFT);
    expect(row.runs.value).toEqual([[S[0], S.at(-1)]]);
    row.strokeTo(S, STROKE);
    expect(row.runs.value).toEqual(curved);
    // Read as it last was where no way of reading is given.
    row.strokeTo(S.slice(0, 40));
    expect(row.runs.value[0].length).toBeLessThan(curved[0].length);
  });

  it('is shown closed, its press ringed, once it has come back to where it began', () => {
    const { row } = aTool();
    row.strokeTo(RING.slice(0, 100), STROKE);
    expect(row.closeAt.value).toBeNull();
    row.strokeTo(RING, STROKE);
    expect(row.closeAt.value).toEqual(RING[0]);
    const [run] = row.runs.value;
    expect(run.at(-1)).toEqual(run[0]);
    // Spread evenly round it, as any closed shape's are.
    expect(row.poses.value).toHaveLength(14);
    expect(row.closed.value).toBe(false);
  });

  it('is dropped by `strokeTo(null)`, with nothing left pending and no table added', () => {
    const { row, tables } = aTool();
    row.strokeTo(S, STROKE);
    row.strokeTo(null);
    expect(row.stroking.value).toBe(false);
    expect(row.pending.value).toBe(false);
    expect(row.poses.value).toEqual([]);
    expect(row.endStroke()).toBe('none');
    expect(tables()).toEqual([]);
  });

  it('is dropped with the path, by `drop` and by `reset`', () => {
    const { row } = aTool();
    row.strokeTo(S, STROKE);
    expect(row.drop()).toBe(true);
    expect(row.pending.value).toBe(false);
    row.strokeTo(S, STROKE);
    row.reset();
    expect(row.pending.value).toBe(false);
  });

  it('does not begin over a path that is pending', () => {
    const { row } = aTool();
    row.addPoint(p(2000, 3000));
    row.strokeTo(S, STROKE);
    expect(row.stroking.value).toBe(false);
    expect(row.points.value).toEqual([p(2000, 3000)]);
  });

  it('is nothing while it is one place', () => {
    const { row } = aTool();
    row.strokeTo([p(2000, 3000), p(2000.4, 3000)], STROKE);
    expect(row.poses.value).toEqual([]);
    expect(row.endStroke()).toBe('none');
    expect(row.pending.value).toBe(false);
  });
});

describe('a straight stroke let go', () => {
  it("ends 'straight', its two ends the path, and places what the straight drag placed", () => {
    const { row, editor, tables } = aTool();
    row.strokeTo(at(hand(SHAPES.line, 25, 2), 2000, 3000), STROKE);
    expect(row.endStroke()).toBe('straight');
    expect(row.stroking.value).toBe(false);
    expect(row.drawn.value).toBe(false);
    expect(row.points.value).toEqual([p(2000, 3000), p(22_000, 3000)]);
    const added = row.place();
    expect(added.map((table) => table.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    added.forEach((table, i) => {
      expect(table.xMm).toBeCloseTo(2915 + i * 1830, 2);
      expect(table.yMm).toBeCloseTo(3380, 2);
      expect(table.rotation).toBe(0);
    });
    expect(editor.selection.value).toEqual(added.map((table) => table.id));
    expect(row.pending.value).toBe(false);
    // One step of undo.
    editor.undo();
    expect(tables()).toEqual([]);
  });

  it("ends 'straight' for a curve drawn with Shift held, from its press to its release", () => {
    const { row } = aTool();
    row.strokeTo(S, SHIFT);
    expect(row.endStroke()).toBe('straight');
    expect(row.points.value).toEqual([S[0], S.at(-1)]);
    expect(row.place()).toHaveLength(9);
  });
});

describe('a curved stroke let go', () => {
  it("ends 'curve', places nothing, and leaves its points as a path that is drawn", () => {
    const { row, tables } = withTheSDrawn();
    expect(row.stroking.value).toBe(false);
    expect(row.pending.value).toBe(true);
    expect(row.drawn.value).toBe(true);
    expect(row.closed.value).toBe(false);
    expect(row.points.value).toHaveLength(6);
    expect(row.points.value[0]).toEqual(S[0]);
    expect(row.points.value.at(-1)).toEqual(S.at(-1));
    expect(row.runs.value).toHaveLength(1);
    expect(row.poses.value).toHaveLength(10);
    // The count stands at its end.
    expect(row.countAt.value).toEqual(S.at(-1));
    expect(tables()).toEqual([]);
  });

  it('closes into a loop of 8 points where it came back to its start', () => {
    const { row } = aTool();
    row.strokeTo(RING, STROKE);
    expect(row.endStroke()).toBe('curve');
    expect(row.drawn.value).toBe(true);
    expect(row.closed.value).toBe(true);
    expect(row.points.value).toHaveLength(8);
    expect(row.poses.value).toHaveLength(14);
    expect(row.countAt.value).toEqual(row.points.value[0]);
    expect(row.closeAt.value).toBeNull();
  });

  it('follows no pointer and takes no further point', () => {
    const { row } = withTheSDrawn();
    const before = row.poses.value;
    row.hoverAt(p(25_000, 20_000));
    expect(row.poses.value).toEqual(before);
    expect(row.countAt.value).toEqual(S.at(-1));
    row.addPoint(p(25_000, 20_000));
    expect(row.points.value).toHaveLength(6);
    expect(row.poses.value).toEqual(before);
  });

  it('is re-laid by a point moved, the side flipped and the gap typed', () => {
    const { row } = withTheSDrawn();
    const before = row.poses.value;
    const second = row.points.value[1];
    row.movePoint(1, p(second.xMm + 1000, second.yMm));
    expect(row.points.value[1]).toEqual(p(second.xMm + 1000, second.yMm));
    expect(row.poses.value).not.toEqual(before);
    expect(row.drawn.value).toBe(true);
    const right = row.poses.value;
    row.flip();
    expect(rowChoices.side).toBe('left');
    expect(row.poses.value).not.toEqual(right);
    rowChoices.gapCm = '30';
    expect(row.poses.value.length).toBeLessThan(10);
  });

  it('is closed and opened again as a clicked path is', () => {
    const { row } = withTheSDrawn();
    expect(row.closable.value).toBe(true);
    expect(row.close()).toBe(true);
    expect(row.closed.value).toBe(true);
    expect(row.drawn.value).toBe(true);
    expect(row.open()).toBe(true);
    expect(row.closed.value).toBe(false);
    expect(row.points.value).toHaveLength(6);
  });

  it('gives its points back one by one, and at one point is a clicked path again', () => {
    const { row } = withTheSDrawn();
    for (let left = 5; left >= 2; left -= 1) {
      expect(row.takePoint()).toBe(true);
      expect(row.points.value).toHaveLength(left);
      expect(row.drawn.value).toBe(true);
    }
    expect(row.takePoint()).toBe(true);
    expect(row.points.value).toEqual([S[0]]);
    expect(row.drawn.value).toBe(false);
    // The next click lays a second point, and the pointer has the path again.
    row.hoverAt(p(20_000, 3000));
    expect(row.poses.value.length).toBeGreaterThan(0);
    row.addPoint(p(20_000, 3000));
    expect(row.points.value).toEqual([S[0], p(20_000, 3000)]);
  });

  it('opens a loop taken back under three points', () => {
    const { row } = aTool();
    row.strokeTo(RING, STROKE);
    row.endStroke();
    while (row.points.value.length > 2) row.takePoint();
    expect(row.closed.value).toBe(false);
    expect(row.drawn.value).toBe(true);
  });

  it('is placed as it is shown: ordinary tables, none over another, one step of undo', () => {
    const { row, editor, tables } = withTheSDrawn();
    const shown = row.poses.value;
    const added = row.place();
    expect(added).toHaveLength(10);
    added.forEach((table, i) => {
      expect(table.xMm).toBeCloseTo(shown[i].xMm, 2);
      expect(table.yMm).toBeCloseTo(shown[i].yMm, 2);
      expect(table.number).toBe(i + 1);
    });
    const shapes = added.map((table) => tableCorners(table, SIX_FOOT));
    for (let i = 0; i < shapes.length; i += 1) {
      for (let j = i + 1; j < shapes.length; j += 1) {
        expect(separation(shapes[i], shapes[j])).toBeGreaterThanOrEqual(-0.05);
      }
    }
    expect(row.pending.value).toBe(false);
    expect(row.drawn.value).toBe(false);
    editor.undo();
    expect(tables()).toEqual([]);
  });

  it('is ended by `drop` and by `reset`, the next path clicked as ever', () => {
    const dropped = withTheSDrawn();
    expect(dropped.row.drop()).toBe(true);
    expect(dropped.row.drawn.value).toBe(false);
    expect(dropped.row.points.value).toEqual([]);
    dropped.row.addPoint(p(2000, 3000));
    dropped.row.addPoint(p(8000, 3000));
    expect(dropped.row.points.value).toHaveLength(2);

    const reset = withTheSDrawn();
    reset.row.reset();
    expect(reset.row.drawn.value).toBe(false);
    expect(reset.row.pending.value).toBe(false);
  });

  it('is shown closed, its first point ringed, while the pointer rests on that point', () => {
    const { row } = withTheSDrawn();
    const open = row.poses.value.length;
    row.hoverClose(true);
    expect(row.closeAt.value).toEqual(S[0]);
    // Shown as a click there would make it: the path carried on from its last point to its first.
    expect(row.runs.value.flat().at(-1)).toEqual(row.runs.value[0][0]);
    expect(row.poses.value.length).toBeGreaterThan(open);
    row.hoverAt(null);
    expect(row.closeAt.value).toBeNull();
    expect(row.poses.value).toHaveLength(open);
  });
});

describe('what is said of a line drawn by hand', () => {
  it('says the points, the tables and how to place it', () => {
    expect(saidCurveDrawn(6, 10, false)).toBe(
      'Curve drawn through 6 points. 10 tables. Enter places it.',
    );
    expect(saidCurveDrawn(8, 14, true)).toBe(
      'Loop drawn through 8 points. 14 tables. Enter places it.',
    );
    expect(saidCurveDrawn(3, 1, false)).toBe(
      'Curve drawn through 3 points. 1 table. Enter places it.',
    );
  });

  it('says a quarter of a 5 m circle as three points and three tables', () => {
    const { row } = aTool();
    row.strokeTo(QUARTER, strokeOptions(0.02, false));
    expect(row.endStroke()).toBe('curve');
    expect(saidCurveDrawn(row.points.value.length, row.poses.value.length, row.closed.value)).toBe(
      'Curve drawn through 3 points. 3 tables. Enter places it.',
    );
  });
});
