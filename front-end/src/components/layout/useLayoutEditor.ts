/**
 * A layout's editing model (T257): the working copy of one location's layout, the commands that
 * change its tables, undo and redo, and the queue that saves it.
 *
 * The working copy is never changed in place: every command puts a new layout in `layout`, so a
 * step of undo is the tables and the sections' styles as they stood, whole, and undo restores
 * data, which the drawing follows. Undo holds the last 200 steps, crosses saves, and is itself a
 * change that saves.
 *
 * A table whose section is no longer one of the location's (removed on Section Setup, or moved to
 * another location) is read as in no section, and the next change stores it so: without its
 * section and its number.
 *
 * The saves go through the app's one queue (`useAutosave.ts`), told to keep the working copy when
 * a save is refused: a change saves 600 ms after the last one, one write at a time, a change made
 * while a write is out sent when its answer is in, naming the revision that answer gave, and a
 * change still waiting when the page goes is sent on the way out. A write that fails or is refused
 * keeps the working copy and says so, for Retry or the next change to send again; one refused as
 * stale (another tab or person saved this layout in between) sends nothing more until the page
 * reloads the layout, since every later write would be refused the same way.
 *
 * A gesture (a drag, a turn by the handle) is one change: between `begin` and `end` a command
 * replaces the gesture's last one, drawn at once, and only `end` makes the step and the save.
 */
import { computed, shallowRef, type ComputedRef, type ShallowRef } from 'vue';
import { useAutosave } from '@/utils/useAutosave';
import type {
  FloorplanObject,
  FloorplanTable,
  SectionStyle,
  TableTypeObject,
} from '@/assets/types/datatypes';
import {
  STANDARD_TABLE,
  alignMoves,
  clampMove,
  clampToHall,
  closeGaps,
  cornersOf,
  duplicateOffset,
  hallOf,
  inNoSection,
  nextNumber,
  readingOrder,
  roundMm,
  roundTurn,
  sectionColors,
  shiftInside,
  spreadMoves,
  tableBounds,
  tableCorners,
  turnedAbout,
  type Alignment,
  type Bounds,
  type MoveMm,
  type PointMm,
} from './layoutGeometry';
import { SAVE_FAILED, STALE_LAYOUT, type SavedLayout } from './layoutSave';

/** How many steps undo holds. */
export const UNDO_STEPS = 200;
/**
 * How the layout's saves stand: `idle` with nothing to say, `saving` while a change waits or a
 * write is out, `saved` just after one landed, `failed` when one did not (Retry), `stale` when the
 * layout changed elsewhere (Reload).
 */
export type LayoutSaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'stale';

/** What a step of undo holds of a layout: its tables and its sections' styles, as they stood. */
type Step = Pick<FloorplanObject, 'tables' | 'sectionStyles'>;

const stepOf = (layout: FloorplanObject): Step => ({
  tables: layout.tables,
  sectionStyles: layout.sectionStyles,
});
const sameStep = (a: Step, b: Step) => a.tables === b.tables && a.sectionStyles === b.sectionStyles;

/** A table to add: where it stands and what it is; its id and number are the editor's to give. */
export interface NewTable {
  sectionId: string | null;
  tableTypeId: string;
  xMm: number;
  yMm: number;
  rotation?: number;
}

/** In the order of the numbers tables have, the numberless after them as they are stored. */
const byNumber = (a: FloorplanTable, b: FloorplanTable) =>
  a.number === b.number ? 0 : a.number === null ? 1 : b.number === null ? -1 : a.number - b.number;
const sameSpot = (a: PointMm, b: PointMm) => a.xMm === b.xMm && a.yMm === b.yMm;
const roundedPoint = (point: PointMm): PointMm => ({
  xMm: roundMm(point.xMm),
  yMm: roundMm(point.yMm),
});

