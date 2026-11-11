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
 *
 * Tables picked up by keyboard are one change too, from `pickUp` to `drop`, but each key's move or
 * turn goes on from where the last left them; `putBack` leaves them where they were picked up, and
 * a drop that leaves every table where it was is no change.
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
  offZones,
  zoneBounds,
  type Alignment,
  type Bounds,
  type MoveMm,
  type PointMm,
} from './layoutGeometry';
import { SAVE_FAILED, STALE_LAYOUT, type SavedLayout } from './layoutSave';
import { MAX_LAYOUT_TABLES } from './layoutRow';

/** How many steps undo holds. */
export const UNDO_STEPS = 200;
/** How many no-table zones a layout holds, as the server bounds them. */
export const MAX_ZONES = 100;
/** The smallest side a no-table zone is drawn with: smaller is a slip of the pointer. */
export const MIN_ZONE_SIDE_MM = 100;
/**
 * How the layout's saves stand: `idle` with nothing to say, `saving` while a change waits or a
 * write is out, `saved` just after one landed, `failed` when one did not (Retry), `stale` when the
 * layout changed elsewhere (Reload).
 */
export type LayoutSaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'stale';

/** What a step of undo holds of a layout: its tables, its sections' styles and its no-table
 *  zones, as they stood. */
type Step = Pick<FloorplanObject, 'tables' | 'sectionStyles' | 'zones'>;

const stepOf = (layout: FloorplanObject): Step => ({
  tables: layout.tables,
  sectionStyles: layout.sectionStyles,
  zones: layout.zones,
});
const sameStep = (a: Step, b: Step) =>
  a.tables === b.tables && a.sectionStyles === b.sectionStyles && a.zones === b.zones;

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

