<script setup lang="ts">
/**
 * A layout's editor (T257): a toolbar over the map, the map on a stage that pans and zooms, and a
 * hint line under it. It draws the layout's working copy (`useLayoutEditor.ts`) through the one
 * drawing (`LayoutMap.vue`, in `edit` mode) and turns what the pointer and the keys do into the
 * model's commands; it holds no table of its own.
 *
 * Select: a press on a table selects it (Shift or Ctrl adds it or takes it out), a drag moves the
 * selection, snapping to the edges and centres of the tables that stand still within 8 px, with a
 * guide drawn, and freely with Alt; a press on the floor selects nothing, and a drag on it draws a
 * box that selects every table whose centre is in it (with Shift or Ctrl, beside those selected
 * already). Ctrl+A selects every table and Escape none. The handle over the selection turns it
 * about its middle in 15° steps (Alt: freely); R turns it a quarter. A section's name is dragged
 * to where it should stand. Add table: a click places a table of the options strip's section and
 * type at the point, and the tool stays on. A drag or a turn is one change, and Escape puts it
 * back.
 *
 * The view: the wheel or two fingers pan, Ctrl and the wheel or a pinch zoom about the pointer,
 * 10% to 800%; Space and a drag, or the middle button, pan; the buttons step the zoom and Fit shows
 * the whole floorplan. Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y undo and redo from anywhere on the page but
 * a field.
 *
 * By keyboard: the map is one Tab stop, the arrow keys moving the focus between its tables
 * (`LayoutMap.vue`), and the view follows the table the keys are on. Enter or Space picks the
 * focused table up, or the selection when it is one of it (Shift+Enter adds it to the selection or
 * takes it out instead); picked up, the arrow keys move it 10 cm, or 1 m with Shift, R turns it a
 * quarter and Shift+R 15°, Enter or Space drops it, as one change, and Escape puts it back. It is
 * dropped too when the focus leaves the map or a pointer is pressed. With the focus on the map,
 * Delete or Backspace removes the selection, Ctrl+D duplicates it, + and - zoom and 0 fits the
 * floorplan; R, Delete and Ctrl+D act on the focused table where nothing is selected. With Add
 * table on, Enter places a table at the middle of the view, beside what stands there. No key is
 * taken from a field or a select. Each move, turn, placement and removal is said (`announce`) for
 * the page's live region.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue';
import type { FloorplanTable, SectionObject, TableTypeObject } from '@/assets/types/datatypes';
import LayoutMap, { type MapView } from './LayoutMap.vue';
import {
  AT_THE_EDGE,
  saidAdded,
  saidDropped,
  saidMoved,
  saidPickedUp,
  saidPutBack,
  saidRemoved,
  saidTurned,
} from './layoutAnnouncements';
import { plural } from '@/utils/historyReaders/shared';
import { layoutSections } from './layoutDrawing';
import {
  STANDARD_TABLE,
  angleFrom,
  boxBetween,
  cameraShowing,
  clearPlace,
  cornersOf,
  fitCamera,
  hallOf,
  nearestTo,
  snapAngle,
  snapMove,
  steppedZoom,
  tableBounds,
  tableCorners,
  tablesInBox,
  unionOf,
  zoomPercent,
  zoomedAbout,
  type Bounds,
  type Camera,
  type Guide,
  type PointMm,
} from './layoutGeometry';
import { centreOf, selectionBounds, turnSelection } from './layoutSelection';
import type { LayoutEditor } from './useLayoutEditor';

const props = withDefaults(
  defineProps<{
    editor: LayoutEditor;
    locationName: string;
    /** The plan's sections; the editor offers its location's. */
    sections: readonly SectionObject[];
    tableTypes: readonly TableTypeObject[];
    imageUrl?: string;
  }>(),
  { imageUrl: '' },
);

const emit = defineEmits<{
  /** What a change did, in words for the page's live region. */
  announce: [words: string];
}>();
const say = (words: string) => emit('announce', words);

const layout = computed(() => props.editor.layout.value!);
const selection = computed(() => props.editor.selection.value);
/** The ids of the tables picked up by keyboard. */
const pickedUp = computed(() => props.editor.pickedUp.value);
const hall = computed(() => hallOf(layout.value));
const typeById = computed(() => new Map(props.tableTypes.map((type) => [type.id, type])));
const sizeOf = (table: FloorplanTable) => typeById.value.get(table.tableTypeId) ?? STANDARD_TABLE;
const boundsOf = (table: FloorplanTable): Bounds => tableBounds(table, sizeOf(table));

/** The layout's tables of the ids named, as they stand now. */
function tablesOf(ids: readonly string[]): FloorplanTable[] {
  const named = new Set(ids);
  return layout.value.tables.filter((table) => named.has(table.id));
}
const tableOf = (id: string | null) =>
  (id && layout.value.tables.find((table) => table.id === id)) || null;

// ── The tools ────────────────────────────────────────────────────────────────

type Tool = 'select' | 'add';
const tool = ref<Tool>('select');

/** The location's sections as the map draws them, by which a table is named when it is said. */
const drawnSections = computed(() => layoutSections(layout.value, props.sections));
const ownSections = computed(() => drawnSections.value.map(({ section }) => section));
/** The section and the type a new table takes: the first of each until another is chosen. */
/** '' is "No section", a choice like another; null is no choice made yet. */
const addSectionId = ref<string | null>(null);
const addTypeId = ref('');
watch(
  [ownSections, () => props.tableTypes],
  ([sections, types]) => {
    const chosen = addSectionId.value;
    if (chosen === null || (chosen !== '' && !sections.some((section) => section.id === chosen))) {
      addSectionId.value = sections[0]?.id ?? '';
    }
    if (!types.some((type) => type.id === addTypeId.value)) addTypeId.value = types[0]?.id ?? '';
  },
  { immediate: true },
);

/** Whether the keys are on the map: the focus is in it, and came by keyboard. */
const keysOnMap = ref(false);

