/**
 * A layout's editing model (T257): the working copy of one location's layout, the commands that
 * change its tables, undo and redo, and the queue that saves it.
 *
 * The working copy is never changed in place: every command puts a new layout in `layout`, so a
 * step of undo is the tables as they stood, whole, and undo restores data, which the drawing
 * follows. Undo holds the last 200 steps, crosses saves, and is itself a change that saves.
 *
 * A change saves 600 ms after the last one, one write at a time: a change made while a write is
 * out is sent when its answer is in, naming the revision that answer gave. A write that fails
 * keeps the working copy and says so, for Retry or the next change to send again; one refused as
 * stale (another tab or person saved this layout in between) stops the queue until the page
 * reloads the layout, since every later write would be refused the same way.
 *
 * A gesture (a drag, a turn by the handle) is one change: between `begin` and `end` a command
 * replaces the gesture's last one, drawn at once, and only `end` makes the step and the save.
 */
import { computed, shallowRef, type ComputedRef, type ShallowRef } from 'vue';
import type { FloorplanObject, FloorplanTable } from '@/assets/types/datatypes';
import {
  clampMove,
  clampToHall,
  closeGaps,
  hallOf,
  nextNumber,
  roundMm,
  roundTurn,
  turnedAbout,
  type PointMm,
} from './layoutGeometry';
import { saveRefusal, type SavedLayout } from './layoutSave';

/** How many steps undo holds. */
export const UNDO_STEPS = 200;
/** How long after the last change the layout is saved, in milliseconds. */
export const SAVE_DELAY_MS = 600;

export type LayoutSaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'stale';

/** A table to add: where it stands and what it is; its id and number are the editor's to give. */
export interface NewTable {
  sectionId: string | null;
  tableTypeId: string;
  xMm: number;
  yMm: number;
  rotation?: number;
}

export interface LayoutEditorOptions {
  /** The write: the layout and the revision it was read at, answered with the layout as stored. */
  save: (layout: FloorplanObject, revision: number) => Promise<SavedLayout>;
  /** Told of every answer, for the page to put into the market it shows. */
  onSaved?: (answer: SavedLayout) => void;
  /** Whether the market is a draft, where a removal's later neighbours close its gap. */
  draft?: () => boolean;
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
  saveState: Readonly<ShallowRef<LayoutSaveState>>;
  /** What a failed or stale save said. */
  saveMessage: Readonly<ShallowRef<string>>;
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
  begin(): void;
  end(): void;
  cancel(): void;
  undo(): void;
  redo(): void;
  /** Send a failed save again. */
  retry(): void;
  /** Save what is pending now, and wait for it; resolves after a save that fails, too. */
  flush(): Promise<void>;
  /** Whether the working copy holds a change no save has stored. */
  pending(): boolean;
  /** Stop the timer; the editor's page is going. */
  dispose(): void;
}

