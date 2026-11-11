/**
 * The Row of tables tool's model (T257): the path being drawn, the row it would place, and the
 * placing. `LayoutEditor.vue` turns the pointer and the keys into its actions and draws what it
 * holds (`LayoutRowPreview.vue`); the geometry is `layoutGeometry.ts`'s.
 *
 * A path is the points clicked so far, with the pointer's place after them while it is over the
 * map, or the two ends of a straight drag. The row shown is always the row that placing would
 * add: the smooth path through those points (`smoothRuns`), lined with tables of the options
 * strip's type on the side chosen (`placeAlongRuns`), clear of the tables and no-table zones that
 * stand already and inside the floorplan. Nothing of a pending path is in the layout: it is not
 * saved, not a step of undo, and it is dropped whole. Placed, the tables are ordinary tables,
 * numbered on in their section in the order drawn, selected, and one step of undo.
 */
import { computed, reactive, shallowRef, type ComputedRef, type ShallowRef } from 'vue';
import type { FloorplanObject, FloorplanTable, TableTypeObject } from '@/assets/types/datatypes';
import {
  STANDARD_TABLE,
  cornersOf,
  hallOf,
  placeAlongRuns,
  smoothRuns,
  snapPoint,
  tableCorners,
  type Hall,
  type PathPose,
  type PointMm,
  type RowSide,
  type Run,
  type SizeMm,
} from './layoutGeometry';
import type { LayoutEditor, NewTable } from './useLayoutEditor';

/** The most tables a layout holds: the server's `MAX_PLACED_TABLES` (`floorplan_limits.py`). */
export const MAX_LAYOUT_TABLES = 1000;

/**
 * What the options strip holds for a row, kept while the app is open, so the side chosen for one
 * wall is the side the next row starts on: the side of the line the tables stand on, whether they
 * are centred on it instead, and the gap between them in centimetres, as typed.
 */
export const rowChoices = reactive({
  side: 'right' as 'right' | 'left',
  centred: false,
  gapCm: '0',
});

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
  /** Whether a path is being drawn: a point is laid, or a straight drag is in hand. */
  pending: ComputedRef<boolean>;
  /** The smooth path through the points, and the pointer's place while it is over the map. */
  runs: ComputedRef<Run[]>;
  /** The row that placing would add. */
  poses: ComputedRef<PathPose[]>;
  /** The size of the tables it would add. */
  size: ComputedRef<SizeMm>;
  /** Where the count is written: at the pointer, else at the last point. */
  countAt: ComputedRef<PointMm | null>;
  side: ComputedRef<RowSide>;
  /** A point snapped to the tables near it, within `withinMm`: to a corner, else to the line of
   *  an edge up to `reachMm` past its end. */
  snapped(at: PointMm, withinMm: number, reachMm?: number): PointMm;
  /** The point within `withinMm` of a place, by its index; null where none is. */
  pointNear(at: PointMm, withinMm: number): number | null;
  addPoint(at: PointMm): void;
  /** Take the last point back; false when there was none. */
  takePoint(): boolean;
  movePoint(index: number, to: PointMm): void;
  /** Where the pointer is over the map; null once it has left, or the keys have the path. */
  hoverAt(at: PointMm | null): void;
  /** A straight drag in hand, from its press to where it is now; null ends it unplaced. */
  dragTo(ends: [PointMm, PointMm] | null): void;
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
  const drag = shallowRef<[PointMm, PointMm] | null>(null);
  const crosshair = shallowRef<PointMm | null>(null);

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
    if (drag.value) return drag.value;
    return hover.value && points.value.length ? [...points.value, hover.value] : points.value;
  });
  const runs = computed(() => smoothRuns(path.value));
  const poses = computed(() => {
    const now = layout();
    if (!now || !runs.value.length) return [];
    return placeAlongRuns(runs.value, {
      ...size.value,
      gapMm: gapMmOf(rowChoices.gapCm),
      side: side.value,
      obstacles: shapes.value,
      extent: extentOf(hallOf(now)),
      maxCount: Math.max(0, MAX_LAYOUT_TABLES - now.tables.length),
    });
  });

  function clear() {
    points.value = [];
    hover.value = null;
    drag.value = null;
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
    pending: computed(() => points.value.length > 0 || drag.value !== null),
    runs,
    poses,
    size,
    countAt: computed(() => path.value.at(-1) ?? null),
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
      points.value = [...points.value, at];
    },
    takePoint() {
      if (!points.value.length) return false;
      points.value = points.value.slice(0, -1);
      return true;
    },
    movePoint(index, to) {
      points.value = points.value.map((point, at) => (at === index ? to : point));
    },
    hoverAt(at) {
      hover.value = at;
    },
    dragTo(ends) {
      drag.value = ends;
    },
    moveCrosshair(to) {
      crosshair.value = to;
      // The keys have the path: it is the points laid, wherever the pointer was left.
      hover.value = null;
    },
    flip() {
      rowChoices.side = rowChoices.side === 'right' ? 'left' : 'right';
    },
    drop() {
      const had = points.value.length > 0 || drag.value !== null;
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