/** How `write` takes a write that does not land. */
export interface WriteOptions {
  /** Put the layout back as it was and keep nothing unsaved, as for a replaced image, which the
   *  page deletes when it is given up; unsaid, the working copy keeps the change for Retry. */
  rollBack?: boolean;
  /** Told the sentence of a write rolled back, which the save state then no longer says. */
  onRefused?: (sentence: string) => void;
}

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
  /** The ids of the tables picked up by keyboard; none while nothing is in hand. */
  pickedUp: Readonly<ShallowRef<string[]>>;
  /** Pick tables up: until `drop` or `putBack`, each move and turn goes on from the last, and
   *  nothing is saved or undone. False when none of them is the layout's, or a gesture is in hand. */
  pickUp(ids: readonly string[]): boolean;
  /** Put down what was picked up, as one change; false when it stands as it was picked up. */
  drop(): boolean;
  /** Put what was picked up back where it was. */
  putBack(): void;
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
  write(next: FloorplanObject, options?: WriteOptions): Promise<boolean>;
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
  /** Mark a no-table zone over a box of the hall, held inside it; its id, or null for a box too
   *  small to hold a table's corner, or a layout that holds as many zones as it may. */
  addZone(box: Bounds, label?: string): string | null;
  /** Name a no-table zone: "Stage", "Pillar". */
  setZoneLabel(id: string, label: string): void;
  removeZone(id: string): void;
  begin(): void;
  /** End the gesture in hand: true when it changed the layout, so made a step and a save. */
  end(): boolean;
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
  let gesture: { found: Step; from: Step | null; carried?: true } | null = null;
  /** The tables picked up by keyboard: a gesture whose frames each go on from the last. */
  const pickedUp = shallowRef<string[]>([]);
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
            ? { ...answer.floorplan, ...stepOf(now) }
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
   * this one refused as stale behind it. What is in hand, by a drag or picked up, is no change
   * yet, here as in `send`: the layout goes as the gesture found it.
   */
  function sendOnUnload(): boolean {
    const now = layout.value;
    if (!now || stale.value) return false;
    const sent = gesture ? { ...now, ...gesture.found } : now;
    return Boolean(options.saveOnUnload?.(sent, revision + (writeOut ? 1 : 0)));
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
    pickedUp.value = [];
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

  async function write(next: FloorplanObject, how: WriteOptions = {}): Promise<boolean> {
    await autosave.flush();
    if (stale.value) return false;
    // What a roll back may forget: nothing, when an earlier change is still unsaved.
    const alreadyUnsaved = autosave.unsaved.value;
    if (!layout.value || layout.value.id !== next.id) {
      take(null);
      revision = 0;
    }
    const before = layout.value;
    layout.value = { ...next, ...(before ? stepOf(before) : {}) };
    touch();
    const refused = await autosave.flush();
    const landed = refused === null;
    // A write refused as stale never can land, so the page shows the layout as it read it, with
    // Reload; one that failed otherwise stays in the working copy for Retry to send, unless it is
    // to be rolled back.
    if (!landed && stale.value) layout.value = before;
    else if (!landed && how.rollBack) {
      how.onRefused?.(refused);
      layout.value = before;
      if (!alreadyUnsaved) autosave.forget();
    }
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
    // What is picked up goes on from where the last key left it; a drag's frame starts over from
    // where the drag began.
    const from = gesture?.carried ? normal(stepOf(now)) : (gesture?.from ?? normal(found));
    if (gesture && !gesture.carried) gesture.from = from;
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
      // As many as the layout has room for, which the server holds it to: one more would be a
      // save refused on every Retry.
      for (const table of added.slice(0, Math.max(0, MAX_LAYOUT_TABLES - tables.length))) {
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
      return ids.length ? pushedOff(next, new Set(ids), whole) : tables;
    });
    return ids;
  }

  function moveTables(ids: readonly string[], dxMm: number, dyMm: number) {
    const moving = new Set(ids);
    change((tables, whole) => {
      const own = tables.filter((table) => moving.has(table.id));
      const by = clampMove(own, { dxMm, dyMm }, hallOf(whole));
      if (!own.length || (by.dxMm === 0 && by.dyMm === 0)) return tables;
      const moved = tables.map((table) =>
        moving.has(table.id)
          ? { ...table, xMm: roundMm(table.xMm + by.dxMm), yMm: roundMm(table.yMm + by.dyMm) }
          : table,
      );
      return carried() ? moved : pushedOff(moved, moving, whole);
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
      const done = tables.map((table) => placed.get(table.id) ?? table);
      return carried() ? done : pushedOff(done, turning, whole);
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

  /**
   * The tables with those named pushed off the no-table zones they stand on, together, to the
   * nearest clear place inside the hall, as a snap would take them (`offZones`); the same array
   * when they stand clear. What is picked up by keyboard is pushed only as it is dropped, so the
   * keys can carry it across a zone.
   */
  function pushedOff(
    tables: FloorplanTable[],
    ids: ReadonlySet<string>,
    whole: FloorplanObject,
  ): FloorplanTable[] {
    if (!whole.zones.length) return tables;
    const own = tables.filter((table) => ids.has(table.id));
    const by = offZones(
      own.map((table) => tableCorners(table, sizeOf(table))),
      whole.zones.map(zoneBounds),
      hallOf(whole),
    );
    if (by.dxMm === 0 && by.dyMm === 0) return tables;
    return tables.map((table) =>
      ids.has(table.id)
        ? { ...table, xMm: roundMm(table.xMm + by.dxMm), yMm: roundMm(table.yMm + by.dyMm) }
        : table,
    );
  }
  const carried = () => Boolean(gesture?.carried);

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
      // Whole or not at all: copies past the layout's 1,000 would be refused on every Retry.
      if (!originals.length || tables.length + originals.length > MAX_LAYOUT_TABLES) return tables;
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

  // ── No-table zones ─────────────────────────────────────────────────────────

  function addZone(box: Bounds, label = ''): string | null {
    const id = newId();
    let added = false;
    alter((from, whole) => {
      const hall = hallOf(whole);
      const left = Math.max(box.left, 0);
      const top = Math.max(box.top, 0);
      const right = hall ? Math.min(box.right, hall.widthMm) : box.right;
      const bottom = hall ? Math.min(box.bottom, hall.heightMm) : box.bottom;
      if (
        from.zones.length >= MAX_ZONES ||
        right - left < MIN_ZONE_SIDE_MM ||
        bottom - top < MIN_ZONE_SIDE_MM
      ) {
        return {};
      }
      added = true;
      return {
        zones: [
          ...from.zones,
          {
            id,
            label: label.trim(),
            xMm: roundMm(left),
            yMm: roundMm(top),
            widthMm: roundMm(right - left),
            depthMm: roundMm(bottom - top),
          },
        ],
      };
    });
    return added ? id : null;
  }

  function setZoneLabel(id: string, label: string) {
    const named = label.trim();
    alter((from) => {
      const zone = from.zones.find((one) => one.id === id);
      if (!zone || zone.label === named) return {};
      return { zones: from.zones.map((one) => (one === zone ? { ...one, label: named } : one)) };
    });
  }

  function removeZone(id: string) {
    alter((from) => {
      const left = from.zones.filter((one) => one.id !== id);
      return left.length === from.zones.length ? {} : { zones: left };
    });
  }

  function begin() {
    if (layout.value && !gesture) gesture = { found: stepOf(layout.value), from: null };
  }

  function end() {
    const held = gesture;
    gesture = null;
    pickedUp.value = [];
    const now = layout.value;
    if (!held || !now) return false;
    // A gesture that ends where it began is no change, whether its frames drew the layout as it
    // was found or with its lost tables in no section.
    const same =
      sameStep(stepOf(now), held.found) || (held.from !== null && sameStep(stepOf(now), held.from));
    if (same) layout.value = { ...now, ...held.found };
    else step(held.found);
    return !same;
  }

  function cancel() {
    const held = gesture;
    gesture = null;
    pickedUp.value = [];
    if (held && layout.value) layout.value = { ...layout.value, ...held.found };
  }

  // ── Picked up by keyboard ──────────────────────────────────────────────────

  function pickUp(ids: readonly string[]): boolean {
    const now = layout.value;
    if (!now || gesture) return false;
    const named = new Set(ids);
    const own = now.tables.filter((table) => named.has(table.id)).map((table) => table.id);
    if (!own.length) return false;
    gesture = { found: stepOf(now), from: null, carried: true };
    pickedUp.value = own;
    return true;
  }

  function drop(): boolean {
    const held = gesture;
    if (!held?.carried || !layout.value) return false;
    // Put down on a no-table zone, the tables are pushed off it, as a drag's are.
    const ids = new Set(pickedUp.value);
    change((tables, whole) => pushedOff(tables, ids, whole));
    const now = layout.value;
    // Moved out and back, or turned all the way round, the tables stand as they were picked up:
    // no step and no save, and the layout is again the one that was read.
    const before = new Map(held.found.tables.map((table) => [table.id, table]));
    const carried = new Set(pickedUp.value);
    const moved = now.tables.some((table) => {
      const was = before.get(table.id);
      return (
        carried.has(table.id) &&
        (!was || was.xMm !== table.xMm || was.yMm !== table.yMm || was.rotation !== table.rotation)
      );
    });
    if (!moved) {
      cancel();
      return false;
    }
    end();
    return true;
  }

  function putBack() {
    if (gesture?.carried) cancel();
  }

  /** Whether a step of undo can be saved: every table of it of one of the market's types. A type
   *  removed since makes a step that holds its tables one the server refuses on every Retry. */
  function typed(step: Step): boolean {
    const types = options.tableTypes?.();
    if (!types) return true;
    const ids = new Set(types.map((type) => type.id));
    return step.tables.every((table) => ids.has(table.tableTypeId));
  }

  /** Drop the steps of undo and redo that hold a table of a type the market no longer has. */
  function forgetUntyped() {
    if (!undone.value.every(typed)) undone.value = undone.value.filter(typed);
    if (!redone.value.every(typed)) redone.value = redone.value.filter(typed);
  }

  function undo() {
    forgetUntyped();
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
    forgetUntyped();
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
    canUndo: computed(() => undone.value.some(typed)),
    canRedo: computed(() => redone.value.some(typed)),
    select: (ids) => {
      selection.value = [...ids];
    },
    pickedUp,
    pickUp,
    drop,
    putBack,
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
    addZone,
    setZoneLabel,
    removeZone,
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
