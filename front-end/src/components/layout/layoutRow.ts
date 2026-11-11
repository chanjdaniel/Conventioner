/**
 * The Row of tables tool's model (T257): the path being drawn, the row it would place, and the
 * placing. `LayoutEditor.vue` turns the pointer and the keys into its actions and draws what it
 * holds (`LayoutRowPreview.vue`); the geometry is `layoutGeometry.ts`'s.
 *
 * A path is the points clicked so far, with the pointer's place after them while it is over the
 * map. The row shown is always the row that placing would add: the smooth path through those
 * points (`smoothRuns`), lined with tables of the options strip's type on the side chosen
 * (`placeRows`), clear of the tables and no-table zones that stand already and inside the
 * floorplan. Nothing of a pending path is in the layout: it is not saved, not a step of undo, and
 * it is dropped whole. Placed, the tables are ordinary tables, numbered on in their section in
 * the order drawn, selected, and one step of undo.
 *
 * With no path pending, a press and a drag draw the row's line by hand: a stroke. While it is in
 * hand the row is shown along the stroke as it reads (`readStroke`): the straight line between
 * its ends where it is nearly straight or Shift is held, else its smoothed line, closed where it
 * has come back to its start. Let go, a straight stroke is its two ends, for the editor to place
 * at once; any other becomes the path's points, a few places chosen on the smoothed line
 * (`fitStroke`), and waits as a clicked path does. Such a path is `drawn`: it is finished, so the
 * pointer's place is no part of it and it takes no further point, until it is placed, dropped or
 * taken back to one point.
 *
 * A path of three points or more can be closed: its last point joined to its first, smooth at
 * the seam as anywhere, its tables spread evenly round it. A closed path stays pending, to be
 * placed or opened again. The options strip's Rows and Aisle place that many rows in the one
 * gesture, each offset toward the tables' side, the first row numbered whole, then the next.
 */
import { computed, reactive, shallowRef, type ComputedRef, type ShallowRef } from 'vue';
import type { FloorplanObject, FloorplanTable, TableTypeObject } from '@/assets/types/datatypes';
import {
  STANDARD_TABLE,
  cornersOf,
  hallOf,
  fitStroke,
  placeAlongRuns,
  placeRows,
  readStroke,
  smoothRuns,
  snapPoint,
  strokeRuns,
  tableCorners,
  type Hall,
  type PathPose,
  type PointMm,
  type RowSide,
  type Run,
  type SizeMm,
  type StrokeOptions,
} from './layoutGeometry';
import type { LayoutEditor, NewTable } from './useLayoutEditor';

/** The most tables a layout holds: the server's `MAX_PLACED_TABLES` (`floorplan_limits.py`). */
export const MAX_LAYOUT_TABLES = 1000;

/** The most rows one gesture places. */
export const MAX_ROWS = 10;

/**
 * How a line drawn by hand is read, in screen pixels: a hand's precision is a matter of pixels,
 * and zooming in buys precision. `keep`: a pointer's move is kept as a sample when it is this
 * far from the last kept. `step`: the spacing the stroke is resampled to. `smooth`: the deviation
 * of the Gaussian that smooths it. `tolerance`: how far the fitted path may stand off the
 * smoothed stroke. `gap`: the least room between two points of the answer, so each can be
 * pressed. `close`: let go this near the press, having been twice as far from it, the stroke
 * closes. `straight` to `straightMost`: a stroke is straight when every sample is within 4% of
 * the chord of its line, never less than the one nor more than the other.
 */
export const STROKE_PX = {
  keep: 2,
  step: 4,
  smooth: 16,
  tolerance: 12,
  gap: 8,
  close: 24,
  straight: 10,
  straightMost: 24,
} as const;

/** The most samples a stroke keeps: at that many the editor drops every second one and keeps
 *  them twice as far apart from there on. */
export const MAX_STROKE_SAMPLES = 2000;