/** The hint under the map: what the keys do while they are on it, else what the pointer does. */
const hint = computed(() => {
  if (pickedUp.value.length) {
    const it = pickedUp.value.length === 1 ? 'it' : 'them';
    return (
      `Picked up: the arrow keys move ${it} 10 cm, or 1 m with Shift. ` +
      `R turns ${it}, Enter drops ${it} and Escape puts ${it} back.`
    );
  }
  if (keysOnMap.value) {
    return tool.value === 'add'
      ? 'Enter places a table at the middle of the view. The arrow keys move between tables.'
      : 'The arrow keys move between tables. Enter picks a table up to move it, ' +
          'Shift and Enter selects it, and Delete removes the selection.';
  }
  return tool.value === 'add'
    ? 'Click the floor to place a table. Ctrl and the wheel zoom, and Space and a drag move the view.'
    : 'Drag a table to move it; Alt places it freely. Drag on the floor, or Shift and click, ' +
        'to select several. Drag the handle over the selection, or press R, to turn it.';
});

/** The map's description, for a screen reader that reads a group's: its keys, as the tool on has
 *  them. */
const keysId = useId();
const mapKeys = computed(() =>
  tool.value === 'add'
    ? 'The arrow keys move between tables. Enter places a table at the middle of the view.'
    : 'The arrow keys move between tables. Enter picks a table up; then the arrow keys move it, ' +
      'R turns it, Enter drops it and Escape puts it back.',
);

// ── The stage and its camera ─────────────────────────────────────────────────

const stage = ref<HTMLElement | null>(null);
const size = ref<{ width: number; height: number } | null>(null);
const camera = shallowRef<Camera | null>(null);
let resize: ResizeObserver | null = null;

/** The whole floorplan, or the tables where the layout has no hall. */
function wholeBox(): Bounds {
  if (hall.value)
    return { left: 0, top: 0, right: hall.value.widthMm, bottom: hall.value.heightMm };
  return (
    unionOf(layout.value.tables.map(boundsOf)) ?? { left: 0, top: 0, right: 10_000, bottom: 10_000 }
  );
}

function fit() {
  if (size.value) camera.value = fitCamera(wholeBox(), size.value.width, size.value.height);
}

function measure() {
  const el = stage.value;
  if (!el) return;
  const { width, height } = el.getBoundingClientRect();
  if (width <= 0 || height <= 0) return;
  // The stage's first size fits the floorplan; a later one keeps the view's middle and zoom.
  const first = !size.value;
  size.value = { width, height };
  if (first || !camera.value) fit();
}

const view = computed<MapView | null>(() => {
  const cam = camera.value;
  const box = size.value;
  if (!cam || !box) return null;
  const widthMm = box.width / cam.pxPerMm;
  const heightMm = box.height / cam.pxPerMm;
  return { xMm: cam.xMm - widthMm / 2, yMm: cam.yMm - heightMm / 2, widthMm, heightMm };
});

const zoomText = computed(() => (camera.value ? `${zoomPercent(camera.value.pxPerMm)}%` : ''));

/** A pointer's place on the stage, in pixels from its middle. */
function fromMiddle(event: { clientX: number; clientY: number }) {
  const rect = stage.value!.getBoundingClientRect();
  return {
    xPx: event.clientX - rect.left - rect.width / 2,
    yPx: event.clientY - rect.top - rect.height / 2,
  };
}

/** A pointer's place in the hall, in millimetres. */
function toMm(event: { clientX: number; clientY: number }): PointMm {
  const cam = camera.value!;
  const at = fromMiddle(event);
  return { xMm: cam.xMm + at.xPx / cam.pxPerMm, yMm: cam.yMm + at.yPx / cam.pxPerMm };
}

function stepZoom(direction: 1 | -1) {
  const cam = camera.value;
  if (cam) camera.value = zoomedAbout(cam, steppedZoom(cam.pxPerMm, direction) / cam.pxPerMm);
}

/** How clear of the stage's edge a table the keys are on is kept, in pixels. */
const SHOWN_MARGIN_PX = 24;

/** Bring tables into view, moving the view no further than shows them; nothing when they are. */
function show(tables: readonly FloorplanTable[]) {
  const box = unionOf(tables.map(boundsOf));
  const cam = camera.value;
  if (!box || !cam || !size.value) return;
  camera.value = cameraShowing(cam, size.value.width, size.value.height, box, SHOWN_MARGIN_PX);
}

/** The most one wheel event zooms by, in the pixels it says it scrolled. */
const WHEEL_ZOOM_PX = 25;

function onWheel(event: WheelEvent) {
  const cam = camera.value;
  if (!cam) return;
  event.preventDefault();
  // A drag in hand reckons from where it was pressed, so the view holds still under it.
  if (gesture) return;
  // A mouse's wheel says lines, a trackpad pixels.
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
  if (event.ctrlKey || event.metaKey) {
    // A pinch sends a few pixels an event and a mouse's notch a hundred: a notch is held to a
    // quarter more or less, so the wheel steps through the zoom instead of leaping it.
    const by = Math.min(Math.max(event.deltaY * unit, -WHEEL_ZOOM_PX), WHEEL_ZOOM_PX);
    camera.value = zoomedAbout(cam, Math.exp(-by * 0.01), fromMiddle(event));
    return;
  }
  camera.value = {
    ...cam,
    xMm: cam.xMm + (event.deltaX * unit) / cam.pxPerMm,
    yMm: cam.yMm + (event.deltaY * unit) / cam.pxPerMm,
  };
}

// ── The pointer ──────────────────────────────────────────────────────────────

/** How far a press may travel, in pixels, and still be a press rather than a drag. */
const DRAG_PX = 4;
/** How near an edge or a centre snaps, in screen pixels. */
const SNAP_PX = 8;
/** How far along the line they would share a still table may stand and still be snapped to. */
const SNAP_REACH_MM = 5000;
const TURN_STEP = 15;

type Gesture =
  | { kind: 'pan'; from: { x: number; y: number }; camera: Camera }
  | { kind: 'add'; from: { x: number; y: number } }
  | {
      kind: 'floor';
      from: { x: number; y: number };
      fromMm: PointMm;
      /** What was selected at the press, which Shift or Ctrl keeps beside the box's tables. */
      base: string[];
      keep: boolean;
      begun: boolean;
    }
  | {
      kind: 'label';
      from: { x: number; y: number };
      sectionId: string;
      /** The middle of the name as the drag found it. */
      at: PointMm;
      begun: boolean;
    }
  | {
      kind: 'move';
      from: { x: number; y: number };
      ids: string[];
      /** The moving tables' boxes and the still ones', as the drag found them. */
      moving: Bounds[];
      still: Bounds[];
      begun: boolean;
      /** A press on a table already selected with others narrows to it if it was no drag. */
      narrowTo: string | null;
    }
  | {
      kind: 'turn';
      ids: string[];
      centre: PointMm;
      fromAngle: number;
      begun: boolean;
      /** How far the handle has turned them, in degrees. */
      by: number;
    }
  | { kind: 'pinch'; distance: number; middle: { xPx: number; yPx: number }; camera: Camera };

