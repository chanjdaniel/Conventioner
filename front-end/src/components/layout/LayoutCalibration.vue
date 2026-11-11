<script setup lang="ts">
/**
 * A layout's scale, set by a line of known length drawn over its floorplan (T257).
 *
 * The image is drawn in an SVG whose user units are the image's pixels, so a point of the line is
 * a point of the image whatever size the page draws it. By pointer, a drag across the image draws
 * the line, and either end can be dragged after. By keyboard, the image is one Tab stop: a
 * crosshair starts at its centre, the arrow keys move it (Shift: ten times as far), Enter sets the
 * first end and then the second, and Escape lets go of a first end; a polite live region says each
 * step. The length is typed in m, cm, mm, ft or in (m first), and "Set the scale" emits the line
 * and its length in millimetres, which the page saves as the layout's scale
 * (`calibration.ts#pxPerMm`). Recalibrating starts from the line stored. The hint and the form stand
 * above the image, where the editor's toolbar will, so the image may take the column's height and
 * "Set the scale" stays in view at a desk.
 */
import { computed, onMounted, onUnmounted, ref, useId } from 'vue';
import {
  LENGTH_UNITS,
  MIN_LINE_PX,
  clampToImage,
  lengthMm as typedLengthMm,
  pixelLength,
  type LengthUnit,
  type Point,
} from './calibration';

const props = defineProps<{
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  /** Whose floorplan it is, for the image's name. */
  locationName: string;
  /** The line stored by the last calibration, which recalibrating starts from. */
  start?: Point | null;
  end?: Point | null;
  lengthMm?: number | null;
  /** True while the page saves the scale. */
  busy?: boolean;
  /** Offered when the layout already has a scale, to keep it. */
  cancellable?: boolean;
  /** What the way out says: "Keep the scale" unless told; a replaced image's keeps the old one. */
  cancelLabel?: string;
}>();

const emit = defineEmits<{
  set: [line: { start: Point; end: Point; lengthMm: number }];
  cancel: [];
}>();

const id = useId();
const hintId = `${id}-hint`;
const keysId = `${id}-keys`;

const svg = ref<SVGSVGElement | null>(null);
const line = ref<{ start: Point; end: Point } | null>(
  props.start && props.end ? { start: [...props.start], end: [...props.end] } : null,
);

/** The length field, prefilled in metres from the stored line when there is one. */
const typed = ref(props.lengthMm ? String(Math.round(props.lengthMm) / 1000) : '');
const unit = ref<LengthUnit>('m');
const error = ref('');
const announced = ref('');

/** How many screen pixels an image pixel is drawn at, so the handles keep their size on screen. */
const drawnScale = ref(1);
let resize: ResizeObserver | null = null;

function measure() {
  const matrix = svg.value?.getScreenCTM();
  if (matrix && matrix.a > 0) drawnScale.value = matrix.a;
}

onMounted(() => {
  measure();
  if (svg.value && typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(measure);
    resize.observe(svg.value);
  }
});
onUnmounted(() => resize?.disconnect());

/** A length on screen, in the image's units. */
const onScreen = (px: number) => px / drawnScale.value;

function imagePoint(event: PointerEvent): Point {
  const matrix = svg.value?.getScreenCTM();
  if (!svg.value || !matrix) return [0, 0];
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return clampToImage([point.x, point.y], props.imageWidth, props.imageHeight);
}

/** Which end a drag moves: 0 the start, 1 the end. */
const dragging = ref<0 | 1 | null>(null);

function onPress(event: PointerEvent) {
  if (props.busy || event.button !== 0) return;
  const point = imagePoint(event);
  line.value = { start: point, end: [...point] };
  dragging.value = 1;
  svg.value?.setPointerCapture?.(event.pointerId);
  error.value = '';
}

function grab(end: 0 | 1, event: PointerEvent) {
  if (props.busy || event.button !== 0) return;
  dragging.value = end;
  svg.value?.setPointerCapture?.(event.pointerId);
}

function onMove(event: PointerEvent) {
  if (dragging.value === null || !line.value) return;
  const point = imagePoint(event);
  if (dragging.value === 0) line.value = { ...line.value, start: point };
  else line.value = { ...line.value, end: point };
}

function onRelease(event: PointerEvent) {
  if (dragging.value === null) return;
  dragging.value = null;
  svg.value?.releasePointerCapture?.(event.pointerId);
  if (line.value && pixelLength(line.value.start, line.value.end) >= MIN_LINE_PX) {
    announced.value = 'Line drawn. Type its length.';
  }
}

// ── By keyboard ──────────────────────────────────────────────────────────────

const focused = ref(false);
const crosshair = ref<Point>([props.imageWidth / 2, props.imageHeight / 2]);
/** True between Enter on the first end and Enter on the second. */
const placingSecond = ref(false);
const step = computed(() =>
  Math.max(1, Math.round(Math.max(props.imageWidth, props.imageHeight) / 100)),
);