export interface LayoutEditorOptions {
  /** The write: the layout and the revision it was read at, answered with the layout as stored. */
  save: (layout: FloorplanObject, revision: number) => Promise<SavedLayout>;
  /** Told of every answer, for the page to put into the market it shows. */
  onSaved?: (answer: SavedLayout) => void;
  /** The last try as the page goes: start a write that outlives it, true when one started. */
  saveOnUnload?: (layout: FloorplanObject, revision: number) => boolean;
  /** Whether this person may write the layout; unsaid, they may. */
  may?: () => boolean;
  /** Whether the market is a draft, where a removal's later neighbours close its gap. */
  draft?: () => boolean;
  /** The market's table types, which size the tables that are lined up, spaced and duplicated. */
  tableTypes?: () => readonly TableTypeObject[];
  /** The ids of the location's sections, in the plan's order. Unsaid, every section a table names
   *  is taken to stand. */
  sectionIds?: () => readonly string[];
  delayMs?: number;
  /** A new table's id. */
  newId?: () => string;
}

export interface LayoutEditor {
  /** The working copy; null before the location has a layout. */
  layout: Readonly<ShallowRef<FloorplanObject | null>>;
  /** The ids of the selected tables. */
  selection: Readonly<ShallowRef<string[]>>;
  /** Select the tables named, and no other. */
  select(ids: readonly string[]): void;
  saveState: ComputedRef<LayoutSaveState>;
  /** What a failed or stale save said. */
  saveMessage: ComputedRef<string>;
  canUndo: ComputedRef<boolean>;
  canRedo: ComputedRef<boolean>;
  /** Take the layout as the server has it, unless the working copy holds work it lacks. */
  adopt(stored: FloorplanObject | null): void;
  /** Drop the working copy for the server's, as Reload does after a stale save. */
  reload(stored: FloorplanObject | null): void;
  /** Write the layout's own fields (its start, its image, its scale) at once, outside undo. */
  write(next: FloorplanObject): Promise<boolean>;
  addTables(tables: readonly NewTable[]): string[];
  moveTables(ids: readonly string[], dxMm: number, dyMm: number): void;
  turnTables(ids: readonly string[], degrees: number, about?: PointMm): void;
  removeTables(ids: readonly string[]): void;
  /** Put tables in a section, numbered after its own in the order of the numbers they had, or in
   *  none (null), numberless; the sections they leave close their gaps. */
  setSection(ids: readonly string[], sectionId: string | null): void;
  setType(ids: readonly string[], tableTypeId: string): void;
  /** A copy of each table beside the originals (`duplicateOffset`), numbered on in its section;
   *  the copies' ids. */
  duplicate(ids: readonly string[]): string[];
  /** Line tables up by an edge or a centre of the boxes they stand in. */
  align(ids: readonly string[], how: Alignment): void;
  /** Space tables evenly across or down the page, the outer two staying. */
  distribute(ids: readonly string[], axis: 'across' | 'down'): void;
  /** Number a section's tables by where they stand: rows from the top, each from the left. */
  renumber(sectionId: string): void;
  /** Choose a section's colour of the palette, or where its name stands (null: beside its tables,
   *  where the drawing puts it). */
  setSectionStyle(sectionId: string, style: { color?: number; labelAt?: PointMm | null }): void;
  begin(): void;
  end(): void;
  cancel(): void;
  undo(): void;
  redo(): void;
  /** Send a failed save again. */
  retry(): void;
  /** Save what is pending now, and wait for it: null once the server holds it, else the sentence
   *  of the failure or refusal that stopped it. */
  flush(): Promise<string | null>;
  /** Whether the working copy holds a change no save has stored. */
  pending(): boolean;
  /** The last try as the page goes: true when a write that may outlive the page started. */
  sendOnUnload(): boolean;
}