let gesture: Gesture | null = null;
/** The pointer whose press began the gesture; a pinch is two and names none. */
let gesturePointer: number | null = null;
const guides = shallowRef<Guide[]>([]);
/** The box a drag on the floor is drawing. */
const selectBox = shallowRef<Bounds | null>(null);
const dragging = ref(false);
const spaceHeld = ref(false);
const hovering = ref(false);
/** The touches on the stage, for a pinch. */
const touches = new Map<number, { x: number; y: number }>();

function tableAt(event: Event): string | null {
  const target = event.target instanceof Element ? event.target : null;
  return target?.closest('[data-table-id]')?.getAttribute('data-table-id') ?? null;
}

/** The section's name pressed, and its middle in the hall, read from the pill the map drew. */
function labelAt(event: Event): { sectionId: string; at: PointMm } | null {
  const target = event.target instanceof Element ? event.target : null;
  const label = target?.closest('[data-section-label]');
  const pill = label?.querySelector('rect');
  const sectionId = label?.getAttribute('data-section-label');
  if (!pill || !sectionId) return null;
  const read = (name: string) => Number(pill.getAttribute(name));
  return {
    sectionId,
    at: { xMm: read('x') + read('width') / 2, yMm: read('y') + read('height') / 2 },
  };
}

function select(id: string, toggle: boolean) {
  const now = selection.value;
  if (!toggle) {
    if (!now.includes(id)) props.editor.select([id]);
    return;
  }
  props.editor.select(now.includes(id) ? now.filter((one) => one !== id) : [...now, id]);
}

function pinchOf(): { distance: number; middle: { xPx: number; yPx: number } } | null {
  const [a, b] = [...touches.values()];
  if (!a || !b) return null;
  return {
    distance: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
    middle: fromMiddle({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }),
  };
}

function onPointerDown(event: PointerEvent) {
  const cam = camera.value;
  if (!cam || !stage.value) return;
  const from = { x: event.clientX, y: event.clientY };

  if (event.pointerType === 'touch') {
    touches.set(event.pointerId, from);
    const pinch = pinchOf();
    if (pinch) {
      // A second finger makes whatever the first began a pinch.
      if (gesture && 'begun' in gesture && gesture.begun) props.editor.cancel();
      if (gesture?.kind === 'floor' && gesture.begun) props.editor.select(gesture.base);
      guides.value = [];
      selectBox.value = null;
      gesture = { kind: 'pinch', ...pinch, camera: cam };
      gesturePointer = null;
      stage.value.setPointerCapture(event.pointerId);
      return;
    }
  }
  if (gesture) return;

  if (event.button === 1 || (event.button === 0 && spaceHeld.value)) {
    event.preventDefault();
    gesture = { kind: 'pan', from, camera: cam };
  } else if (event.button !== 0) {
    return;
  } else if (event.target instanceof Element && event.target.closest('[data-turn-handle]')) {
    const box = selectionBounds(layout.value, selection.value, props.tableTypes);
    if (!box) return;
    // The handle is no stop of the keyboard's: the press leaves the focus where it was.
    event.preventDefault();
    const centre = centreOf(box);
    gesture = {
      kind: 'turn',
      ids: [...selection.value],
      centre,
      fromAngle: angleFrom(centre, toMm(event)),
      begun: false,
      by: 0,
    };
  } else if (tool.value === 'add') {
    gesture = { kind: 'add', from };
  } else {
    const id = tableAt(event);
    const label = id ? null : labelAt(event);
    const toggle = event.shiftKey || event.ctrlKey || event.metaKey;
    if (label) {
      gesture = { kind: 'label', from, ...label, begun: false };
    } else if (!id) {
      gesture = {
        kind: 'floor',
        from,
        fromMm: toMm(event),
        base: [...selection.value],
        keep: toggle,
        begun: false,
      };
    } else {
      const wasAmongSeveral = selection.value.includes(id) && selection.value.length > 1;
      select(id, toggle);
      if (!selection.value.includes(id)) return;
      const ids = [...selection.value];
      const moving = new Set(ids);
      gesture = {
        kind: 'move',
        from,
        ids,
        moving: layout.value.tables.filter((table) => moving.has(table.id)).map(boundsOf),
        still: layout.value.tables.filter((table) => !moving.has(table.id)).map(boundsOf),
        begun: false,
        narrowTo: wasAmongSeveral && !toggle ? id : null,
      };
    }
  }
  gesturePointer = event.pointerId;
  stage.value.setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (touches.has(event.pointerId)) {
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }
  const cam = camera.value;
  if (!gesture || !cam) return;
  if (gesture.kind !== 'pinch') {
    // Another pointer (a palm, a mouse passing over a finger's drag) is none of this gesture's.
    if (event.pointerId !== gesturePointer) return;
    // A mouse moving with no button down lost its release, to a menu say: the gesture ends here.
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      endGesture(event, false);
      return;
    }
  }
  const dx = 'from' in gesture ? event.clientX - gesture.from.x : 0;
  const dy = 'from' in gesture ? event.clientY - gesture.from.y : 0;

  if (gesture.kind === 'pinch') {
    const pinch = pinchOf();
    if (!pinch) return;
    const zoomed = zoomedAbout(gesture.camera, pinch.distance / gesture.distance, gesture.middle);
    // The floor under the fingers follows them as they travel together.
    camera.value = {
      ...zoomed,
      xMm: zoomed.xMm - (pinch.middle.xPx - gesture.middle.xPx) / zoomed.pxPerMm,
      yMm: zoomed.yMm - (pinch.middle.yPx - gesture.middle.yPx) / zoomed.pxPerMm,
    };
  } else if (gesture.kind === 'pan') {
    dragging.value = true;
    camera.value = {
      ...gesture.camera,
      xMm: gesture.camera.xMm - dx / cam.pxPerMm,
      yMm: gesture.camera.yMm - dy / cam.pxPerMm,
    };
  } else if (gesture.kind === 'move') {
    if (!gesture.begun && Math.hypot(dx, dy) < DRAG_PX) return;
    if (!gesture.begun) {
      gesture.begun = true;
      dragging.value = true;
      props.editor.begin();
    }
    let dxMm = dx / cam.pxPerMm;
    let dyMm = dy / cam.pxPerMm;
    if (event.altKey) {
      guides.value = [];
    } else {
      const moved = gesture.moving.map((box) => ({
        left: box.left + dxMm,
        right: box.right + dxMm,
        top: box.top + dyMm,
        bottom: box.bottom + dyMm,
      }));
      const snap = snapMove(moved, gesture.still, SNAP_PX / cam.pxPerMm, SNAP_REACH_MM);
      dxMm += snap.dxMm;
      dyMm += snap.dyMm;
      guides.value = snap.guides;
    }
    props.editor.moveTables(gesture.ids, dxMm, dyMm);
  } else if (gesture.kind === 'floor') {
    if (!gesture.begun && Math.hypot(dx, dy) < DRAG_PX) return;
    gesture.begun = true;
    const drawn = boxBetween(gesture.fromMm, toMm(event));
    selectBox.value = drawn;
    // Selected as the box is drawn, so what it will take is seen before it is let go.
    const inside = tablesInBox(layout.value.tables, drawn);
    const kept = gesture.keep ? gesture.base.filter((id) => !inside.includes(id)) : [];
    props.editor.select([...kept, ...inside]);
  } else if (gesture.kind === 'label') {
    if (!gesture.begun && Math.hypot(dx, dy) < DRAG_PX) return;
    if (!gesture.begun) {
      gesture.begun = true;
      dragging.value = true;
      props.editor.begin();
    }
    props.editor.setSectionStyle(gesture.sectionId, {
      labelAt: {
        xMm: gesture.at.xMm + dx / cam.pxPerMm,
        yMm: gesture.at.yMm + dy / cam.pxPerMm,
      },
    });
  } else if (gesture.kind === 'turn') {
    let by = angleFrom(gesture.centre, toMm(event)) - gesture.fromAngle;
    by = ((((by + 180) % 360) + 360) % 360) - 180;
    if (!event.altKey) by = snapAngle(by, TURN_STEP);
    if (!gesture.begun) {
      if (by === 0) return;
      gesture.begun = true;
      dragging.value = true;
      props.editor.begin();
    }
    gesture.by = ((by % 360) + 360) % 360;
    props.editor.turnTables(gesture.ids, by, gesture.centre);
  }
}

