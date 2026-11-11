<script setup lang="ts">
/**
 * A layout's editor (T257): a toolbar over the map, the map on a stage that pans and zooms, and a
 * hint line under it. It draws the layout's working copy (`useLayoutEditor.ts`) through the one
 * drawing (`LayoutMap.vue`, in `edit` mode) and turns what the pointer and the keys do into the
 * model's commands; it holds no table of its own.
 *
 * Select: a press on a table selects it (Shift or Ctrl adds it or takes it out), a drag moves the
 * selection, snapping to the edges and centres of the tables that stand still within 8 px, with a
 * guide drawn, and freely with Alt; a press on the floor selects nothing. The handle over the
 * selection turns it about its middle in 15° steps (Alt: freely); R turns it a quarter. Add table:
 * a click places a table of the options strip's section and type at the point, and the tool stays
 * on. A drag or a turn is one change, and Escape puts it back.
 *
 * The view: the wheel or two fingers pan, Ctrl and the wheel or a pinch zoom about the pointer,
 * 10% to 800%; Space and a drag, or the middle button, pan; the buttons step the zoom and Fit shows
 * the whole floorplan. Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y undo and redo from anywhere on the page but
 * a field.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { FloorplanTable, SectionObject, TableTypeObject } from '@/assets/types/datatypes';
import LayoutMap, { type MapView } from './LayoutMap.vue';
import { layoutSections } from './layoutDrawing';
import {
  STANDARD_TABLE,
  angleFrom,
  fitCamera,
  hallOf,
  snapAngle,
  snapMove,
  steppedZoom,
  tableBounds,
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

const layout = computed(() => props.editor.layout.value!);
const selection = computed(() => props.editor.selection.value);
const hall = computed(() => hallOf(layout.value));
const typeById = computed(() => new Map(props.tableTypes.map((type) => [type.id, type])));
const boundsOf = (table: FloorplanTable): Bounds =>
  tableBounds(table, typeById.value.get(table.tableTypeId) ?? STANDARD_TABLE);

// ── The tools ────────────────────────────────────────────────────────────────

type Tool = 'select' | 'add';
const tool = ref<Tool>('select');

const ownSections = computed(() =>
  layoutSections(layout.value, props.sections).map(({ section }) => section),
);
/** The section and the type a new table takes: the first of each until another is chosen. */
const addSectionId = ref('');
const addTypeId = ref('');
watch(
  [ownSections, () => props.tableTypes],
  ([sections, types]) => {
    if (!sections.some((section) => section.id === addSectionId.value)) {
      addSectionId.value = sections[0]?.id ?? '';
    }
    if (!types.some((type) => type.id === addTypeId.value)) addTypeId.value = types[0]?.id ?? '';
  },
  { immediate: true },
);

const hint = computed(() =>
  tool.value === 'add'
    ? 'Click the floor to place a table. Ctrl and the wheel zoom, and Space and a drag move the view.'
    : 'Drag a table to move it: it snaps to the tables near it, and Alt places it freely. ' +
      'Drag the handle over a selected table to turn it, or press R for a quarter turn.',
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

function onWheel(event: WheelEvent) {
  const cam = camera.value;
  if (!cam) return;
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    camera.value = zoomedAbout(cam, Math.exp(-event.deltaY * 0.01), fromMiddle(event));
    return;
  }
  // A mouse's wheel says lines, a trackpad pixels.
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
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
const TURN_STEP = 15;

type Gesture =
  | { kind: 'pan'; from: { x: number; y: number }; camera: Camera }
  | { kind: 'add'; from: { x: number; y: number } }
  | { kind: 'floor'; from: { x: number; y: number } }
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
  | { kind: 'turn'; ids: string[]; centre: PointMm; fromAngle: number; begun: boolean }
  | { kind: 'pinch'; distance: number; middle: { xPx: number; yPx: number }; camera: Camera };

let gesture: Gesture | null = null;
const guides = shallowRef<Guide[]>([]);
const dragging = ref(false);
const spaceHeld = ref(false);
const hovering = ref(false);
/** The touches on the stage, for a pinch. */
const touches = new Map<number, { x: number; y: number }>();

function tableAt(event: Event): string | null {
  const target = event.target instanceof Element ? event.target : null;
  return target?.closest('[data-table-id]')?.getAttribute('data-table-id') ?? null;
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
      guides.value = [];
      gesture = { kind: 'pinch', ...pinch, camera: cam };
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
    };
  } else if (tool.value === 'add') {
    gesture = { kind: 'add', from };
  } else {
    const id = tableAt(event);
    if (!id) {
      gesture = { kind: 'floor', from };
    } else {
      const toggle = event.shiftKey || event.ctrlKey || event.metaKey;
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
  stage.value.setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (touches.has(event.pointerId)) {
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }
  const cam = camera.value;
  if (!gesture || !cam) return;
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
      const snap = snapMove(moved, gesture.still, SNAP_PX / cam.pxPerMm);
      dxMm += snap.dxMm;
      dyMm += snap.dyMm;
      guides.value = snap.guides;
    }
    props.editor.moveTables(gesture.ids, dxMm, dyMm);
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
    props.editor.turnTables(gesture.ids, by, gesture.centre);
  }
}

