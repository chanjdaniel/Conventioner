/**
 * The Fill an area tool's model (T257): the area being drawn, what is asked of the placement for
 * it, and the adding of its answer. `LayoutEditor.vue` turns the pointer and the keys into its
 * actions, draws what it holds (`LayoutFillPreview.vue`) and asks the choices in a dialog
 * (`LayoutFillDialog.vue`).
 *
 * An area is a box, dragged, or a shape whose corners are clicked, with straight sides, closed
 * once it has three corners and no side crosses another. Nothing of it is in the layout: it is
 * not saved, not a step of undo, and it is dropped whole. Closed, it waits for the dialog; given
 * up there, a shape is its corners again, to be moved, and a box is gone.
 *
 * The placement (`POST /floorplans/place-tables`) is sent the area with the hall as its room, the
 * no-table zones, every table that stands, by its corners as it is turned, one table type, how
 * many of it, which way the rows run and the aisle between them. Its answer is added as ordinary
 * tables of the section and type chosen, numbered on in their section in reading order, selected,
 * as one step of undo.
 */
import { computed, reactive, shallowRef, type ComputedRef, type ShallowRef } from 'vue';
import type { FloorplanObject, FloorplanTable, TableTypeObject } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { metres } from './layoutDrawing';
import {
  STANDARD_TABLE,
  boxBetween,
  cornersOf,
  hallOf,
  polygonIsSimple,
  readingOrder,
  tableCorners,
  type Bounds,
  type PointMm,
  type SizeMm,
} from './layoutGeometry';
import { MAX_LAYOUT_TABLES } from './layoutRow';
import type { LayoutEditor, NewTable } from './useLayoutEditor';

/** The most tables one fill asks for: the server's `MAX_TABLES_TO_PLACE` (`floorplan_limits.py`). */
export const MAX_FILL_TABLES = 500;

/** What the dialog holds, kept while the app is open, so the next area is asked the same way:
 *  a count or as many as fit, the count as typed, which way the rows run, and the aisle between
 *  them in centimetres, as typed. */
export const fillChoices = reactive({
  howMany: 'count' as 'count' | 'fit',
  count: '30',
  direction: 'across' as 'across' | 'down',
  aisleCm: '120',
});

/** What `fillChoices` holds when the app opens. */
export const FILL_CHOICES_AT_FIRST = { ...fillChoices } as const;

/** An area to fill: a box, or a drawn shape by its corners. */
export type FillArea = { kind: 'box'; box: Bounds } | { kind: 'shape'; corners: PointMm[] };

/** What is chosen for one fill: how many tables (null: as many as fit), the rows' direction and
 *  the aisle between them. */
export interface FillChoice {
  count: number | null;
  direction: 'across' | 'down';
  aisleMm: number;
}

type Pair = [number, number];

/** The body of `POST /floorplans/place-tables` for an area, but for the market it names. */
export interface FillRequest {
  walls: [];
  obstacles: { polygon: Pair[]; type: 'no_table_zone' }[];
  table_types: {
    id: string;
    name: string;
    width_mm: number;
    height_mm: number;
    max_capacity: number;
  }[];
  counts: Record<string, number>;
  scale_px_per_mm: number;
  room_mm: { width_mm: number; height_mm: number };
  aisle_config: { wallBufferMm: number; tableSpacingMm: number };
  area_mm?: [number, number, number, number];
  area_polygon_mm?: Pair[];
  existing_mm: [Pair, Pair, Pair, Pair][];
  direction: 'across' | 'down';
}

/** The placement's answer: each table by its centre, and whether it ran out of time. */
export interface FillAnswer {
  placed_tables: { x_mm: number; y_mm: number; rotation: number }[];
  timed_out: boolean;
}

/** Said when a shape of fewer than three corners is asked to close. */
export const AREA_NEEDS_THREE = 'An area takes three corners or more.';
/** The most corners an area is drawn with: the server's `MAX_AREA_CORNERS`. */
const MAX_AREA_CORNERS = 50;
/** Said when a shape of more corners than that is asked to close. */
export const AREA_HAS_TOO_MANY = `An area takes ${MAX_AREA_CORNERS} corners at most. Take some back.`;
/** A box is an area once it is this wide and this deep, in millimetres. */
const MIN_BOX_MM = 1;
/** Said when a shape whose sides cross is asked to close. */
export const AREA_CROSSES =
  "This shape's sides cross. Move a corner, or take one back, so that they do not.";