function endGesture(event: PointerEvent, cancelled: boolean) {
  touches.delete(event.pointerId);
  const done = gesture;
  if (!done) return;
  if (done.kind !== 'pinch' && event.pointerId !== gesturePointer) return;
  // A pinch lasts while two fingers are down; the one left does nothing more.
  gesture = null;
  gesturePointer = null;
  guides.value = [];
  selectBox.value = null;
  dragging.value = false;
  if (stage.value?.hasPointerCapture(event.pointerId)) {
    stage.value.releasePointerCapture(event.pointerId);
  }
  if (done.kind === 'move' || done.kind === 'turn' || done.kind === 'label') {
    if (!done.begun) {
      if (done.kind === 'move' && done.narrowTo && !cancelled) {
        props.editor.select([done.narrowTo]);
      }
      return;
    }
    if (cancelled) {
      props.editor.cancel();
      return;
    }
    // A drag that ended where it began, or that a wall stopped whole, moved nothing: nothing is said.
    if (!props.editor.end()) return;
    const moved = tablesOf(done.kind === 'label' ? [] : done.ids);
    if (done.kind === 'move' && moved.length) {
      say(saidMoved(moved, tableOf(focusedTable()) ?? moved[0], drawnSections.value));
    } else if (done.kind === 'turn' && moved.length) {
      say(saidTurned(moved, done.by, drawnSections.value));
    }
    return;
  }
  if (done.kind === 'floor') {
    // A box cut short selects what was selected before it; a press that drew none selects
    // nothing, unless Shift or Ctrl was held to keep the selection.
    if (done.begun && cancelled) props.editor.select(done.base);
    else if (!done.begun && !cancelled && !done.keep) props.editor.select([]);
    return;
  }
  if (cancelled) return;
  if (
    done.kind === 'add' &&
    Math.hypot(event.clientX - done.from.x, event.clientY - done.from.y) < DRAG_PX
  ) {
    place(toMm(event));
  }
}

/** Add a table of the options strip's section and type at a point, selected, and say so. */
function place(at: PointMm): string | null {
  const ids = props.editor.addTables([
    {
      sectionId: addSectionId.value || null,
      tableTypeId: addTypeId.value || (props.tableTypes[0]?.id ?? ''),
      ...at,
    },
  ]);
  if (!ids.length) return null;
  props.editor.select(ids);
  say(saidAdded(tablesOf(ids), drawnSections.value));
  return ids[0];
}

/** Put back a drag, a turn or a box that Escape, or the browser, ended early. */
function abandon() {
  const done = gesture;
  gesture = null;
  guides.value = [];
  selectBox.value = null;
  dragging.value = false;
  if (!done || !('begun' in done) || !done.begun) return;
  if (done.kind === 'floor') props.editor.select(done.base);
  else props.editor.cancel();
}

// ── The keys ─────────────────────────────────────────────────────────────────

function inAField(event: KeyboardEvent): boolean {
  const target = event.target instanceof HTMLElement ? event.target : null;
  return Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));
}

/**
 * Whether the map has the keys that would mean something else elsewhere on the page (Ctrl+A,
 * Escape): the focus is on it, or on nothing while the pointer is over it, as after a press on
 * the floor.
 */
function mapHasTheKeys(): boolean {
  const focused = document.activeElement;
  if (focused && stage.value?.contains(focused)) return true;
  return hovering.value && (!focused || focused === document.body);
}

/** The table of the map that has the focus, by its id. */
function focusedTable(): string | null {
  const focused = document.activeElement;
  if (!focused || !stage.value?.contains(focused)) return null;
  return focused.closest('[data-table-id]')?.getAttribute('data-table-id') ?? null;
}

