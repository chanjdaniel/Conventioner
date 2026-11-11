<script setup lang="ts">
/**
 * One table of a layout's drawing (T257), for `LayoutMap.vue` alone: a rounded rectangle at its
 * true size about its centre, turned with the table, filled and edged in its section's paint, its
 * number in the middle. Every prop is a plain value, so a table whose own values did not change is
 * not drawn again when another moves.
 *
 * Its paint is written on the elements (`fill="var(--token)"`), not in a class, so the drawing
 * carries what it looks like wherever its markup goes; lengths the eye reads in pixels (the edge,
 * the selection's outline, the focus border) are given in millimetres for the scale it is drawn at.
 *
 * Focus shows as the app's button border, drawn by the table itself: a browser reads a CSS
 * outline's width on an SVG shape in the drawing's units, so the app's 2px outline would be a
 * fraction of a pixel here. The border is a shape over the table's own edge, turned with it, 2px
 * on the screen and never past the edge, so focus moves nothing; and in the deep green
 * (`--focus-border-on-fill`), since the edge it lies over is a section's colour, which the plain
 * green shows on only by chance. The focus sweep reads it by its `data-focus-border`.
 *
 * A table picked up by keyboard (`carried`) is drawn lifted: a shadow 3 px under it, straight down
 * the screen however the table is turned, and its selection's outline dashed.
 */
import { computed } from 'vue';
import { readsUpsideDown } from './layoutGeometry';

const props = defineProps<{
  id: string;
  name: string;
  xMm: number;
  yMm: number;
  rotation: number;
  widthMm: number;
  depthMm: number;
  /** The tokens it is filled and edged with. */
  fill: string;
  edge: string;
  /** Its number, or nothing for a table in no section. */
  number: string;
  /** The number's size, in millimetres at the map's scale; 0 leaves it out. */
  numberSizeMm: number;
  selected: boolean;
  /** Picked up by keyboard, in the editor: drawn lifted off the floor. */
  carried?: boolean;
  /** Whether it is pressed, where a press selects it (the editor); unsaid where it does not. */
  pressed?: boolean;
  /** A button a keyboard reaches, in the read and edit modes; a shape alone in print. */
  interactive: boolean;
  /** The one table of the map the Tab key stops on. */
  tabStop: boolean;
  /** Millimetres to a screen pixel, at the map's scale. */
  mmPerPx: number;
}>();

const emit = defineEmits<{
  /** The table took the focus. It says so itself: a focus listener on the map's `<svg>` would make
   *  Chromium count the map as a Tab stop of its own, before its tables. */
  focused: [id: string];
}>();

/** A corner of 40 mm, as a trestle table's. */
const CORNER_MM = 40;

/** The table's rectangle grown by `px` screen pixels on every side. */
function grown(px: number) {
  const by = px * props.mmPerPx;
  return {
    x: -props.widthMm / 2 - by,
    y: -props.depthMm / 2 - by,
    width: props.widthMm + by * 2,
    height: props.depthMm + by * 2,
    // Drawn inside the edge at a zoom where a pixel is wider than the corner, it has none.
    rx: Math.max(CORNER_MM + by, 0),
  };
}

const top = computed(() => grown(0));
/** The selection's outline: 2.5 px of --mm-black, 3 px outside the table's edge. */
const outline = computed(() => grown(0.75 + 3 + 1.25));
/** The focus border: 2 px over the table's 1.5 px edge, their outer sides together. */
const focusBorder = computed(() => grown(-0.25));

/** How far under a carried table its shadow lies, in screen pixels. */
const LIFT_PX = 3;
/** The shadow's place: down the screen, which in the turned table's own axes is turned back. */
const shadow = computed(() => {
  const turn = (-props.rotation * Math.PI) / 180;
  const by = LIFT_PX * props.mmPerPx;
  return { ...top.value, transform: `translate(${-by * Math.sin(turn)} ${by * Math.cos(turn)})` };
});
</script>

<template>
  <g
    class="layout-table"
    :class="{ 'layout-table--button': interactive }"
    :transform="`translate(${xMm} ${yMm}) rotate(${rotation})`"
    :role="interactive ? 'button' : undefined"
    :tabindex="interactive ? (tabStop ? 0 : -1) : undefined"
    :aria-label="interactive ? name : undefined"
    :aria-pressed="interactive ? pressed : undefined"
    :data-table-id="id"
    :data-selected="selected ? '' : undefined"
    :data-carried="carried ? '' : undefined"
    data-testid="layout-table"
    @focus="emit('focused', id)"
  >
    <rect
      v-if="carried"
      class="layout-table__shadow"
      data-testid="layout-table-shadow"
      v-bind="shadow"
      fill="var(--mm-black)"
      fill-opacity="0.3"
      aria-hidden="true"
    />
    <rect
      class="layout-table__top"
      data-testid="layout-table-top"
      v-bind="top"
      :fill="`var(${fill})`"
      :stroke="`var(${edge})`"
      stroke-width="1.5"
      vector-effect="non-scaling-stroke"
    />
    <rect
      v-if="interactive && tabStop"
      class="layout-table__focus"
      v-bind="focusBorder"
      fill="none"
      stroke="var(--focus-border-on-fill)"
      stroke-width="2"
      vector-effect="non-scaling-stroke"
      data-focus-border
    />
    <rect
      v-if="selected"
      class="layout-table__selected"
      data-testid="layout-table-selected"
      v-bind="outline"
      fill="none"
      stroke="var(--mm-black)"
      stroke-width="2.5"
      :stroke-dasharray="carried ? '6 4' : undefined"
      vector-effect="non-scaling-stroke"
    />
    <text
      v-if="number && numberSizeMm > 0"
      class="layout-table__number"
      data-testid="layout-table-number"
      :transform="readsUpsideDown(rotation) ? 'rotate(180)' : undefined"
      :font-size="numberSizeMm"
      font-family="Outfit, sans-serif"
      font-weight="600"
      text-anchor="middle"
      dy="0.36em"
      fill="var(--mm-black)"
      aria-hidden="true"
    >
      {{ number }}
    </text>
  </g>
</template>

<style scoped>
/* The table draws its own focus border (above), so the outline a button takes from primitives.css,
   too thin to see in a drawing's units, is not drawn as well. */
.layout-table {
  outline: none;
}

.layout-table--button {
  cursor: pointer;
}

.layout-table__focus {
  display: none;
}

.layout-table:focus-visible > .layout-table__focus {
  display: inline;
}

/* A number is read, never pressed or selected: a press on it is a press on its table. */
.layout-table__number {
  pointer-events: none;
  user-select: none;
}
</style>