/** Said when a drawn area is dropped unfilled. */
export const AREA_DROPPED = 'Area dropped. No table was added.';
/** Said when the placement fitted no table in the area. */
export const NOTHING_FITS = 'No table fits in that area.';
/** Said when a layout that holds the most it can is asked for more. */
export const LAYOUT_IS_FULL = `A layout holds at most ${MAX_LAYOUT_TABLES.toLocaleString('en')} tables.`;
/** What a fill that failed in transit says, the server having said nothing. */
export const FILL_FAILED = 'Could not fill the area. Try again in a moment.';

/** The count typed: a whole number from 1 to the most one fill places; null for a field that
 *  holds none. */
export function countOf(typed: string): number | null {
  const text = String(typed).trim();
  if (!/^\d+$/.test(text)) return null;
  const count = Number(text);
  return count >= 1 && count <= MAX_FILL_TABLES ? count : null;
}

/** The aisle typed in centimetres, in millimetres: nothing for a field that holds no length. */
/** The widest aisle the placement takes, in centimetres: the server's 10,000 mm. */
export const MAX_FILL_AISLE_CM = 1000;

/** The aisle typed, in millimetres: a number of centimetres from 0 to 1,000, a comma for the
 *  point taken; null for anything else, which the dialog says rather than reading as no aisle. */
export function aisleMmOf(typed: string): number | null {
  const text = String(typed).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const cm = Number(text);
  return cm <= MAX_FILL_AISLE_CM ? Math.round(cm * 10) : null;
}

const pair = (point: PointMm): Pair => [point.xMm, point.yMm];

/**
 * What is asked of the placement for an area: `count` tables of one type, or as many as fit
 * (null), never more than it places at a time or than the layout has room for.
 */
export function fillRequest(
  layout: FloorplanObject,
  tableTypes: readonly TableTypeObject[],
  tableTypeId: string,
  area: FillArea,
  choice: FillChoice,
): FillRequest {
  const sizeOf = (id: string): SizeMm =>
    tableTypes.find((type) => type.id === id) ?? STANDARD_TABLE;
  const type = tableTypes.find((one) => one.id === tableTypeId);
  const size = sizeOf(tableTypeId);
  const hall = hallOf(layout);
  const room = Math.max(0, MAX_LAYOUT_TABLES - layout.tables.length);
  return {
    walls: [],
    obstacles: layout.zones.map((zone) => ({
      polygon: cornersOf({
        left: zone.xMm,
        top: zone.yMm,
        right: zone.xMm + zone.widthMm,
        bottom: zone.yMm + zone.depthMm,
      }).map(pair),
      type: 'no_table_zone',
    })),
    table_types: [
      {
        id: tableTypeId,
        name: type?.name ?? 'Table',
        width_mm: size.widthMm,
        height_mm: size.depthMm,
        max_capacity: 1,
      },
    ],
    counts: { [tableTypeId]: Math.min(choice.count ?? MAX_FILL_TABLES, MAX_FILL_TABLES, room) },
    scale_px_per_mm: layout.scalePxPerUnit ?? 0,
    room_mm: { width_mm: hall?.widthMm ?? 0, height_mm: hall?.heightMm ?? 0 },
    aisle_config: { wallBufferMm: 0, tableSpacingMm: choice.aisleMm },
    ...(area.kind === 'box'
      ? {
          area_mm: [
            area.box.left,
            area.box.top,
            area.box.right - area.box.left,
            area.box.bottom - area.box.top,
          ],
        }
      : { area_polygon_mm: area.corners.map(pair) }),
    existing_mm: layout.tables.map(
      (table) =>
        tableCorners(table, sizeOf(table.tableTypeId)).map(pair) as [Pair, Pair, Pair, Pair],
    ),
    direction: choice.direction,
  };
}

/** Ask the placement to fill an area of a market's layout. */
export async function placeTables(marketId: string, request: FillRequest): Promise<FillAnswer> {
  const { data } = await api.post('/floorplans/place-tables', { market_id: marketId, ...request });
  return data as FillAnswer;
}