export function useLayoutEditor(options: LayoutEditorOptions): LayoutEditor {
  const delayMs = options.delayMs ?? SAVE_DELAY_MS;
  const newId = options.newId ?? (() => crypto.randomUUID());

  const layout = shallowRef<FloorplanObject | null>(null);
  const selection = shallowRef<string[]>([]);
  const saveState = shallowRef<LayoutSaveState>('idle');
  const saveMessage = shallowRef('');
  const undone = shallowRef<FloorplanTable[][]>([]);
  const redone = shallowRef<FloorplanTable[][]>([]);

  /** The revision the server holds, as the last answer or read said it. */
  let revision = 0;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  /** The tables as a gesture found them. */
  let gesture: FloorplanTable[] | null = null;

  // ── The save queue ─────────────────────────────────────────────────────────

  function stopTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function send(): Promise<void> {
    stopTimer();
    if (inFlight) return inFlight;
    const sent = layout.value;
    if (!sent || !dirty || saveState.value === 'stale') return Promise.resolve();
    dirty = false;
    saveState.value = 'saving';
    saveMessage.value = '';
    let again = false;
    inFlight = options
      .save(sent, revision)
      .then((answer) => {
        revision = answer.floorplan.revision;
        const now = layout.value;
        if (now && now.id === answer.floorplan.id) {
          // What the server owns of a layout is taken from its answer; the rest is the working
          // copy's, which may hold a change made while this write was out.
          layout.value = dirty
            ? {
                ...now,
                revision,
                locationId: answer.floorplan.locationId,
                startingCounts: answer.floorplan.startingCounts,
              }
            : { ...answer.floorplan, tables: now.tables };
        }
        saveState.value = 'saved';
        options.onSaved?.(answer);
        again = dirty;
      })
      .catch((err: unknown) => {
        dirty = true;
        const refusal = saveRefusal(err);
        saveState.value = refusal.kind;
        saveMessage.value = refusal.message;
      })
      .finally(() => {
        inFlight = null;
        // A change made while the write was out goes now, unless its own wait is still running.
        if (again && timer === null) void send();
      });
    return inFlight;
  }

  function touch() {
    dirty = true;
    if (saveState.value === 'stale') return;
    stopTimer();
    timer = setTimeout(() => {
      timer = null;
      void send();
    }, delayMs);
  }

  async function flush(): Promise<void> {
    stopTimer();
    // A write that is out is waited for, and the one its answer starts for a change made
    // meanwhile; then what is still unsent goes, once: a save that fails does not hold the page.
    while (inFlight) await inFlight;
    if (dirty && saveState.value !== 'stale') await send();
    while (inFlight) await inFlight;
  }

  // ── Taking the server's layout ─────────────────────────────────────────────

  function take(stored: FloorplanObject | null) {
    stopTimer();
    layout.value = stored;
    revision = stored?.revision ?? 0;
    dirty = false;
    gesture = null;
    undone.value = [];
    redone.value = [];
    const ids = new Set((stored?.tables ?? []).map((table) => table.id));
    selection.value = selection.value.filter((id) => ids.has(id));
    saveState.value = 'idle';
    saveMessage.value = '';
  }

  function adopt(stored: FloorplanObject | null) {
    const now = layout.value;
    if (!now || (stored && stored.id !== now.id)) {
      take(stored);
      return;
    }
    if (stored && stored.revision > revision && !dirty && !inFlight) take(stored);
  }

  async function write(next: FloorplanObject): Promise<boolean> {
    await flush();
    if (saveState.value === 'stale') return false;
    if (!layout.value || layout.value.id !== next.id) {
      take(null);
      revision = 0;
    }
    layout.value = { ...next, tables: layout.value?.tables ?? next.tables };
    dirty = true;
    await send();
    return saveState.value === 'saved';
  }

  // ── Changes ────────────────────────────────────────────────────────────────

  /** Put new tables in the working copy: a step of undo and a save, or a gesture's next frame. */
  function change(make: (tables: FloorplanTable[], whole: FloorplanObject) => FloorplanTable[]) {
    const now = layout.value;
    if (!now) return;
    const from = gesture ?? now.tables;
    const tables = make(from, now);
    if (tables === from) return;
    layout.value = { ...now, tables };
    if (gesture) return;
    step(from);
  }

  function step(from: FloorplanTable[]) {
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
      return tables.map((table) => {
        if (!turning.has(table.id)) return table;
        // One table turns about its own centre, wherever the selection's is reckoned.
        const turned = turnedAbout(table, own.length === 1 ? table : centre, degrees);
        return { ...turned, ...clampToHall(turned, hall) };
      });
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

  function begin() {
    if (layout.value && !gesture) gesture = layout.value.tables;
  }

  function end() {
    const from = gesture;
    gesture = null;
    if (from && layout.value && layout.value.tables !== from) step(from);
  }

  function cancel() {
    const from = gesture;
    gesture = null;
    if (from && layout.value) layout.value = { ...layout.value, tables: from };
  }

  function undo() {
    const now = layout.value;
    const last = undone.value.at(-1);
    if (!now || !last || gesture) return;
    undone.value = undone.value.slice(0, -1);
    redone.value = [...redone.value, now.tables];
    layout.value = { ...now, tables: last };
    keepSelection();
    touch();
  }

  function redo() {
    const now = layout.value;
    const next = redone.value.at(-1);
    if (!now || !next || gesture) return;
    redone.value = redone.value.slice(0, -1);
    undone.value = [...undone.value, now.tables].slice(-UNDO_STEPS);
    layout.value = { ...now, tables: next };
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
    begin,
    end,
    cancel,
    undo,
    redo,
    retry: () => void send(),
    flush,
    pending: () => dirty || inFlight !== null,
    dispose: stopTimer,
  };
}