/** `STROKE_PX` in the map's millimetres at a zoom; `straight` is Shift held. */
export function strokeOptions(pxPerMm: number, straight: boolean): StrokeOptions {
  const mm = (px: number) => px / pxPerMm;
  return {
    stepMm: mm(STROKE_PX.step),
    smoothMm: mm(STROKE_PX.smooth),
    toleranceMm: mm(STROKE_PX.tolerance),
    gapMm: mm(STROKE_PX.gap),
    closeWithinMm: mm(STROKE_PX.close),
    straightWithinMm: mm(STROKE_PX.straight),
    straightMostMm: mm(STROKE_PX.straightMost),
    straight,
  };
}

/**
 * What the options strip holds for a row, kept while the app is open, so the side chosen for one
 * wall is the side the next row starts on: the side of the line the tables stand on, whether they
 * are centred on it instead, the gap between them in centimetres, as typed, how many rows and the
 * aisle between them in centimetres, as typed, and whether an open path's tables are spread
 * evenly to its ends.
 */
export const rowChoices = reactive({
  side: 'right' as 'right' | 'left',
  centred: false,
  gapCm: '0',
  rows: '1',
  aisleCm: '120',
  spread: false,
});

/** What `rowChoices` holds when the app opens. */
export const ROW_CHOICES_AT_FIRST = { ...rowChoices } as const;

/** The rows typed: a whole number from 1 to `MAX_ROWS`, 1 for a field that holds none. */
export function rowsOf(typed: string): number {
  const rows = Math.floor(Number(String(typed).trim()));
  return Number.isFinite(rows) && rows >= 1 ? Math.min(rows, MAX_ROWS) : 1;
}

/** The gap typed in centimetres, in millimetres: nothing for a field that holds no length. */
export function gapMmOf(typed: string): number {
  const cm = Number(String(typed).trim().replace(',', '.'));
  return Number.isFinite(cm) && cm > 0 ? Math.min(cm, 10_000) * 10 : 0;
}

/** What a row is never laid over: the tables as they stand turned, and the no-table zones. */
export function standingShapes(
  layout: Pick<FloorplanObject, 'tables' | 'zones'>,
  sizeOf: (table: FloorplanTable) => SizeMm,
): PointMm[][] {
  return [
    ...layout.tables.map((table) => tableCorners(table, sizeOf(table))),
    ...layout.zones.map((zone) =>
      cornersOf({
        left: zone.xMm,
        top: zone.yMm,
        right: zone.xMm + zone.widthMm,
        bottom: zone.yMm + zone.depthMm,
      }),
    ),
  ];
}

const extentOf = (hall: Hall | null) =>
  hall ? { widthMm: hall.widthMm, depthMm: hall.heightMm } : undefined;

/**
 * The quick straight row: up to `count` tables of a table's own size going on along its line,
 * `gapMm` apart, past whatever stands in the way and no further than the floorplan. It goes from
 * the end of the table that has the nearer free place: the end it is turned to, unless that way
 * is taken, as at the last table of a row, and the other is free.
 */
export function rowOnFrom(
  table: Pick<FloorplanTable, 'xMm' | 'yMm' | 'rotation'>,
  size: SizeMm,
  count: number,
  options: { gapMm: number; obstacles: readonly (readonly PointMm[])[]; hall: Hall | null },
): PathPose[] {
  const turn = (table.rotation * Math.PI) / 180;
  const from = size.widthMm / 2 + options.gapMm;
  // As far as the floorplan could hold a line, or the tables asked for where there is none.
  const reach = options.hall
    ? Math.hypot(options.hall.widthMm, options.hall.heightMm)
    : count * (size.widthMm + options.gapMm);
  const toward = (way: 1 | -1) => {
    const at = (far: number): PointMm => ({
      xMm: table.xMm + way * Math.cos(turn) * far,
      yMm: table.yMm + way * Math.sin(turn) * far,
    });
    return placeAlongRuns([[at(from), at(from + reach)]], {
      ...size,
      gapMm: options.gapMm,
      side: 'centre',
      obstacles: options.obstacles,
      extent: extentOf(options.hall),
      maxCount: count,
    });
  };
  const on = toward(1);
  // Free right beside the table: nothing nearer the other way.
  if (on[0]?.startS === 0) return on;
  const back = toward(-1);
  return (back[0]?.startS ?? Infinity) < (on[0]?.startS ?? Infinity) ? back : on;
}