/**
 * What a fill did, in a sentence: "Placed 30.", "Placed 24 of 30; the rest did not fit." or,
 * when the placement ran out of time, "Placed 24 of 30 - Fill an area ran out of time before the
 * rest.". `asked` is null where as many as fit were asked for. `sent` is how many the placement
 * was asked for, fewer than `asked` where the layout had room for no more: placed whole, the
 * sentence says the layout is full, and of as many as fit, that a fill places 500 at a time.
 */
export function saidFilled(
  placed: number,
  asked: number | null,
  timedOut: boolean,
  sent: number = asked ?? MAX_FILL_TABLES,
): string {
  const short = asked !== null && placed < asked;
  const count = short ? `Placed ${placed} of ${asked}` : `Placed ${placed}`;
  if (timedOut) return `${count} - Fill an area ran out of time before the rest.`;
  if (placed >= sent && (short || asked === null)) {
    // Every table asked of the placement stands: what stopped it was a cap, not the area.
    return sent < MAX_FILL_TABLES
      ? `${count}. ${LAYOUT_IS_FULL}`
      : `${count}, the most one fill places. Fill again for more.`;
  }
  if (!placed) return NOTHING_FITS;
  return short ? `${count}; the rest did not fit.` : `${count}.`;
}

/** An area in words, for the dialog: "A box 12.0 m by 8.0 m", "A shape of 5 corners". */
export function areaSaid(area: FillArea): string {
  if (area.kind === 'shape') return `A shape of ${area.corners.length} corners`;
  const { left, top, right, bottom } = area.box;
  return `A box ${metres(right - left)} by ${metres(bottom - top)}`;
}

export interface FillToolOptions {
  editor: LayoutEditor;
  tableTypes: () => readonly TableTypeObject[];
  /** The section a new table takes; null is no section. */
  sectionId: () => string | null;
  /** The type a new table takes. */
  tableTypeId: () => string;
}

export interface FillTool {
  /** The corners clicked so far. */
  points: Readonly<ShallowRef<PointMm[]>>;
  /** The crosshair the keys move; null until the keys are on the map. */
  crosshair: Readonly<ShallowRef<PointMm | null>>;
  /** The box a drag in hand is drawing. */
  box: ComputedRef<Bounds | null>;
  /** Whether an area is being drawn: a corner is laid, or a box is in hand. */
  pending: ComputedRef<boolean>;
  /** Whether the shape has the corners to close: three or more, each a place of its own. */
  closable: ComputedRef<boolean>;
  /** Whether the pointer rests on the first corner of a shape that can be closed. */
  closing: Readonly<ShallowRef<boolean>>;
  /** Whether the shape, closed as it stands, would cross itself. */
  crosses: ComputedRef<boolean>;
  /** The corners, and the pointer's place after them while it is over the map. */
  outline: ComputedRef<PointMm[]>;
  /** The area closed, waiting to be filled. */
  area: Readonly<ShallowRef<FillArea | null>>;
  /** The corner within `withinMm` of a place, by its index; null where none is. */
  pointNear(at: PointMm, withinMm: number): number | null;
  addPoint(at: PointMm): void;
  /** Take the last corner back; false when there was none. */
  takePoint(): boolean;
  movePoint(index: number, to: PointMm): void;
  /** Where the pointer is over the map; null once it has left, or the keys have the shape. */
  hoverAt(at: PointMm | null): void;
  /** Show the shape closed while the pointer rests on its first corner. */
  hoverClose(on: boolean): void;
  /** A box in hand, from its press to where it is now; null ends it. */
  dragTo(ends: [PointMm, PointMm] | null): void;
  moveCrosshair(to: PointMm): void;
  /** Close the shape into an area: null when it closed, else the sentence for why it did not. */
  close(): string | null;
  /** Make the box in hand the area, and end the drag; false when none was, or it encloses no
   *  floor. */
  closeBox(): boolean;
  /** Give the closed area up unfilled: a shape is its corners again, a box is gone. */
  cancel(): void;
  /** Drop what is being drawn; false when there was nothing. */
  drop(): boolean;
  /** Drop everything and the crosshair's place, for another layout. */
  reset(): void;
  /** Add the placement's answer to the layout, selected, as one change, and clear the area: the
   *  tables added. */
  add(answer: FillAnswer): FloorplanTable[];
}