function endGesture(event: PointerEvent, cancelled: boolean) {
  touches.delete(event.pointerId);
  const done = gesture;
  if (!done) return;
  // A pinch lasts while two fingers are down; the one left does nothing more.
  gesture = null;
  guides.value = [];
  dragging.value = false;
  if (stage.value?.hasPointerCapture(event.pointerId)) {
    stage.value.releasePointerCapture(event.pointerId);
  }
  if (done.kind === 'move' || done.kind === 'turn') {
    if (!done.begun) {
      if (done.kind === 'move' && done.narrowTo && !cancelled) {
        props.editor.select([done.narrowTo]);
      }
      return;
    }
    if (cancelled) props.editor.cancel();
    else props.editor.end();
    return;
  }
  if (cancelled) return;
  if (done.kind === 'floor') {
    props.editor.select([]);
  } else if (
    done.kind === 'add' &&
    Math.hypot(event.clientX - done.from.x, event.clientY - done.from.y) < DRAG_PX
  ) {
    const at = toMm(event);
    const ids = props.editor.addTables([
      {
        sectionId: addSectionId.value || null,
        tableTypeId: addTypeId.value || (props.tableTypes[0]?.id ?? ''),
        ...at,
      },
    ]);
    props.editor.select(ids);
  }
}

/** Put back a drag or a turn that Escape, or the browser, ended early. */
function abandon() {
  const done = gesture;
  gesture = null;
  guides.value = [];
  dragging.value = false;
  if (done && 'begun' in done && done.begun) props.editor.cancel();
}

// ── The keys ─────────────────────────────────────────────────────────────────

function inAField(event: KeyboardEvent): boolean {
  const target = event.target instanceof HTMLElement ? event.target : null;
  return Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || inAField(event)) return;
  // A dialog over the page has the keys.
  if (document.querySelector('dialog[open]')) return;
  const command = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (event.key === 'Escape' && gesture) {
    event.preventDefault();
    abandon();
  } else if (command && !event.altKey && key === 'z') {
    event.preventDefault();
    if (event.shiftKey) props.editor.redo();
    else props.editor.undo();
  } else if (command && !event.altKey && !event.shiftKey && key === 'y') {
    event.preventDefault();
    props.editor.redo();
  } else if (!command && !event.altKey && !event.shiftKey && key === 'r' && !event.repeat) {
    if (!selection.value.length) return;
    event.preventDefault();
    turnSelection(props.editor, props.tableTypes, 90);
  } else if (event.key === ' ' && hovering.value && !tableAt(event)) {
    // Space held over the map is the hand that pans it, not a press of whatever has the focus.
    const onAControl = event.target instanceof Element && event.target.closest('button, a');
    if (onAControl) return;
    event.preventDefault();
    spaceHeld.value = true;
  }
}

function onWindowKeyup(event: KeyboardEvent) {
  if (event.key === ' ') spaceHeld.value = false;
}

/** Enter or Space on a focused table selects it, as a press does; Shift adds it or takes it out. */
function onStageKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const id = tableAt(event);
  if (!id) return;
  event.preventDefault();
  if (event.repeat) return;
  if (event.shiftKey) select(id, true);
  else props.editor.select([id]);
}

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

/** Undo or redo by its button: when the press empties it, the focus goes to its neighbour rather
 *  than being lost with the button that can no longer be pressed. */
async function byButton(which: 'undo' | 'redo') {
  if (which === 'undo') props.editor.undo();
  else props.editor.redo();
  await nextTick();
  const can = which === 'undo' ? canUndo.value : canRedo.value;
  if (can) return;
  const other = which === 'undo' ? 'redo' : 'undo';
  toolbar.value?.querySelector<HTMLButtonElement>(`[data-tool="${other}"]`)?.focus();
}

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
});

onBeforeUnmount(() => {
  resize?.disconnect();
  stage.value?.removeEventListener('wheel', onWheel);
  window.removeEventListener('keydown', onWindowKeydown);
  window.removeEventListener('keyup', onWindowKeyup);
  abandon();
});

// Another layout (the location switched) is seen whole.
watch(
  () => layout.value.id,
  () => {
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
        @click="byButton('undo')"
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
        @click="byButton('redo')"
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
      @keydown="onStageKeydown"
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
        mode="edit"
      >
        <template #default="{ mmPerPx }">
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
   toolbar and the hint on the screen with it: the hall is moved inside it, so nothing is cut off
   that a pan does not reach. `touch-action: none`: a finger on the map moves the map. */
.layout-stage {
  position: relative;
  width: 100%;
  min-height: 20rem;
  max-height: max(20rem, calc(100vh - 16rem));
  overflow: hidden;
  background: var(--layout-floor);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  touch-action: none;
  user-select: none;
}

.layout-stage :deep(.layout-table--button) {
  cursor: move;
}

.layout-stage--add,
.layout-stage--add :deep(.layout-table--button) {
  cursor: crosshair;
}

.layout-stage--hand,
.layout-stage--hand :deep(.layout-table--button) {
  cursor: grab;
}

.layout-stage--dragging,
.layout-stage--dragging :deep(.layout-table--button) {
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
