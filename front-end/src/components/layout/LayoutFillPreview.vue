<script setup lang="ts">
/**
 * What the Fill an area tool draws over the map (T257): the box a drag is drawing, or the shape
 * whose corners are being clicked, with each corner, the first ringed while a click on it would
 * close the shape; the area once closed, shaded, while its dialog is open; and the crosshair the
 * keys move, with a lead from the last corner to it. A shape whose sides cross is drawn in the
 * refusal's red, since it cannot be closed. It is a picture of `layoutFill.ts`'s state, in the
 * map's millimetres, and takes no press: the editor finds a corner under the pointer by where it
 * is.
 */
import { computed } from 'vue';
import LayoutCrosshair from './LayoutCrosshair.vue';
import { cornersOf, type Bounds, type PointMm } from './layoutGeometry';
import type { FillArea } from './layoutFill';

const props = defineProps<{
  /** The corners clicked, and the pointer's place after them. */
  outline: readonly PointMm[];
  /** The corners clicked. */
  points: readonly PointMm[];
  /** The box a drag in hand is drawing. */
  box: Bounds | null;
  /** The area closed, or what is in view, while the dialog asks how to fill it. */
  area: FillArea | null;
  /** Whether a click on the first corner would close the shape: that corner wears a ring. */
  closes?: boolean;
  /** Whether the shape's sides cross, so it cannot be closed. */
  crosses?: boolean;
  crosshair: PointMm | null;
  /** A screen pixel in the map's millimetres. */
  mmPerPx: number;
}>();

const px = (value: number) => value * props.mmPerPx;
const spelled = (points: readonly PointMm[]) =>
  points.map((point) => `${point.xMm},${point.yMm}`).join(' ');

/** The shaded shape: the box in hand, the area closed, or the corners as a click on the first
 *  would close them. */
const shaded = computed(() => {
  if (props.box) return spelled(cornersOf(props.box));
  if (props.area) {
    return spelled(props.area.kind === 'box' ? cornersOf(props.area.box) : props.area.corners);
  }
  return props.closes ? spelled(props.points) : null;
});
const line = computed(() => (props.outline.length > 1 ? spelled(props.outline) : null));
const colour = computed(() => (props.crosses ? 'var(--mm-text-red-on-tint)' : 'var(--mm-blue)'));

/** From the last corner laid to the crosshair: where the next corner would carry the shape. */
const lead = computed(() => {
  const from = props.points.at(-1);
  const to = props.crosshair;
  if (!from || !to || (from.xMm === to.xMm && from.yMm === to.yMm)) return null;
  return { from, to };
});
</script>

<template>
  <g class="layout-fill" aria-hidden="true" data-testid="layout-fill-preview">
    <polygon
      v-if="shaded"
      :points="shaded"
      fill="var(--mm-blue)"
      fill-opacity="0.1"
      stroke="var(--mm-blue)"
      stroke-width="1.5"
      stroke-dasharray="5 3"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
      data-testid="layout-fill-area"
    />
    <polyline
      v-if="line && !area"
      :points="line"
      fill="none"
      :stroke="colour"
      stroke-width="2"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
      :data-crosses="crosses ? '' : undefined"
      data-testid="layout-fill-line"
    />
    <line
      v-if="lead"
      :x1="lead.from.xMm"
      :y1="lead.from.yMm"
      :x2="lead.to.xMm"
      :y2="lead.to.yMm"
      stroke="var(--mm-blue)"
      stroke-width="1"
      stroke-dasharray="4 4"
      vector-effect="non-scaling-stroke"
    />
    <template v-if="!area">
      <circle
        v-if="closes && points.length"
        :cx="points[0].xMm"
        :cy="points[0].yMm"
        :r="px(11)"
        fill="none"
        stroke="var(--mm-blue)"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
        data-testid="layout-fill-close"
      />
      <circle
        v-for="(point, index) in points"
        :key="index"
        :cx="point.xMm"
        :cy="point.yMm"
        :r="px(5)"
        fill="white"
        :stroke="colour"
        stroke-width="2"
        vector-effect="non-scaling-stroke"
        data-testid="layout-fill-point"
      />
    </template>
    <LayoutCrosshair
      v-if="crosshair"
      :at="crosshair"
      :mmPerPx="mmPerPx"
      data-testid="layout-fill-crosshair"
    />
  </g>
</template>

<style scoped>
/* A picture only: a press goes through it to the floor, where the editor reads it. */
.layout-fill {
  pointer-events: none;
  user-select: none;
}
</style>