export function useFillTool(options: FillToolOptions): FillTool {
  const points = shallowRef<PointMm[]>([]);
  const hover = shallowRef<PointMm | null>(null);
  const drag = shallowRef<[PointMm, PointMm] | null>(null);
  const crosshair = shallowRef<PointMm | null>(null);
  const closing = shallowRef(false);
  const area = shallowRef<FillArea | null>(null);

  /** The corners that are places of their own: one laid on the last, or a last on the first, is
   *  no further corner. */
  const corners = computed(() => {
    const apart = (a: PointMm, b: PointMm) => Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm) >= 1;
    const own = points.value.filter((point, i, all) => i === 0 || apart(point, all[i - 1]));
    return own.length > 1 && !apart(own[0], own[own.length - 1]) ? own.slice(0, -1) : own;
  });
  const closable = computed(() => corners.value.length >= 3 && area.value === null);
  const crosses = computed(() => corners.value.length >= 3 && !polygonIsSimple(corners.value));

  function clear() {
    points.value = [];
    hover.value = null;
    drag.value = null;
    closing.value = false;
    area.value = null;
  }

  function add(answer: FillAnswer): FloorplanTable[] {
    const sectionId = options.sectionId();
    const tableTypeId = options.tableTypeId();
    const size: SizeMm =
      options.tableTypes().find((type) => type.id === tableTypeId) ?? STANDARD_TABLE;
    const placed: (NewTable & { rotation: number })[] = answer.placed_tables.map((table) => ({
      sectionId,
      tableTypeId,
      xMm: table.x_mm,
      yMm: table.y_mm,
      rotation: table.rotation,
    }));
    clear();
    if (!placed.length) return [];
    // Numbered as read: in rows from the top of the page, each from the left.
    const ordered = readingOrder(placed, () => size.depthMm);
    const ids = new Set(options.editor.addTables(ordered));
    options.editor.select([...ids]);
    return (options.editor.layout.value?.tables ?? []).filter((table) => ids.has(table.id));
  }

  return {
    points,
    crosshair,
    box: computed(() => (drag.value ? boxBetween(drag.value[0], drag.value[1]) : null)),
    pending: computed(() => points.value.length > 0 || drag.value !== null),
    closable,
    closing,
    crosses,
    outline: computed(() =>
      hover.value && points.value.length && !closing.value && area.value === null
        ? [...points.value, hover.value]
        : points.value,
    ),
    area,
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
      // A closed area takes no further corner: it is filled, or given up first.
      if (area.value) return;
      points.value = [...points.value, at];
      closing.value = false;
    },
    takePoint() {
      if (!points.value.length || area.value) return false;
      points.value = points.value.slice(0, -1);
      return true;
    },
    movePoint(index, to) {
      points.value = points.value.map((point, at) => (at === index ? to : point));
    },
    hoverAt(at) {
      hover.value = at;
      closing.value = false;
    },
    hoverClose(on) {
      closing.value = on;
    },
    dragTo(ends) {
      drag.value = ends;
    },
    moveCrosshair(to) {
      crosshair.value = to;
      // The keys have the shape: it is the corners laid, wherever the pointer was left.
      hover.value = null;
      closing.value = false;
    },
    close() {
      if (area.value) return null;
      if (corners.value.length < 3) return AREA_NEEDS_THREE;
      if (corners.value.length > MAX_AREA_CORNERS) return AREA_HAS_TOO_MANY;
      if (crosses.value) return AREA_CROSSES;
      area.value = { kind: 'shape', corners: corners.value };
      closing.value = false;
      hover.value = null;
      return null;
    },
    closeBox() {
      if (!drag.value) return false;
      const box = boxBetween(drag.value[0], drag.value[1]);
      drag.value = null;
      // A drag along one line, or along the floorplan's edge, encloses no floor.
      if (box.right - box.left < MIN_BOX_MM || box.bottom - box.top < MIN_BOX_MM) return false;
      area.value = { kind: 'box', box };
      return true;
    },
    cancel() {
      area.value = null;
    },
    drop() {
      const had = points.value.length > 0 || drag.value !== null || area.value !== null;
      clear();
      return had;
    },
    reset() {
      clear();
      crosshair.value = null;
    },
    add,
  };
}