export function useLayoutEditor(options: LayoutEditorOptions): LayoutEditor {
  const newId = options.newId ?? (() => crypto.randomUUID());

  const layout = shallowRef<FloorplanObject | null>(null);
  const selection = shallowRef<string[]>([]);
  const undone = shallowRef<Step[]>([]);
  const redone = shallowRef<Step[]>([]);

  /** The revision the server holds, as the last answer or read said it. */
  let revision = 0;
  /** A save was refused as stale: nothing more is sent until the server's layout is taken. */
  const stale = shallowRef(false);
  /** The layout as a gesture found it, and with every table of a section that is gone put in no
   *  section, which the gesture's frames are made from; reckoned once, at the first frame. */
  let gesture: { found: Step; from: Step | null } | null = null;
  /** Whether a write is out. */
  let writeOut = false;

  // ── The saves ──────────────────────────────────────────────────────────────

  const autosave = useAutosave({
    send: async () => {
      const held = layout.value;
      if (!held) return;
      // A gesture in hand is no change until it ends: a save whose wait runs out under one sends
      // the layout as the gesture found it, so a drag put back leaves the server holding what the
      // page shows.
      const sent = gesture ? { ...held, ...gesture.found } : held;
      writeOut = true;
      let answer: SavedLayout;
      try {
        answer = await options.save(sent, revision);
      } finally {
        writeOut = false;
      }
      revision = answer.floorplan.revision;
      const now = layout.value;
      if (now && now.id === answer.floorplan.id) {
        // What the server owns of a layout is taken from its answer; the rest is the working
        // copy's, which may hold a change made while this write was out.
        layout.value =
          now === held && sent === held
            ? { ...answer.floorplan, tables: now.tables, sectionStyles: now.sectionStyles }
            : {
                ...now,
                revision,
                locationId: answer.floorplan.locationId,
                startingCounts: answer.floorplan.startingCounts,
              };
      }
      options.onSaved?.(answer);
    },
    sendOnUnload: () => sendOnUnload(),
    afterSave: () => {},
    afterRefusal: (sentence) => {
      if (sentence === STALE_LAYOUT) stale.value = true;
    },
    may: () => options.may?.() ?? true,
    failure: SAVE_FAILED,
    keepOnRefusal: true,
    delay: options.delayMs,
  });

  const saveState = computed<LayoutSaveState>(() => {
    if (stale.value) return 'stale';
    const status = autosave.status.value;
    if (status === 'failed' || status === 'refused') return 'failed';
    if (status === 'saving' || autosave.unsaved.value) return 'saving';
    return status;
  });
  const saveMessage = computed(() => (stale.value ? STALE_LAYOUT : autosave.message.value));

  /**
   * The last try as the page goes. With a write out, this one names the revision that write will
   * leave: it was sent first and most likely lands first, and naming the revision read would have
   * this one refused as stale behind it.
   */
  function sendOnUnload(): boolean {
    const now = layout.value;
    if (!now || stale.value) return false;
    return Boolean(options.saveOnUnload?.(now, revision + (writeOut ? 1 : 0)));
  }

  function touch() {
    if (!stale.value) autosave.edited();
  }

  // ── Taking the server's layout ─────────────────────────────────────────────

  function take(stored: FloorplanObject | null) {
    autosave.forget();
    stale.value = false;
    layout.value = stored;
    revision = stored?.revision ?? 0;
    gesture = null;
    undone.value = [];
    redone.value = [];
    const ids = new Set((stored?.tables ?? []).map((table) => table.id));
    selection.value = selection.value.filter((id) => ids.has(id));
  }

  function adopt(stored: FloorplanObject | null) {
    const now = layout.value;
    if (!now || (stored && stored.id !== now.id)) {
      take(stored);
      return;
    }
    // Never under a gesture: the drag in hand would go on over tables it did not begin with.
    if (stored && stored.revision > revision && !autosave.unsaved.value && !gesture) take(stored);
  }

  async function write(next: FloorplanObject): Promise<boolean> {
    await autosave.flush();
    if (stale.value) return false;
    if (!layout.value || layout.value.id !== next.id) {
      take(null);
      revision = 0;
    }
    const before = layout.value;
    layout.value = {
      ...next,
      tables: before?.tables ?? next.tables,
      sectionStyles: before?.sectionStyles ?? next.sectionStyles,
    };
    touch();
    const landed = (await autosave.flush()) === null;
    // A write refused as stale never can land, so the page shows the layout as it read it, with
    // Reload; one that failed otherwise stays in the working copy for Retry to send.
    if (!landed && stale.value) layout.value = before;
    return landed;
  }

  // ── Changes ────────────────────────────────────────────────────────────────

  /**
   * Put a change in the working copy: a step of undo and a save, or a gesture's next frame. `make`
   * is given the layout as the change finds it, or as the gesture in hand found it, with every
   * table of a section that is gone already in no section, and answers what it changes; the same
   * tables and styles back is no change.
   */
  function alter(make: (from: Step, whole: FloorplanObject) => Partial<Step>) {
    const now = layout.value;
    if (!now) return;
    const found = gesture?.found ?? stepOf(now);
    const from = gesture?.from ?? normal(found);
    if (gesture) gesture.from = from;
    const made = { ...from, ...make(from, now) };
    if (gesture) {
      // A frame that comes back to where the gesture began is drawn like any other.
      if (!sameStep(made, stepOf(now))) layout.value = { ...now, ...made };
      return;
    }
    if (sameStep(made, from)) return;
    layout.value = { ...now, ...made };
    step(found);
  }

  /** A step with every table of a section that is gone put in no section; the same step when
   *  every section stands. */
  function normal(found: Step): Step {
    const sectionIds = options.sectionIds?.();
    if (!sectionIds) return found;
    const tables = inNoSection(found.tables, sectionIds) as FloorplanTable[];
    return tables === found.tables ? found : { ...found, tables };
  }

  /** A change of the tables alone. */
  function change(make: (tables: FloorplanTable[], whole: FloorplanObject) => FloorplanTable[]) {
    alter((from, whole) => ({ tables: make(from.tables, whole) }));
  }

  function step(from: Step) {
    undone.value = [...undone.value, from].slice(-UNDO_STEPS);
    redone.value = [];
    touch();
  }

  function keepSelection() {
    const ids = new Set((layout.value?.tables ?? []).map((table) => table.id));
    if (selection.value.some((id) => !ids.has(id))) {
      selection.value = selection.value.filter((id) => ids.has(id));
    }
  }

  function addTables(added: readonly NewTable[]): string[] {
    const ids: string[] = [];
    change((tables, whole) => {
      const hall = hallOf(whole);
      const next = [...tables];
      for (const table of added) {
        const at = clampToHall(table, hall);
        const id = newId();
        ids.push(id);
        next.push({
          id,
          sectionId: table.sectionId,
          number: table.sectionId === null ? null : nextNumber(next, table.sectionId),
          tableTypeId: table.tableTypeId,
          xMm: roundMm(at.xMm),
          yMm: roundMm(at.yMm),
          rotation: roundTurn(table.rotation ?? 0),
        });
      }
      return added.length ? next : tables;
    });
    return ids;
  }

  function moveTables(ids: readonly string[], dxMm: number, dyMm: number) {
    const moving = new Set(ids);
    change((tables, whole) => {
      const own = tables.filter((table) => moving.has(table.id));
      const by = clampMove(own, { dxMm, dyMm }, hallOf(whole));
      if (!own.length || (by.dxMm === 0 && by.dyMm === 0)) return tables;
      return tables.map((table) =>
        moving.has(table.id)
          ? { ...table, xMm: roundMm(table.xMm + by.dxMm), yMm: roundMm(table.yMm + by.dyMm) }
          : table,
      );
    });
  }

  function turnTables(ids: readonly string[], degrees: number, about?: PointMm) {
    const turning = new Set(ids);
    change((tables, whole) => {
      const own = tables.filter((table) => turning.has(table.id));
      if (!own.length || roundTurn(degrees) === 0) return tables;
      const hall = hallOf(whole);
      const xs = own.map((table) => table.xMm);
      const ys = own.map((table) => table.yMm);
      const centre = about ?? {
        xMm: (Math.min(...xs) + Math.max(...xs)) / 2,
        yMm: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
      // One table turns about its own centre, wherever the selection's is reckoned.
      const turned = own.map((table) =>
        turnedAbout(table, own.length === 1 ? table : centre, degrees),
      );
      // Tables carried past a wall come back inside together, keeping their places beside each
      // other; only a group wider than the hall is then held table by table.
      const back = shiftInside(turned, hall);
      const placed = new Map(
        turned.map((table) => {
          const at = clampToHall(
            { xMm: roundMm(table.xMm + back.dxMm), yMm: roundMm(table.yMm + back.dyMm) },
            hall,
          );
          return [table.id, { ...table, ...at }] as const;
        }),
      );
      return tables.map((table) => placed.get(table.id) ?? table);
    });
  }

  function removeTables(ids: readonly string[]) {
    const going = new Set(ids);
    change((tables) => {
      const left = tables.filter((table) => !going.has(table.id));
      if (left.length === tables.length) return tables;
      return options.draft?.() === false ? left : closeGaps(left);
    });
    keepSelection();
  }

  // ── Many tables at once ────────────────────────────────────────────────────

  const sizeOf = (table: FloorplanTable) =>
    options.tableTypes?.().find((type) => type.id === table.tableTypeId) ?? STANDARD_TABLE;

  function setSection(ids: readonly string[], sectionId: string | null) {
    const named = new Set(ids);
    change((tables) => {
      const joining = tables.filter(
        (table) => named.has(table.id) && table.sectionId !== sectionId,
      );
      if (!joining.length) return tables;
      const going = new Set(joining.map((table) => table.id));
      // Out of their sections first, so those close their gaps; then into the new one, after its
      // own, in the order of the numbers they had, the numberless after them as they are stored.
      const left = closeGaps(
        tables.map((table) =>
          going.has(table.id) ? { ...table, sectionId: null, number: null } : table,
        ),
      );
      if (sectionId === null) return left;
      const order = [...joining].sort(byNumber);
      const from = nextNumber(left, sectionId);
      const numbers = new Map(order.map((table, index) => [table.id, from + index]));
      return left.map((table) =>
        numbers.has(table.id) ? { ...table, sectionId, number: numbers.get(table.id)! } : table,
      );
    });
  }

  function setType(ids: readonly string[], tableTypeId: string) {
    const named = new Set(ids);
    change((tables) => {
      if (!tables.some((table) => named.has(table.id) && table.tableTypeId !== tableTypeId)) {
        return tables;
      }
      return tables.map((table) =>
        named.has(table.id) && table.tableTypeId !== tableTypeId
          ? { ...table, tableTypeId }
          : table,
      );
    });
  }

  function duplicate(ids: readonly string[]): string[] {
    const named = new Set(ids);
    const copies: string[] = [];
    change((tables, whole) => {
      // In the order of their sections' numbers, as they are stored among equals.
      const originals = tables.filter((table) => named.has(table.id)).sort(byNumber);
      if (!originals.length) return tables;
      const hall = hallOf(whole);
      const by = duplicateOffset(
        originals.map((table) => tableCorners(table, sizeOf(table))),
        [
          ...tables.map((table) => tableCorners(table, sizeOf(table))),
          ...whole.zones.map((zone) =>
            cornersOf({
              left: zone.xMm,
              top: zone.yMm,
              right: zone.xMm + zone.widthMm,
              bottom: zone.yMm + zone.depthMm,
            }),
          ),
        ],
        Math.min(...originals.map((table) => sizeOf(table).depthMm)),
        hall,
      );
      // Held inside the hall together, as a move is.
      const held = clampMove(originals, by, hall);
      const next = [...tables];
      for (const table of originals) {
        const id = newId();
        copies.push(id);
        next.push({
          ...table,
          id,
          number: table.sectionId === null ? null : nextNumber(next, table.sectionId),
          xMm: roundMm(table.xMm + held.dxMm),
          yMm: roundMm(table.yMm + held.dyMm),
        });
      }
      return next;
    });
    return copies;
  }

  /** Move each of the tables named by its own move, each held inside the hall. */
  function moveEach(ids: readonly string[], movesOf: (boxes: Bounds[]) => MoveMm[]) {
    const named = new Set(ids);
    change((tables, whole) => {
      const own = tables.filter((table) => named.has(table.id));
      const moves = movesOf(own.map((table) => tableBounds(table, sizeOf(table))));
      const hall = hallOf(whole);
      const placed = new Map(
        own.map((table, index) => {
          const at = clampToHall(
            {
              xMm: roundMm(table.xMm + moves[index].dxMm),
              yMm: roundMm(table.yMm + moves[index].dyMm),
            },
            hall,
          );
          return [table.id, at] as const;
        }),
      );
      if (own.every((table) => sameSpot(table, placed.get(table.id)!))) return tables;
      return tables.map((table) => {
        const at = placed.get(table.id);
        return at && !sameSpot(table, at) ? { ...table, ...at } : table;
      });
    });
  }

  function align(ids: readonly string[], how: Alignment) {
    moveEach(ids, (boxes) => alignMoves(boxes, how));
  }

  function distribute(ids: readonly string[], axis: 'across' | 'down') {
    moveEach(ids, (boxes) => spreadMoves(boxes, axis));
  }

  function renumber(sectionId: string) {
    change((tables) => {
      const own = tables.filter((table) => table.sectionId === sectionId);
      const order = readingOrder(own, (table) => tableBounds(table, sizeOf(table)));
      const numbers = new Map(order.map((table, index) => [table.id, index + 1]));
      if (own.every((table) => table.number === numbers.get(table.id))) return tables;
      return tables.map((table) => {
        const number = numbers.get(table.id);
        return number === undefined || number === table.number ? table : { ...table, number };
      });
    });
  }

  function setSectionStyle(sectionId: string, style: { color?: number; labelAt?: PointMm | null }) {
    alter((from, whole) => {
      const held = from.sectionStyles.find((one) => one.sectionId === sectionId);
      // A section with no style yet keeps the colour it is drawn in.
      const drawn = () =>
        sectionColors(options.sectionIds?.() ?? [sectionId], from.sectionStyles).get(sectionId) ??
        1;
      const labelAt =
        style.labelAt === undefined
          ? (held?.labelAt ?? null)
          : style.labelAt && roundedPoint(clampToHall(style.labelAt, hallOf(whole)));
      const next: SectionStyle = {
        sectionId,
        color: style.color ?? held?.color ?? drawn(),
        labelAt,
      };
      if (
        held &&
        held.color === next.color &&
        held.labelAt?.xMm === next.labelAt?.xMm &&
        held.labelAt?.yMm === next.labelAt?.yMm
      ) {
        return {};
      }
      return {
        sectionStyles: held
          ? from.sectionStyles.map((one) => (one === held ? next : one))
          : [...from.sectionStyles, next],
      };
    });
  }

  function begin() {
    if (layout.value && !gesture) gesture = { found: stepOf(layout.value), from: null };
  }

  function end() {
    const held = gesture;
    gesture = null;
    const now = layout.value;
    if (!held || !now) return;
    // A gesture that ends where it began is no change, whether its frames drew the layout as it
    // was found or with its lost tables in no section.
    const same =
      sameStep(stepOf(now), held.found) || (held.from !== null && sameStep(stepOf(now), held.from));
    if (same) layout.value = { ...now, ...held.found };
    else step(held.found);
  }

  function cancel() {
    const held = gesture;
    gesture = null;
    if (held && layout.value) layout.value = { ...layout.value, ...held.found };
  }

  function undo() {
    const now = layout.value;
    const last = undone.value.at(-1);
    if (!now || !last || gesture) return;
    undone.value = undone.value.slice(0, -1);
    redone.value = [...redone.value, stepOf(now)];
    layout.value = { ...now, ...last };
    keepSelection();
    touch();
  }

  function redo() {
    const now = layout.value;
    const next = redone.value.at(-1);
    if (!now || !next || gesture) return;
    redone.value = redone.value.slice(0, -1);
    undone.value = [...undone.value, stepOf(now)].slice(-UNDO_STEPS);
    layout.value = { ...now, ...next };
    keepSelection();
    touch();
  }

  return {
    layout,
    selection,
    saveState,
    saveMessage,
    canUndo: computed(() => undone.value.length > 0),
    canRedo: computed(() => redone.value.length > 0),
    select: (ids) => {
      selection.value = [...ids];
    },
    adopt,
    reload: take,
    write,
    addTables,
    moveTables,
    turnTables,
    removeTables,
    setSection,
    setType,
    duplicate,
    align,
    distribute,
    renumber,
    setSectionStyle,
    begin,
    end,
    cancel,
    undo,
    redo,
    retry: autosave.retry,
    flush: autosave.flush,
    pending: () => autosave.unsaved.value,
    sendOnUnload,
  };
}