const MOVES: Record<string, Point> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function onKey(event: KeyboardEvent) {
  if (props.busy) return;
  const move = MOVES[event.key];
  if (move) {
    event.preventDefault();
    const by = step.value * (event.shiftKey ? 10 : 1);
    crosshair.value = clampToImage(
      [crosshair.value[0] + move[0] * by, crosshair.value[1] + move[1] * by],
      props.imageWidth,
      props.imageHeight,
    );
    if (placingSecond.value && line.value) line.value = { ...line.value, end: crosshair.value };
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    error.value = '';
    if (!placingSecond.value) {
      line.value = { start: [...crosshair.value], end: [...crosshair.value] };
      placingSecond.value = true;
      announced.value = 'First end set. Move to the other end and press Enter.';
    } else {
      placingSecond.value = false;
      line.value = line.value && { ...line.value, end: [...crosshair.value] };
      announced.value = 'Line drawn. Type its length.';
    }
    return;
  }
  if (event.key === 'Escape' && placingSecond.value) {
    event.preventDefault();
    placingSecond.value = false;
    line.value = null;
    announced.value = 'Line taken back.';
  }
}

// ── Setting the scale ────────────────────────────────────────────────────────

function submit() {
  const drawn = line.value;
  if (!drawn || pixelLength(drawn.start, drawn.end) < MIN_LINE_PX) {
    error.value = 'Draw a line across something whose length you know first.';
    return;
  }
  const mm = typedLengthMm(typed.value, unit.value);
  if (mm === null) {
    error.value = "Type the line's length as a number.";
    return;
  }
  error.value = '';
  emit('set', { start: drawn.start, end: drawn.end, lengthMm: mm });
}

const ends = computed<Point[]>(() => (line.value ? [line.value.start, line.value.end] : []));
</script>

<template>
  <div class="layout-calibration" data-testid="layout-calibration">
    <p :id="hintId" class="calibration-hint">
      Drag across something whose length you know, like a wall or a door.
    </p>
    <p :id="keysId" class="visually-hidden">
      With the keyboard, the arrow keys move a crosshair and Enter sets each end of the line.
    </p>

    <form class="calibration-form" novalidate @submit.prevent="submit">
      <label class="calibration-field">
        <span class="calibration-label">Length</span>
        <input
          v-model="typed"
          name="length"
          class="field calibration-length"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          data-testid="layout-calibration-length"
        />
      </label>
      <label class="calibration-field">
        <span class="calibration-label">Unit</span>
        <select
          v-model="unit"
          name="unit"
          class="field field--select"
          data-testid="layout-calibration-unit"
        >
          <option v-for="u in LENGTH_UNITS" :key="u.unit" :value="u.unit">{{ u.label }}</option>
        </select>
      </label>
      <button
        type="submit"
        class="btn btn--primary"
        :disabled="busy"
        data-testid="layout-calibration-set"
      >
        Set the scale
      </button>
      <button
        v-if="cancellable"
        type="button"
        class="btn btn--secondary"
        :disabled="busy"
        data-testid="layout-calibration-cancel"
        @click="emit('cancel')"
      >
        {{ cancelLabel ?? 'Keep the scale' }}
      </button>
    </form>
    <p v-if="error" class="calibration-error" role="alert" data-testid="layout-calibration-error">
      {{ error }}
    </p>
    <svg
      ref="svg"
      class="calibration-map"
      :class="{ 'calibration-map--busy': busy }"
      :viewBox="`0 0 ${imageWidth} ${imageHeight}`"
      tabindex="0"
      role="group"
      :aria-label="`${locationName}'s floorplan`"
      :aria-describedby="`${hintId} ${keysId}`"
      data-testid="layout-calibration-map"
      @pointerdown="onPress"
      @pointermove="onMove"
      @pointerup="onRelease"
      @pointercancel="onRelease"
      @keydown="onKey"
      @focus="focused = true"
      @blur="focused = false"
    >
      <image :href="imageUrl" x="0" y="0" :width="imageWidth" :height="imageHeight" />
      <line
        v-if="line"
        class="calibration-line"
        :x1="line.start[0]"
        :y1="line.start[1]"
        :x2="line.end[0]"
        :y2="line.end[1]"
        data-testid="layout-calibration-line"
      />
      <circle
        v-for="(point, i) in ends"
        :key="i"
        class="calibration-end"
        :cx="point[0]"
        :cy="point[1]"
        :r="onScreen(7)"
        :data-testid="`layout-calibration-end-${i}`"
        @pointerdown.stop="grab(i as 0 | 1, $event)"
      />
      <g v-if="focused" class="calibration-crosshair" aria-hidden="true">
        <line
          :x1="crosshair[0] - onScreen(12)"
          :y1="crosshair[1]"
          :x2="crosshair[0] + onScreen(12)"
          :y2="crosshair[1]"
        />
        <line
          :x1="crosshair[0]"
          :y1="crosshair[1] - onScreen(12)"
          :x2="crosshair[0]"
          :y2="crosshair[1] + onScreen(12)"
        />
      </g>
    </svg>

    <p class="visually-hidden" aria-live="polite">{{ announced }}</p>
  </div>
</template>

<style scoped>
.layout-calibration {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.calibration-map {
  display: block;
  width: 100%;
  height: auto;
  max-height: 70vh;
  background: var(--layout-floor);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  cursor: crosshair;
  /* A drag on it draws the line, never scrolls the page. Its focus is the app's soft halo, as any
     keyboard stop's that is no button (primitives.css). */
  touch-action: none;
  user-select: none;
}

.calibration-map--busy {
  cursor: progress;
}

.calibration-line {
  stroke: var(--mm-blue);
  stroke-width: 3;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

.calibration-end {
  fill: white;
  stroke: var(--mm-blue);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  cursor: grab;
}

.calibration-crosshair line {
  stroke: var(--mm-black);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.calibration-hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.calibration-form {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-3);
}

.calibration-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.calibration-label {
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.calibration-length {
  width: 8rem;
}

.calibration-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}
</style>