export interface RowToolOptions {
  editor: LayoutEditor;
  tableTypes: () => readonly TableTypeObject[];
  /** The section a new table takes; null is no section. */
  sectionId: () => string | null;
  /** The type a new table takes. */
  tableTypeId: () => string;
}

export interface RowTool {
  /** The points clicked so far. */
  points: Readonly<ShallowRef<PointMm[]>>;
  /** The crosshair the keys move; null until the keys are on the map. */
  crosshair: Readonly<ShallowRef<PointMm | null>>;
  /** Whether a path is being drawn: a point is laid, or a stroke is in hand. */
  pending: ComputedRef<boolean>;
  /** Whether a stroke is in hand: a line being drawn by a drag, not yet let go. */
  stroking: ComputedRef<boolean>;
  /** Whether the pending path came from a curved stroke: it takes no further point, and the
   *  pointer's place is no part of it. */
  drawn: Readonly<ShallowRef<boolean>>;
  /** Whether the path has been closed into a shape, its last point joined to its first. */
  closed: Readonly<ShallowRef<boolean>>;
  /** Whether the path can be closed: it has three points or more, and is open. */
  closable: ComputedRef<boolean>;
  /** Whether the pointer rests on the first point of a path that can be closed: the path is
   *  shown closed, as a click there would make it. */
  closing: Readonly<ShallowRef<boolean>>;
  /** The point that wears a ring, since letting go there closes the path: the first point while
   *  the pointer rests on it, or a stroke's press while it has come back to it; else null. */
  closeAt: ComputedRef<PointMm | null>;
  /** The smooth path through the points, and the pointer's place while it is over the map. */
  runs: ComputedRef<Run[]>;
  /** The row that placing would add. */
  poses: ComputedRef<PathPose[]>;
  /** The size of the tables it would add. */
  size: ComputedRef<SizeMm>;
  /** Where the count is written: at the pointer, else at the last point; of a closed shape, at
   *  its first; of a stroke in hand, at the pointer. */
  countAt: ComputedRef<PointMm | null>;
  side: ComputedRef<RowSide>;
  /** A point snapped to the tables near it, within `withinMm`: to a corner, else to the line of
   *  an edge up to `reachMm` past its end. */
  snapped(at: PointMm, withinMm: number, reachMm?: number): PointMm;
  /** The point within `withinMm` of a place, by its index; null where none is. */
  pointNear(at: PointMm, withinMm: number): number | null;
  addPoint(at: PointMm): void;
  /** Close the path into a shape; false where it has fewer than three points or is closed. */
  close(): boolean;
  /** Open a closed path again, its points as they were; false where it was open. */
  open(): boolean;
  /** Show the path closed while the pointer rests on its first point. */
  hoverClose(on: boolean): void;
  /** Take the last point back; false when there was none. */
  takePoint(): boolean;
  movePoint(index: number, to: PointMm): void;
  /** Where the pointer is over the map; null once it has left, or the keys have the path. */
  hoverAt(at: PointMm | null): void;
  /** The stroke in hand: its samples from the press to the pointer, read by `options`; null
   *  drops it. Nothing while a path is pending. */
  strokeTo(samples: readonly PointMm[] | null, options?: StrokeOptions): void;
  /**
   * Let the stroke go. `'none'`: there was none, or it was no line. `'straight'`: its two ends
   * are the path, for the editor to place at once. `'curve'`: the points fitted to it are the
   * path's, closed where it came back to its start, and the path is `drawn`.
   */
  endStroke(): 'none' | 'straight' | 'curve';
  moveCrosshair(to: PointMm): void;
  /** Swap the side of the line the tables stand on. */
  flip(): void;
  /** Drop the path whole; false when there was none. */
  drop(): boolean;
  /** Drop the path and the crosshair's place, for another layout. */
  reset(): void;
  /** Add the row shown to the layout, selected, as one change, and clear the path: the tables
   *  added, none where no table fits. */
  place(): FloorplanTable[];
}