/** Give a table of the map the focus, once it is drawn. */
async function focusTable(id: string) {
  await nextTick();
  [...(stage.value?.querySelectorAll<SVGElement>('[data-table-id]') ?? [])]
    .find((table) => table.getAttribute('data-table-id') === id)
    ?.focus();
}

/** What a key acts on: the selection, or with nothing selected the table that has the focus. */
function targets(): string[] {
  if (selection.value.length) return [...selection.value];
  const focused = focusedTable();
  return focused ? [focused] : [];
}

function removeByKey() {
  const ids = targets();
  const going = tablesOf(ids);
  if (!going.length) return;
  props.editor.removeTables(ids);
  say(saidRemoved(going, drawnSections.value));
}

/** Duplicate what the keys act on; the copies are selected, and the focus goes with them. */
function duplicateByKey() {
  const hadFocus = focusedTable() !== null;
  const copies = props.editor.duplicate(targets());
  if (!copies.length) return;
  props.editor.select(copies);
  const made = tablesOf(copies);
  say(saidAdded(made, drawnSections.value));
  if (hadFocus) void focusTable(copies[0]);
  show(made);
}

function turnByKey(degrees: number) {
  const ids = targets();
  if (!ids.length) return;
  if (!selection.value.length) props.editor.select(ids);
  turnSelection(props.editor, props.tableTypes, degrees);
  say(saidTurned(tablesOf(ids), degrees, drawnSections.value));
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || inAField(event)) return;
  // A dialog over the page has the keys.
  if (document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return;
  const command = event.ctrlKey || event.metaKey;
  const plain = !command && !event.altKey;
  const key = event.key.toLowerCase();
  // What is picked up has the keys, on the stage: no shortcut changes the layout under it, and
  // those the editor takes are not the browser's meanwhile either (its bookmark, its select all).
  if (pickedUp.value.length) {
    if (command && !event.altKey && ['a', 'd', 'z', 'y'].includes(key)) event.preventDefault();
    return;
  }
  if (event.key === 'Escape' && gesture) {
    event.preventDefault();
    abandon();
  } else if (event.key === 'Escape' && selection.value.length && mapHasTheKeys()) {
    event.preventDefault();
    props.editor.select([]);
    say('Nothing selected');
  } else if (command && !event.altKey && !event.shiftKey && key === 'a' && mapHasTheKeys()) {
    // Every table, in place of the page's words.
    event.preventDefault();
    props.editor.select(layout.value.tables.map((table) => table.id));
    say(`${plural(layout.value.tables.length, 'table', 'tables')} selected`);
  } else if (command && !event.altKey && key === 'z') {
    event.preventDefault();
    const redo = event.shiftKey;
    // The model undoes nothing under a drag in hand.
    if (gesture || (redo ? !canRedo.value : !canUndo.value)) return;
    if (redo) props.editor.redo();
    else props.editor.undo();
    say(redo ? 'Redid the change' : 'Undid the last change');
  } else if (command && !event.altKey && !event.shiftKey && key === 'y') {
    event.preventDefault();
    if (gesture || !canRedo.value) return;
    props.editor.redo();
    say('Redid the change');
  } else if (command && !event.altKey && !event.shiftKey && key === 'd' && mapHasTheKeys()) {
    // The selection's copy, in place of the browser's bookmark.
    event.preventDefault();
    if (!gesture && !event.repeat) duplicateByKey();
  } else if (plain && key === 'r' && !event.repeat) {
    // Not under a drag or a turn in hand, whose next frame would draw over it.
    if (!targets().length || gesture) return;
    event.preventDefault();
    turnByKey(event.shiftKey ? TURN_STEP : 90);
  } else if (
    plain &&
    !event.shiftKey &&
    (event.key === 'Delete' || event.key === 'Backspace') &&
    mapHasTheKeys()
  ) {
    if (!targets().length || gesture) return;
    event.preventDefault();
    if (!event.repeat) removeByKey();
  } else if (plain && (event.key === '+' || event.key === '=') && mapHasTheKeys()) {
    event.preventDefault();
    zoomByKey(1);
  } else if (plain && (event.key === '-' || event.key === '_') && mapHasTheKeys()) {
    event.preventDefault();
    zoomByKey(-1);
  } else if (plain && !event.shiftKey && event.key === '0' && mapHasTheKeys()) {
    event.preventDefault();
    fit();
  } else if (event.key === ' ' && hovering.value) {
    // Space held over the map is the hand that pans it, not a press of what has the focus: a
    // table of the map included, which a press on it leaves the focus on.
    const onAControl = event.target instanceof Element && event.target.closest('button, a');
    if (onAControl) return;
    event.preventDefault();
    spaceHeld.value = true;
  }
}

/** Zoom a step about the middle of the view, keeping the table the keys are on in it. */
function zoomByKey(direction: 1 | -1) {
  stepZoom(direction);
  const focused = tableOf(focusedTable());
  if (focused) show([focused]);
}

function onWindowKeyup(event: KeyboardEvent) {
  if (event.key === ' ') spaceHeld.value = false;
}

/** The window lost the keys with Space down, so its release will not be heard. */
function onWindowBlur() {
  spaceHeld.value = false;
}

/** How far an arrow key moves what is picked up, in millimetres: 10 cm, and 1 m with Shift. */
const NUDGE_MM = 100;
const LONG_NUDGE_MM = 1000;
const NUDGES: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * The keys on the map, heard before the map hears them. With tables picked up they are the
 * carried tables' (`carriedKey`). Otherwise Enter or Space on a focused table picks it up, with
 * the selection when it is one of several selected, and alone, selected, when it is not;
 * Shift+Enter adds it to the selection or takes it out. With Add table on, Enter or Space places a
 * table at the middle of the view instead. Space with the pointer over the map is the panning
 * hand, unless the focus came to the map by keyboard.
 */
