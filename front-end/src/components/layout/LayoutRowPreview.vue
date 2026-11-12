<script setup lang="ts">
/**
 * What the Row of tables tool draws over the map while a path is pending (T257): the tables the
 * row would place, in their section's colour and dashed, since they are not tables yet; the path
 * through the points; each point clicked, the first ringed while a click on it would close the
 * path into a shape; how many tables it holds, written at the pointer; and the crosshair the
 * keys move, with a lead from the last point to it while the path takes a further point. A line
 * being drawn by hand has no points yet: it is its line, its tables and its count, and a ring
 * where it began while letting go would close it. It is a picture of
 * `layoutRow.ts`'s state, in the map's millimetres, and takes no press: the editor finds a point
 * under the pointer by where it is.
 */
import { computed } from 'vue';
import { plural } from '@/utils/utils';
import LayoutCrosshair from './LayoutCrosshair.vue';
import { textWidthPx, type Paint } from './layoutDrawing';
import type { PathPose, PointMm, Run, SizeMm } from './layoutGeometry';

const props = defineProps<{
  runs: readonly Run[];
  poses: readonly PathPose[];
  size: SizeMm;
  points: readonly PointMm[];
  /** Where the count is written; null writes none. */
  countAt: PointMm | null;
  crosshair: PointMm | null;
  /** Where letting go would close the path, which wears a ring: its first point, or the place
   *  a line drawn by hand began; null draws none. */
  closeAt?: PointMm | null;
  /** Whether the path takes no further point (a closed shape, a line drawn by hand): the
   *  crosshair leads nowhere from it. */
  finished?: boolean;
  /** The colours of the section the tables would join. */
  paint: Paint;
  /** A screen pixel in the map's millimetres. */
  mmPerPx: number;
}>();

const COUNT_TEXT_PX = 12;
const COUNT_PAD_PX = 8;
const COUNT_HEIGHT_PX = 22;
/** How far from the pointer the count stands, clear of its arrow. */
const COUNT_OFF_PX = 14;

const px = (value: number) => value * props.mmPerPx;
const lines = computed(() =>
  props.runs.map((run) => run.map((point) => `${point.xMm},${point.yMm}`).join(' ')),
);

const countText = computed(() => plural(props.poses.length, 'table', 'tables'));
const count = computed(() => {
  const at = props.countAt;
  if (!at) return null;
  const width = px(textWidthPx(countText.value, COUNT_TEXT_PX) + COUNT_PAD_PX * 2);
  const height = px(COUNT_HEIGHT_PX);
  const x = at.xMm + px(COUNT_OFF_PX);
  const y = at.yMm + px(COUNT_OFF_PX);
  return { x, y, width, height, textX: x + width / 2, textY: y + height / 2 };
});

/** From the last point laid to the crosshair: where the next point would carry the path. */
const lead = computed(() => {
  const from = props.points.at(-1);
  const to = props.crosshair;
  if (props.finished || !from || !to || (from.xMm === to.xMm && from.yMm === to.yMm)) return null;
  return { from, to };
});
</script>

<template>
  <g class="layout-row" aria-hidden="true" data-testid="layout-row-preview">
    <rect
      v-for="(pose, index) in poses"
      :key="index"
      :transform="`translate(${pose.xMm} ${pose.yMm}) rotate(${pose.rotation})`"
      :x="-size.widthMm / 2"
      :y="-size.depthMm / 2"
      :width="size.widthMm"
      :height="size.depthMm"
      rx="40"
      :fill="`var(${paint.fill})`"
      fill-opacity="0.75"
      :stroke="`var(${paint.edge})`"
      stroke-width="1.5"
      stroke-dasharray="5 3"
      vector-effect="non-scaling-stroke"
      data-testid="layout-row-table"
    />
    <polyline
      v-for="(line, index) in lines"
      :key="`line-${index}`"
      :points="line"
      fill="none"
      stroke="var(--mm-blue)"
      stroke-width="2"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
      data-testid="layout-row-line"
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
    <circle
      v-if="closeAt"
      :cx="closeAt.xMm"
      :cy="closeAt.yMm"
      :r="px(11)"
      fill="none"
      stroke="var(--mm-blue)"
      stroke-width="2"
      vector-effect="non-scaling-stroke"
      data-testid="layout-row-close"
    />
    <circle
      v-for="(point, index) in points"
      :key="`point-${index}`"
      :cx="point.xMm"
      :cy="point.yMm"
      :r="px(5)"
      fill="white"
      stroke="var(--mm-blue)"
      stroke-width="2"
      vector-effect="non-scaling-stroke"
      data-testid="layout-row-point"
    />
    <LayoutCrosshair
      v-if="crosshair"
      :at="crosshair"
      :mmPerPx="mmPerPx"
      data-testid="layout-row-crosshair"
    />
    <g v-if="count" data-testid="layout-row-count">
      <rect
        :x="count.x"
        :y="count.y"
        :width="count.width"
        :height="count.height"
        :rx="px(4)"
        fill="var(--mm-black)"
      />
      <text
        :x="count.textX"
        :y="count.textY"
        :font-size="px(COUNT_TEXT_PX)"
        font-family="Outfit, sans-serif"
        font-weight="600"
        text-anchor="middle"
        dy="0.36em"
        fill="white"
      >
        {{ countText }}
      </text>
    </g>
  </g>
</template>

<style scoped>
/* A picture only: a press goes through it to the floor, where the editor reads it. */
.layout-row {
  pointer-events: none;
  user-select: none;
}
</style>