export function useRowTool(options: RowToolOptions): RowTool {
  const points = shallowRef<PointMm[]>([]);
  const hover = shallowRef<PointMm | null>(null);
  const stroke = shallowRef<{ samples: readonly PointMm[]; options: StrokeOptions } | null>(null);
  const drawn = shallowRef(false);
  const crosshair = shallowRef<PointMm | null>(null);
  const closed = shallowRef(false);
  const closing = shallowRef(false);
  /** The points that are places of their own: one laid on the last, or a last on the first, is
   *  no further corner of a shape. */
  const places = computed(() => {
    const apart = (a: PointMm, b: PointMm) => Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm) >= 1;
    const own = points.value.filter((point, i, all) => i === 0 || apart(point, all[i - 1]));
    return own.length > 1 && !apart(own[0], own[own.length - 1]) ? own.length - 1 : own.length;
  });
  const closable = computed(() => places.value >= 3 && !closed.value);
  /** The stroke in hand as it reads now. */
  const read = computed(() =>
    stroke.value ? readStroke(stroke.value.samples, stroke.value.options) : null,
  );
  /** The path is shown closed: it is, the pointer rests where a click would close it, or the
   *  stroke in hand has come back to its start. */
  const drawnClosed = computed(() =>
    read.value ? read.value.kind === 'closed' : closed.value || (closing.value && closable.value),
  );

  const layout = () => options.editor.layout.value;
  const typeSize = (id: string): SizeMm =>
    options.tableTypes().find((type) => type.id === id) ?? STANDARD_TABLE;
  const size = computed(() => typeSize(options.tableTypeId()));
  const side = computed<RowSide>(() => (rowChoices.centred ? 'centre' : rowChoices.side));

  /** The tables as they stand and the zones: reckoned when the layout changes, not each frame. */
  const shapes = computed(() => {
    const now = layout();
    return now ? standingShapes(now, (table) => typeSize(table.tableTypeId)) : [];
  });
  const tableShapes = computed(() => shapes.value.slice(0, layout()?.tables.length ?? 0));

  const path = computed<PointMm[]>(() => {
    if (drawnClosed.value || drawn.value) return points.value;
    return hover.value && points.value.length ? [...points.value, hover.value] : points.value;
  });
  // A stroke in hand is shown along its smoothed line itself, which holds still under the
  // pointer; its points are chosen once, when it is let go.
  const runs = computed(() =>
    read.value ? strokeRuns(read.value) : smoothRuns(path.value, { closed: drawnClosed.value }),
  );
  const poses = computed(() => {
    const now = layout();
    if (!now || !runs.value.length) return [];
    // The rows in order, the first whole and then the next: the order they are numbered in.
    return placeRows(runs.value, {
      ...size.value,
      gapMm: gapMmOf(rowChoices.gapCm),
      side: side.value,
      obstacles: shapes.value,
      extent: extentOf(hallOf(now)),
      maxCount: Math.max(0, MAX_LAYOUT_TABLES - now.tables.length),
      rows: rowsOf(rowChoices.rows),
      aisleMm: gapMmOf(rowChoices.aisleCm),
      // A closed shape's tables are always spread round it; an open path's where asked.
      spread: drawnClosed.value || rowChoices.spread,
    }).flat();
  });

  function clear() {
    points.value = [];
    hover.value = null;
    stroke.value = null;
    drawn.value = false;
    closed.value = false;
    closing.value = false;
  }

  function place(): FloorplanTable[] {
    const sectionId = options.sectionId();
    const tableTypeId = options.tableTypeId();
    const added: NewTable[] = poses.value.map((pose) => ({
      sectionId,
      tableTypeId,
      xMm: pose.xMm,
      yMm: pose.yMm,
      rotation: pose.rotation,
    }));
    clear();
    if (!added.length) return [];
    const ids = new Set(options.editor.addTables(added));
    options.editor.select([...ids]);
    return (layout()?.tables ?? []).filter((table) => ids.has(table.id));
  }

  return {
    points,
    crosshair,
    pending: computed(() => points.value.length > 0 || stroke.value !== null),
    stroking: computed(() => stroke.value !== null),
    drawn,
    closed,
    closable,
    closing,
    closeAt: computed(() => {
      if (read.value) return read.value.kind === 'closed' ? stroke.value!.samples[0] : null;
      return closing.value && closable.value ? points.value[0] : null;
    }),
    runs,
    poses,
    size,
    // A closed shape's count stands at its first point, where the click that closed it was.
    countAt: computed(() => {
      if (stroke.value) return stroke.value.samples.at(-1) ?? null;
      return (drawnClosed.value ? points.value[0] : path.value.at(-1)) ?? null;
    }),
    side,
    snapped: (at, withinMm, reachMm = 0) => snapPoint(at, tableShapes.value, withinMm, reachMm),
    pointNear(at, withinMm) {
      let nearest: number | null = null;
      let least = withinMm;
      points.value.forEach((point, index) => {
        const away = Math.hypot(point.xMm - at.xMm, point.yMm - at.yMm);
        if (away <= least) {
          nearest = index;
          least = away;
        }
      });
      return nearest;
    },
    addPoint(at) {
      // A closed shape takes no further point: it is placed, or opened again first. Nor does a
      // path drawn by hand, which is finished.
      if (closed.value || drawn.value) return;
      points.value = [...points.value, at];
      // A point laid is no longer the pointer resting on the first.
      closing.value = false;
    },
    close() {
      if (!closable.value) return false;
      closed.value = true;
      closing.value = false;
      hover.value = null;
      return true;
    },
    open() {
      if (!closed.value) return false;
      closed.value = false;
      return true;
    },
    hoverClose(on) {
      closing.value = on;
    },
    takePoint() {
      if (!points.value.length) return false;
      points.value = points.value.slice(0, -1);
      // Fewer than three points are no shape.
      if (points.value.length < 3) closed.value = false;
      // Taken back to one point, a path drawn by hand is a clicked path again.
      if (points.value.length < 2) drawn.value = false;
      return true;
    },
    movePoint(index, to) {
      points.value = points.value.map((point, at) => (at === index ? to : point));
    },
    hoverAt(at) {
      // A path drawn by hand is its points alone, wherever the pointer wanders after it.
      hover.value = drawn.value ? null : at;
      closing.value = false;
    },
    strokeTo(samples, strokeOptions) {
      if (!samples) {
        stroke.value = null;
        return;
      }
      const readBy = strokeOptions ?? stroke.value?.options;
      // A stroke begins a path: one pending is not drawn over.
      if (!readBy || points.value.length) return;
      stroke.value = { samples, options: readBy };
    },
    endStroke() {
      const held = stroke.value;
      const was = read.value;
      stroke.value = null;
      if (!held || !was || was.kind === 'none') return 'none';
      hover.value = null;
      closing.value = false;
      if (was.kind === 'straight') {
        points.value = [...was.ends];
        return 'straight';
      }
      const fit = fitStroke(held.samples, held.options);
      if (fit.points.length < 2) return 'none';
      points.value = fit.points;
      closed.value = fit.closed && fit.points.length >= 3;
      drawn.value = true;
      return 'curve';
    },
    moveCrosshair(to) {
      crosshair.value = to;
      // The keys have the path: it is the points laid, wherever the pointer was left.
      hover.value = null;
      closing.value = false;
    },
    flip() {
      rowChoices.side = rowChoices.side === 'right' ? 'left' : 'right';
    },
    drop() {
      const had = points.value.length > 0 || stroke.value !== null;
      clear();
      return had;
    },
    reset() {
      clear();
      crosshair.value = null;
    },
    place,
  };
}