function onStageKeydown(event: KeyboardEvent) {
  const id = tableAt(event);
  if (pickedUp.value.length) {
    carriedKey(event, id);
    return;
  }
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  // Space with the pointer over the map is the panning hand, unless the focus came to the map by
  // keyboard: then the keys are the map's, wherever the pointer was left.
  if (event.key === ' ' && hovering.value && !keysOnMap.value) return;
  // On a table, or on the map itself, which has the focus while it has no table.
  const onTheMap = event.target instanceof Element && event.target.matches('.layout-map');
  if (!id && !onTheMap) return;
  event.preventDefault();
  // Not under a press, a drag or a turn in hand, whose frames reckon from where it began.
  if (event.repeat || gesture) return;
  if (id && event.shiftKey) {
    select(id, true);
    return;
  }
  if (tool.value === 'add') {
    if (!event.shiftKey) placeAtTheMiddle();
    return;
  }
  if (!id) return;
  if (!selection.value.includes(id)) props.editor.select([id]);
  if (props.editor.pickUp(selection.value)) {
    say(saidPickedUp(tablesOf(pickedUp.value), drawnSections.value));
  }
}

/** A key while tables are picked up: an arrow moves them, R turns them, Enter or Space drops them
 *  and Escape puts them back. Tab is left alone: the focus leaves, and they are dropped as it goes. */
function carriedKey(event: KeyboardEvent, focused: string | null) {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const ids = pickedUp.value;
  const sections = drawnSections.value;
  /** The table the keys are on, whose place is said. */
  const lead = () => tableOf(focused) ?? tablesOf(ids)[0];
  const nudge = NUDGES[event.key];
  if (nudge) {
    event.preventDefault();
    const step = event.shiftKey ? LONG_NUDGE_MM : NUDGE_MM;
    const before = lead();
    props.editor.moveTables(ids, nudge[0] * step, nudge[1] * step);
    const after = lead();
    const stayed = before && after && before.xMm === after.xMm && before.yMm === after.yMm;
    // A key held down says where the tables are once, when it is let go (`onStageKeyup`).
    if (event.repeat) unsaidMove = true;
    else say(stayed ? AT_THE_EDGE : saidMoved(tablesOf(ids), after, sections));
    show(tablesOf(ids));
  } else if (event.key.toLowerCase() === 'r') {
    event.preventDefault();
    if (event.repeat) return;
    const by = event.shiftKey ? TURN_STEP : 90;
    turnSelection(props.editor, props.tableTypes, by);
    say(saidTurned(tablesOf(ids), by, sections));
    show(tablesOf(ids));
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!event.repeat) dropWhatIsPickedUp(focused);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    props.editor.putBack();
    say(saidPutBack(tablesOf(ids), lead(), sections));
    show(tablesOf(ids));
  }
}

/** Whether an arrow key held down has moved what is picked up since its place was last said. */
let unsaidMove = false;

function onStageKeyup(event: KeyboardEvent) {
  if (!unsaidMove || !NUDGES[event.key]) return;
  unsaidMove = false;
  const tables = tablesOf(pickedUp.value);
  const lead = tableOf(tableAt(event)) ?? tables[0];
  if (lead) say(saidMoved(tables, lead, drawnSections.value));
}

/** Put down what is picked up, where the keys left it, and say where. */
function dropWhatIsPickedUp(focused: string | null = focusedTable()) {
  const ids = pickedUp.value;
  if (!ids.length) return;
  props.editor.drop();
  const tables = tablesOf(ids);
  const lead = tableOf(focused) ?? tables[0];
  if (lead) say(saidDropped(tables, lead, drawnSections.value));
}

/** A pointer pressed anywhere puts down what the keys picked up, before it does anything else. */
function onWindowPointerDown() {
  dropWhatIsPickedUp();
}

/** So does the focus arriving anywhere but the map: a window that lost the keys with tables in
 *  hand may give the focus back to another control, with no word to the stage that it left. */
function onDocumentFocusIn(event: FocusEvent) {
  if (!pickedUp.value.length) return;
  if (event.target instanceof Node && stage.value?.contains(event.target)) return;
  keysOnMap.value = false;
  dropWhatIsPickedUp(null);
}

/** With Add table on, Enter places a table at the middle of the view, or beside what stands
 *  there, and the focus goes to it. */
function placeAtTheMiddle() {
  const cam = camera.value;
  if (!cam) return;
  const size = typeById.value.get(addTypeId.value) ?? STANDARD_TABLE;
  const taken = [
    ...layout.value.tables.map((table) => tableCorners(table, sizeOf(table))),
    ...layout.value.zones.map((zone) =>
      cornersOf({
        left: zone.xMm,
        top: zone.yMm,
        right: zone.xMm + zone.widthMm,
        bottom: zone.yMm + zone.depthMm,
      }),
    ),
  ];
  const id = place(clearPlace({ xMm: cam.xMm, yMm: cam.yMm }, size, taken, hall.value));
  if (!id) return;
  void focusTable(id);
  show(tablesOf([id]));
}

/** The focus came into the map: by keyboard, the hint says the keys, and the view shows the table
 *  it came to. */
function onStageFocusIn(event: FocusEvent) {
  const target = event.target instanceof Element ? event.target : null;
  keysOnMap.value = Boolean(target?.matches(':focus-visible'));
  const table = keysOnMap.value ? tableOf(tableAt(event)) : null;
  if (table) show([table]);
}

/** The focus left the map, for another control of the page: what is picked up is dropped. A
 *  window that lost the keys altogether gives them back to the same table. */
function onStageFocusOut(event: FocusEvent) {
  const to = event.relatedTarget;
  if (to instanceof Node && stage.value?.contains(to)) return;
  if (!document.hasFocus()) return;
  keysOnMap.value = false;
  dropWhatIsPickedUp(tableAt(event));
}

/**
 * A table that had the focus is gone, removed by a key or taken back by an undo: the focus goes to
 * the nearest table left, or to the map itself when none is, rather than being lost with it.
 */
watch(
  () => layout.value.tables,
  async (now, before) => {
    const id = focusedTable();
    if (!id || now.some((table) => table.id === id)) return;
    const was = before.find((table) => table.id === id);
    const next = was ? nearestTo(was, now) : (now[0] ?? null);
    await nextTick();
    if (document.activeElement && document.activeElement !== document.body) return;
    if (next) await focusTable(next.id);
    else stage.value?.querySelector<SVGElement>('.layout-map')?.focus();
  },
);

// ── The toolbar: one Tab stop, the arrow keys between its buttons ────────────

