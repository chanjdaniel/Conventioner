<script setup lang="ts">
/**
 * The crosshair the keys move over the map (T257), for the tools that take points from it: Row of
 * tables and Fill an area. White under black, so it reads over any floorplan; in the map's
 * millimetres.
 */
defineProps<{
  at: { xMm: number; yMm: number };
  /** A screen pixel in the map's millimetres. */
  mmPerPx: number;
}>();

const ARM_PX = 12;
const STROKES = [
  ['white', 4],
  ['var(--mm-black)', 1.5],
] as const;
</script>

<template>
  <g>
    <template v-for="[stroke, width] in STROKES" :key="stroke">
      <line
        :x1="at.xMm - ARM_PX * mmPerPx"
        :y1="at.yMm"
        :x2="at.xMm + ARM_PX * mmPerPx"
        :y2="at.yMm"
        :stroke="stroke"
        :stroke-width="width"
        vector-effect="non-scaling-stroke"
      />
      <line
        :x1="at.xMm"
        :y1="at.yMm - ARM_PX * mmPerPx"
        :x2="at.xMm"
        :y2="at.yMm + ARM_PX * mmPerPx"
        :stroke="stroke"
        :stroke-width="width"
        vector-effect="non-scaling-stroke"
      />
    </template>
  </g>
</template>