const toolbar = ref<HTMLElement | null>(null);
/** The button of the toolbar that Tab stops on. */
const toolbarStop = ref('select');

const canUndo = computed(() => props.editor.canUndo.value);
const canRedo = computed(() => props.editor.canRedo.value);

function toolbarButtons(): HTMLButtonElement[] {
  return [...(toolbar.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
}

/** The stop is the button named, or the first that can be pressed when that one cannot. */
const effectiveStop = computed(() => {
  const off =
    (toolbarStop.value === 'undo' && !canUndo.value) ||
    (toolbarStop.value === 'redo' && !canRedo.value);
  return off ? 'select' : toolbarStop.value;
});

function onToolbarKeydown(event: KeyboardEvent) {
  const step =
    event.key === 'ArrowRight'
      ? 1
      : event.key === 'ArrowLeft'
        ? -1
        : event.key === 'Home'
          ? 0
          : null;
  if (step === null && event.key !== 'End') return;
  const buttons = toolbarButtons();
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  event.preventDefault();
  const next =
    event.key === 'End'
      ? buttons.length - 1
      : step === 0
        ? 0
        : (at + step! + buttons.length) % buttons.length;
  buttons[next].focus();
}

function onToolbarFocus(event: FocusEvent) {
  const name = (event.target as HTMLElement).dataset.tool;
  if (name) toolbarStop.value = name;
}

/**
 * Undo or Redo emptied while it had the focus, by its own press or by a key (Ctrl+Z down to
 * nothing, a change that drops what was undone): the focus goes to the other of the two, else to
 * Select, rather than being lost with a button that can no longer be pressed.
 */
watch([canUndo, canRedo], async ([undoable, redoable]) => {
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.tool;
  if (!(focused === 'undo' && !undoable) && !(focused === 'redo' && !redoable)) return;
  if (!toolbar.value?.contains(document.activeElement)) return;
  await nextTick();
  const next =
    focused === 'undo' && redoable ? 'redo' : focused === 'redo' && undoable ? 'undo' : 'select';
  toolbar.value?.querySelector<HTMLButtonElement>(`[data-tool="${next}"]`)?.focus();
});

// ── The turn handle ──────────────────────────────────────────────────────────

/** Where the handle stands: over the middle of the selection's box. */
const handle = computed(() => {
  if (tool.value !== 'select') return null;
  const box = selectionBounds(layout.value, selection.value, props.tableTypes);
  return box ? { xMm: (box.left + box.right) / 2, yMm: box.top } : null;
});

onMounted(() => {
  measure();
  if (stage.value) {
    if (typeof ResizeObserver !== 'undefined') {
      resize = new ResizeObserver(measure);
      resize.observe(stage.value);
    }
    // Not passive: the wheel over the map moves the map, never the page.
    stage.value.addEventListener('wheel', onWheel, { passive: false });
  }
  window.addEventListener('keydown', onWindowKeydown);
  window.addEventListener('keyup', onWindowKeyup);
  window.addEventListener('blur', onWindowBlur);
  window.addEventListener('pointerdown', onWindowPointerDown, true);
  document.addEventListener('focusin', onDocumentFocusIn);
});

onBeforeUnmount(() => {
  resize?.disconnect();
  stage.value?.removeEventListener('wheel', onWheel);
  window.removeEventListener('keydown', onWindowKeydown);
  window.removeEventListener('keyup', onWindowKeyup);
  window.removeEventListener('blur', onWindowBlur);
  window.removeEventListener('pointerdown', onWindowPointerDown, true);
  document.removeEventListener('focusin', onDocumentFocusIn);
  props.editor.putBack();
  abandon();
});

// Another layout (the location switched) is seen whole.
watch(
  () => layout.value.id,
  () => {
    props.editor.putBack();
    abandon();
    fit();
  },
);
</script>

<template>
  <div class="layout-editor" data-testid="layout-editor">
    <div
      ref="toolbar"
      class="layout-toolbar"
      role="toolbar"
      aria-label="Layout tools"
      data-testid="layout-toolbar"
      @keydown="onToolbarKeydown"
      @focusin="onToolbarFocus"
    >
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        data-tool="select"
        data-testid="layout-tool-select"
        :aria-pressed="tool === 'select'"
        :tabindex="effectiveStop === 'select' ? 0 : -1"
        @click="tool = 'select'"
      >
        Select
      </button>
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        data-tool="add"
        data-testid="layout-tool-add"
        :aria-pressed="tool === 'add'"
        :tabindex="effectiveStop === 'add' ? 0 : -1"
        @click="tool = 'add'"
      >
        Add table
      </button>
      <span class="layout-toolbar__rule" role="separator" aria-orientation="vertical" />
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        data-tool="undo"
        data-testid="layout-undo"
        :disabled="!canUndo"
        :tabindex="effectiveStop === 'undo' ? 0 : -1"
        @click="editor.undo()"
      >
        Undo
      </button>
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        data-tool="redo"
        data-testid="layout-redo"
        :disabled="!canRedo"
        :tabindex="effectiveStop === 'redo' ? 0 : -1"
        @click="editor.redo()"
      >
        Redo
      </button>
      <span class="layout-toolbar__rule" role="separator" aria-orientation="vertical" />
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        data-tool="zoom-out"
        data-testid="layout-zoom-out"
        :tabindex="effectiveStop === 'zoom-out' ? 0 : -1"
        @click="stepZoom(-1)"
      >
        Zoom out
      </button>
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        data-tool="zoom-in"
        data-testid="layout-zoom-in"
        :tabindex="effectiveStop === 'zoom-in' ? 0 : -1"
        @click="stepZoom(1)"
      >
        Zoom in
      </button>
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        data-tool="fit"
        data-testid="layout-fit"
        :tabindex="effectiveStop === 'fit' ? 0 : -1"
        @click="fit"
      >
        Fit
      </button>
      <span class="layout-toolbar__zoom" data-testid="layout-zoom">
        <span class="visually-hidden">Zoom </span>{{ zoomText }}
      </span>
    </div>

    <div v-if="tool === 'add'" class="layout-options" data-testid="layout-add-options">
      <label class="layout-option">
        <span class="layout-option__name">Section</span>
        <select
          v-model="addSectionId"
          class="field field--select layout-option__field"
          data-testid="layout-add-section"
        >
          <option v-for="section in ownSections" :key="section.id" :value="section.id">
            {{ section.name || 'Unnamed section' }}
          </option>
          <option value="">No section</option>
        </select>
      </label>
      <label class="layout-option">
        <span class="layout-option__name">Table type</span>
        <select
          v-model="addTypeId"
          class="field field--select layout-option__field"
          data-testid="layout-add-type"
        >
          <option v-for="type in tableTypes" :key="type.id" :value="type.id">
            {{ type.name }}
          </option>
        </select>
      </label>
    </div>

    <div
      ref="stage"
      class="layout-stage"
      :class="{
        'layout-stage--add': tool === 'add',
        'layout-stage--hand': spaceHeld,
        'layout-stage--dragging': dragging,
      }"
      :style="{ aspectRatio: `${layout.imageWidth ?? 4} / ${layout.imageHeight ?? 3}` }"
      data-testid="layout-stage"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="endGesture($event, false)"
      @pointercancel="endGesture($event, true)"
      @pointerenter="hovering = true"
      @pointerleave="hovering = false"
      @keydown.capture="onStageKeydown"
      @keyup="onStageKeyup"
      @focusin="onStageFocusIn"
      @focusout="onStageFocusOut"
    >
      <LayoutMap
        :layout="layout"
        :locationName="locationName"
        :sections="sections"
        :tableTypes="tableTypes"
        :imageUrl="imageUrl"
        :view="view"
        :selection="selection"
        :guides="guides"
        :carried="pickedUp"
        :aria-describedby="keysId"
        mode="edit"
      >
        <template #default="{ mmPerPx }">
          <rect
            v-if="selectBox"
            class="layout-select-box"
            :x="selectBox.left"
            :y="selectBox.top"
            :width="selectBox.right - selectBox.left"
            :height="selectBox.bottom - selectBox.top"
            fill="var(--mm-blue)"
            fill-opacity="0.08"
            stroke="var(--mm-blue)"
            stroke-width="1"
            stroke-dasharray="4 4"
            vector-effect="non-scaling-stroke"
            aria-hidden="true"
            data-testid="layout-select-box"
          />
          <g
            v-if="handle"
            class="layout-turn-handle"
            data-turn-handle
            data-testid="layout-turn-handle"
            aria-hidden="true"
          >
            <line
              :x1="handle.xMm"
              :y1="handle.yMm - 5 * mmPerPx"
              :x2="handle.xMm"
              :y2="handle.yMm - 17 * mmPerPx"
              stroke="var(--mm-black)"
              stroke-width="1.5"
              vector-effect="non-scaling-stroke"
            />
            <!-- A thumb's reach round a 14 px knob. -->
            <circle
              :cx="handle.xMm"
              :cy="handle.yMm - 24 * mmPerPx"
              :r="14 * mmPerPx"
              fill="transparent"
            />
            <circle
              :cx="handle.xMm"
              :cy="handle.yMm - 24 * mmPerPx"
              :r="7 * mmPerPx"
              fill="white"
              stroke="var(--mm-black)"
              stroke-width="1.5"
              vector-effect="non-scaling-stroke"
              data-testid="layout-turn-knob"
            />
          </g>
        </template>
      </LayoutMap>
    </div>

    <p class="layout-hint" data-testid="layout-hint">{{ hint }}</p>
    <p :id="keysId" class="visually-hidden" data-testid="layout-map-keys">{{ mapKeys }}</p>
  </div>
</template>

<style scoped>
.layout-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.layout-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.layout-toolbar__rule {
  align-self: stretch;
  width: 1px;
  margin: 0 var(--space-1);
  background: var(--mm-border);
}

.layout-toolbar__zoom {
  min-width: 3rem;
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--mm-black);
}

.layout-options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-4);
}

.layout-option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.layout-option__name {
  white-space: nowrap;
}

.layout-option__field {
  width: 14rem;
  max-width: 100%;
}

/* The stage is a window onto the hall, at the floorplan's shape and never taller than leaves the
   toolbar and the hint on the screen with it (the bars, the head row and the toolbar above it and
   the hint under it take 23.5rem between them): the hall is moved inside it, so nothing is cut off
   that a pan does not reach. `touch-action: none`: a finger on the map moves the map. */
.layout-stage {
  position: relative;
  width: 100%;
  min-height: 20rem;
  max-height: max(20rem, calc(100vh - 23.5rem));
  overflow: hidden;
  background: var(--mm-beige);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  touch-action: none;
  user-select: none;
}

/* Round the hall the stage is a pasteboard, a step darker than the floor, so where the floorplan
   ends reads at any pan and zoom, whatever the venue's image shows of its own edge. */
/* With a tool's options strip above it the stage gives up the strip's height, so the hint stays on
   the screen. */
.layout-stage--add {
  max-height: max(20rem, calc(100vh - 26.5rem));
}

.layout-stage :deep(.layout-map) {
  background: var(--mm-beige);
}

/* While the keys are on the map the stage wears the halo, round the whole map: on one of its
   tables, which draws its own border too, or on the map itself while it has no table. The map
   draws none of its own, which the stage would cut off at its edge. */
.layout-stage:has(:focus-visible) {
  box-shadow: var(--focus-halo);
}

.layout-stage :deep(.layout-map:focus-visible) {
  outline: none;
  box-shadow: none;
}

.layout-stage :deep(.layout-table--button) {
  cursor: move;
}

/* A section's name is dragged to where it should stand; elsewhere a press on it is the floor's. */
.layout-stage :deep(.layout-map__label) {
  pointer-events: auto;
  cursor: grab;
}

.layout-select-box {
  pointer-events: none;
}

.layout-stage--add,
.layout-stage--add :deep(.layout-table--button),
.layout-stage--add :deep(.layout-map__label) {
  cursor: crosshair;
}

.layout-stage--hand,
.layout-stage--hand :deep(.layout-table--button),
.layout-stage--hand :deep(.layout-map__label) {
  cursor: grab;
}

.layout-stage--dragging,
.layout-stage--dragging :deep(.layout-table--button),
.layout-stage--dragging :deep(.layout-map__label) {
  cursor: grabbing;
}

.layout-turn-handle {
  cursor: grab;
}

.layout-hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
