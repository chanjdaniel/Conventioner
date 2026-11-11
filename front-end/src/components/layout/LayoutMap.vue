<script setup lang="ts">
/**
 * The one drawing of a location's layout (T257), in SVG: the floorplan image faded under the
 * tables, each table at its true size and turn in its section's colour with its number, each
 * section's name in a pill beside its tables, no-table zones hatched, a table in no section grey.
 * The page that reads a layout, its editor, the PNG export and any later map draw this component.
 *
 * The drawing's units are millimetres from the floorplan's top-left corner, so a table is its true
 * size at any zoom, and `view` is the part of the hall shown (the whole hall when not given). What
 * the eye reads in pixels holds its size at every zoom: edges and outlines by
 * `vector-effect: non-scaling-stroke`, and names, numbers, gaps and the hatch by the scale the map
 * measures itself at (`pxPerMm` says it instead where nothing can be measured, as in print).
 *
 * Modes: `read` and `edit` make the map a group named "Upper Hall layout, 49 tables" and each
 * table a button named "Gold row 5, Standard 6 ft", one Tab stop among them (the table focused
 * last, else the first selected, else the first), the arrow keys moving the focus to the nearest
 * table that way. In `read` a table pressed, by pointer, Enter or Space, emits `activate` with
 * its id. `edit` draws the selection's outline and the guides it is given, says each table pressed
 * or not as it is selected or not, draws the tables picked up by keyboard lifted, and leaves what
 * a press does to the editor round it, which may draw over the map in its slot, and move a
 * section's name, which carries its section's id for it. In `edit` a map with no table is itself
 * the Tab stop, so the keys have somewhere to place the first table from.
 * `print` is a picture: no button, no stop. The map owns no editing
 * state: its only state is which table has the focus.
 */
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import type { FloorplanObject, SectionObject, TableTypeObject } from '@/assets/types/datatypes';
import LayoutMapTable from './LayoutMapTable.vue';
import { NO_SECTION_PAINT, layoutSections, mapName, tableName, textWidthPx } from './layoutDrawing';
import {
  STANDARD_TABLE,
  hallOf,
  nearestInDirection,
  numberSizePx,
  sectionLabelAt,
  tableBounds,
  unionOf,
  type Bounds,
  type Direction,
} from './layoutGeometry';

/** The part of the hall a map shows, in millimetres. */
export interface MapView {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

/** An alignment guide, a line in millimetres. */
export interface MapGuide {
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
}

const props = withDefaults(
  defineProps<{
    layout: FloorplanObject;
    /** The layout's location, as the map's name says it. */
    locationName: string;
    /** The plan's sections, each with its location and tier; the map draws its location's. */
    sections: readonly SectionObject[];
    /** The market's table types, which size the tables. */
    tableTypes: readonly TableTypeObject[];
    mode: 'read' | 'edit' | 'print';
    /** The floorplan image, as the page fetched it; none draws the floor alone. */
    imageUrl?: string;
    /** Whether the image is drawn under the tables: unless told, it is in `read` and `edit`, and
     *  is left out of `print`. */
    showImage?: boolean;
    /** The part of the hall shown; the whole hall when not given. */
    view?: MapView | null;
    /** The ids of the selected tables, outlined in `edit`. */
    selection?: readonly string[];
    /** Alignment guides, drawn in `edit`. */
    guides?: readonly MapGuide[];
    /** The ids of the tables picked up by keyboard, drawn lifted in `edit`. */
    carried?: readonly string[];
    /** Screen pixels per millimetre, where the map cannot measure itself (print). */
    pxPerMm?: number;
  }>(),
  {
    imageUrl: '',
    showImage: undefined,
    view: null,
    selection: () => [],
    guides: () => [],
    carried: () => [],
  },
);

const emit = defineEmits<{
  /** A table pressed in `read` mode. */
  activate: [tableId: string];
}>();

const interactive = computed(() => props.mode !== 'print');
const imageShown = computed(() => props.showImage ?? props.mode !== 'print');
const hall = computed(() => hallOf(props.layout));
const typeById = computed(() => new Map(props.tableTypes.map((type) => [type.id, type])));
const drawnSections = computed(() => layoutSections(props.layout, props.sections));

// ── The view and its scale ───────────────────────────────────────────────────

/** A layout with no hall yet (no scale) shows its tables' box with a metre round it. */
const shown = computed<MapView>(() => {
  if (props.view) return props.view;
  if (hall.value) return { xMm: 0, yMm: 0, ...hall.value };
  const box = unionOf(
    props.layout.tables.map((table) =>
      tableBounds(table, typeById.value.get(table.tableTypeId) ?? STANDARD_TABLE),
    ),
  );
  if (!box) return { xMm: 0, yMm: 0, widthMm: 10_000, heightMm: 10_000 };
  return {
    xMm: box.left - 1000,
    yMm: box.top - 1000,
    widthMm: box.right - box.left + 2000,
    heightMm: box.bottom - box.top + 2000,
  };
});

const svg = ref<SVGSVGElement | null>(null);
/** The map's own box on the screen, once it has been measured. */
const box = ref<{ width: number; height: number } | null>(null);
let resize: ResizeObserver | null = null;

function measure() {
  const el = svg.value;
  if (!el) return;
  const { width, height } = el.getBoundingClientRect();
  box.value = width > 0 && height > 0 ? { width, height } : null;
}

/** Words are measured in the app's type, which may arrive after the map is first drawn. */
const typeLoaded = ref(0);

onMounted(() => {
  measure();
  if (svg.value && typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(measure);
    resize.observe(svg.value);
  }
  void document.fonts?.ready.then(() => {
    typeLoaded.value += 1;
  });
});
onBeforeUnmount(() => resize?.disconnect());

/** Screen pixels per millimetre: given, else measured (the view drawn whole in the box, as
 *  `preserveAspectRatio` fits it), else as if the view were 1,000 px across. */
const scale = computed(() => {
  if (props.pxPerMm) return props.pxPerMm;
  const view = shown.value;
  if (box.value) return Math.min(box.value.width / view.widthMm, box.value.height / view.heightMm);
  return 1000 / view.widthMm;
});
const mmPerPx = computed(() => 1 / scale.value);

// ── The tables ───────────────────────────────────────────────────────────────

interface DrawnTable {
  id: string;
  name: string;
  xMm: number;
  yMm: number;
  rotation: number;
  widthMm: number;
  depthMm: number;
  fill: string;
  edge: string;
  number: string;
  numberSizeMm: number;
  bounds: Bounds;
}

/** Every table as it is drawn, section by section in number order, those in no section last, which
 *  is the order a screen reader meets them in. */
const tables = computed<DrawnTable[]>(() => {
  const draw = (
    table: FloorplanObject['tables'][number],
    section: SectionObject | null,
    paint: { fill: string; edge: string },
  ): DrawnTable => {
    const type = typeById.value.get(table.tableTypeId);
    const size = type ?? STANDARD_TABLE;
    const number = section && table.number !== null ? String(table.number) : '';
    return {
      id: table.id,
      name: tableName(table, section, type),
      xMm: table.xMm,
      yMm: table.yMm,
      rotation: table.rotation,
      widthMm: size.widthMm,
      depthMm: size.depthMm,
      ...paint,
      number,
      numberSizeMm: number ? numberSizePx(size, number.length, scale.value) * mmPerPx.value : 0,
      bounds: tableBounds(table, size),
    };
  };
  const inSections = drawnSections.value.flatMap(({ section, paint, tables: own }) =>
    own.map((table) => draw(table, section, paint)),
  );
  const placed = new Set(inSections.map((table) => table.id));
  const inNone = props.layout.tables
    .filter((table) => !placed.has(table.id))
    .map((table) => draw(table, null, NO_SECTION_PAINT));
  return [...inSections, ...inNone];
});

const selected = computed(() => new Set(props.mode === 'edit' ? props.selection : []));
const carriedIds = computed(() => new Set(props.mode === 'edit' ? props.carried : []));

// ── The sections' names ──────────────────────────────────────────────────────

const LABEL_TEXT_PX = 12;
const LABEL_HEIGHT_PX = 22;
const LABEL_PADDING_PX = 10;
const LABEL_GAP_PX = 6;

interface DrawnLabel {
  id: string;
  text: string;
  edge: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Each section's name in a white pill edged in its colour, at the place its style names, else
 *  beside its tables where it covers no table and no other name (`sectionLabelAt`). */
const labels = computed<DrawnLabel[]>(() => {
  void typeLoaded.value;
  const toMm = mmPerPx.value;
  const boundsOf = new Map(tables.value.map((table) => [table.id, table.bounds]));
  const taken = tables.value.map((table) => table.bounds);
  const drawn: DrawnLabel[] = [];
  for (const { section, paint, tables: own } of drawnSections.value) {
    if (!own.length) continue;
    const width = (textWidthPx(section.name, LABEL_TEXT_PX) + LABEL_PADDING_PX * 2) * toMm;
    const height = LABEL_HEIGHT_PX * toMm;
    const style = props.layout.sectionStyles?.find((s) => s.sectionId === section.id);
    const at =
      style?.labelAt ??
      sectionLabelAt({
        own: own.map((table) => boundsOf.get(table.id)!),
        taken,
        hall: hall.value,
        widthMm: width,
        heightMm: height,
        gapMm: LABEL_GAP_PX * toMm,
      });
    if (!at) continue;
    const label = {
      id: section.id,
      text: section.name,
      edge: paint.edge,
      x: at.xMm - width / 2,
      y: at.yMm - height / 2,
      width,
      height,
    };
    drawn.push(label);
    taken.push({
      left: label.x,
      top: label.y,
      right: label.x + width,
      bottom: label.y + height,
    });
  }
  return drawn;
});

// ── The no-table zones ───────────────────────────────────────────────────────

const ZONE_TEXT_PX = 14;
const MIN_ZONE_TEXT_PX = 8;

/** A zone's label is drawn at 14 px where the zone has the room, smaller to fit, and left out of a
 *  zone too small to carry it, such as a pillar; the zone is still named to a screen reader. */
const zones = computed(() => {
  void typeLoaded.value;
  return props.layout.zones.map((zone) => {
    const label = zone.label.trim();
    const widthPx = zone.widthMm * scale.value;
    const heightPx = zone.depthMm * scale.value;
    const fits = label
      ? Math.min(
          ZONE_TEXT_PX,
          heightPx * 0.6,
          (ZONE_TEXT_PX * widthPx * 0.9) / Math.max(textWidthPx(label, ZONE_TEXT_PX), 1),
        )
      : 0;
    return {
      ...zone,
      label,
      name: label ? `No-table zone: ${label}` : 'No-table zone',
      textSizeMm: fits >= MIN_ZONE_TEXT_PX ? fits * mmPerPx.value : 0,
    };
  });
});

const hatchId = `layout-hatch-${useId()}`;

// ── The focus ────────────────────────────────────────────────────────────────

const focusedId = ref<string | null>(null);

/** The one table Tab stops on: the one focused last, else the first selected, else the first. */
const tabStopId = computed(() => {
  const drawn = tables.value;
  if (focusedId.value && drawn.some((table) => table.id === focusedId.value))
    return focusedId.value;
  return drawn.find((table) => selected.value.has(table.id))?.id ?? drawn[0]?.id ?? null;
});

watch(
  () => props.layout.id,
  () => {
    focusedId.value = null;
  },
);

function tableOf(event: Event): string | null {
  const target = event.target instanceof Element ? event.target : null;
  return target?.closest('[data-table-id]')?.getAttribute('data-table-id') ?? null;
}

function onClick(event: MouseEvent) {
  const id = tableOf(event);
  if (id && props.mode === 'read') emit('activate', id);
}

const ARROWS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

function onKeydown(event: KeyboardEvent) {
  // The editor round the map may take a key first, as it does while a table is picked up: on the
  // table or in the capture phase, since a listener of its own round the map hears the key after.
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const id = tableOf(event);
  if (!id) return;
  if ((event.key === 'Enter' || event.key === ' ') && props.mode === 'read') {
    event.preventDefault();
    // A key held down presses once.
    if (!event.repeat) emit('activate', id);
    return;
  }
  const direction = ARROWS[event.key];
  if (!direction || event.shiftKey) return;
  // An arrow on the map never scrolls the page, whether or not a table stands that way.
  event.preventDefault();
  const from = tables.value.find((table) => table.id === id);
  if (!from) return;
  const next = nearestInDirection(
    from,
    tables.value.filter((table) => table.id !== id),
    direction,
  );
  if (!next) return;
  const el = [...(svg.value?.querySelectorAll<SVGGElement>('[data-table-id]') ?? [])].find(
    (table) => table.getAttribute('data-table-id') === next.id,
  );
  el?.focus();
}
</script>

<template>
  <svg
    ref="svg"
    class="layout-map"
    :class="`layout-map--${mode}`"
    xmlns="http://www.w3.org/2000/svg"
    :viewBox="`${shown.xMm} ${shown.yMm} ${shown.widthMm} ${shown.heightMm}`"
    preserveAspectRatio="xMidYMid meet"
    :role="interactive ? 'group' : 'img'"
    :aria-label="mapName(locationName, tables.length)"
    :tabindex="mode === 'edit' && !tables.length ? 0 : undefined"
    data-testid="layout-map"
    @click="onClick"
    @keydown="onKeydown"
  >
    <defs>
      <!-- The hatch of a no-table zone: 45°, 10 px apart on the screen at any zoom. -->
      <pattern
        :id="hatchId"
        width="10"
        height="10"
        patternUnits="userSpaceOnUse"
        :patternTransform="`rotate(45) scale(${mmPerPx})`"
      >
        <rect width="10" height="10" fill="var(--layout-zone-fill)" />
        <line
          x1="0.75"
          y1="0"
          x2="0.75"
          y2="10"
          stroke="var(--layout-zone-hatch)"
          stroke-width="1.5"
        />
      </pattern>
    </defs>

    <rect
      v-if="hall"
      class="layout-map__floor"
      x="0"
      y="0"
      :width="hall.widthMm"
      :height="hall.heightMm"
      fill="var(--layout-floor)"
    />
    <image
      v-if="hall && imageUrl && imageShown"
      class="layout-map__image"
      :href="imageUrl"
      x="0"
      y="0"
      :width="hall.widthMm"
      :height="hall.heightMm"
      preserveAspectRatio="none"
      :opacity="interactive ? 0.5 : undefined"
      aria-hidden="true"
      data-testid="layout-map-image"
    />

    <g
      v-for="zone in zones"
      :key="zone.id"
      class="layout-map__zone"
      :role="interactive ? 'img' : undefined"
      :aria-label="interactive ? zone.name : undefined"
      data-testid="layout-map-zone"
    >
      <rect
        data-testid="layout-map-zone-box"
        :x="zone.xMm"
        :y="zone.yMm"
        :width="zone.widthMm"
        :height="zone.depthMm"
        :rx="4 * mmPerPx"
        :fill="`url(#${hatchId})`"
        stroke="var(--layout-zone-edge)"
        stroke-width="1.5"
        stroke-dasharray="6 4"
        vector-effect="non-scaling-stroke"
      />
      <text
        v-if="zone.textSizeMm > 0"
        data-testid="layout-map-zone-label"
        :x="zone.xMm + zone.widthMm / 2"
        :y="zone.yMm + zone.depthMm / 2"
        :font-size="zone.textSizeMm"
        font-family="Outfit, sans-serif"
        font-weight="600"
        text-anchor="middle"
        dy="0.36em"
        fill="var(--mm-black)"
        aria-hidden="true"
      >
        {{ zone.label }}
      </text>
    </g>

    <template v-if="mode === 'edit'">
      <line
        v-for="(guide, index) in guides"
        :key="index"
        class="layout-map__guide"
        :x1="guide.x1Mm"
        :y1="guide.y1Mm"
        :x2="guide.x2Mm"
        :y2="guide.y2Mm"
        stroke="var(--mm-blue)"
        stroke-width="1"
        stroke-dasharray="4 4"
        vector-effect="non-scaling-stroke"
        aria-hidden="true"
        data-testid="layout-map-guide"
      />
    </template>

    <LayoutMapTable
      v-for="table in tables"
      :id="table.id"
      :key="table.id"
      :name="table.name"
      :xMm="table.xMm"
      :yMm="table.yMm"
      :rotation="table.rotation"
      :widthMm="table.widthMm"
      :depthMm="table.depthMm"
      :fill="table.fill"
      :edge="table.edge"
      :number="table.number"
      :numberSizeMm="table.numberSizeMm"
      :selected="selected.has(table.id)"
      :carried="carriedIds.has(table.id)"
      :pressed="mode === 'edit' ? selected.has(table.id) : undefined"
      :interactive="interactive"
      :tabStop="table.id === tabStopId"
      :mmPerPx="mmPerPx"
      @focused="focusedId = $event"
    />

    <g
      v-for="label in labels"
      :key="label.id"
      class="layout-map__label"
      :data-section-label="label.id"
      aria-hidden="true"
      data-testid="layout-map-label"
    >
      <rect
        data-testid="layout-map-label-pill"
        :x="label.x"
        :y="label.y"
        :width="label.width"
        :height="label.height"
        :rx="label.height / 2"
        fill="white"
        :stroke="`var(${label.edge})`"
        stroke-width="1.5"
        vector-effect="non-scaling-stroke"
      />
      <text
        :x="label.x + label.width / 2"
        :y="label.y + label.height / 2"
        :font-size="LABEL_TEXT_PX * mmPerPx"
        font-family="Outfit, sans-serif"
        font-weight="600"
        text-anchor="middle"
        dy="0.36em"
        fill="var(--mm-black)"
      >
        {{ label.text }}
      </text>
    </g>

    <!-- What the editor draws over the map, in the map's millimetres: the turn handle. -->
    <slot :mmPerPx="mmPerPx" />
  </svg>
</template>

<style scoped>
/* The map fills the box its page gives it, its view drawn whole inside; the ground round a hall
   that does not fill the box is the floor's. */
.layout-map {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--layout-floor);
}

/* The floorplan lies under the tables in grey and at half strength, so the sections' colours are
   the only colours. A printed map that carries the image draws it as it is. */
.layout-map--read .layout-map__image,
.layout-map--edit .layout-map__image {
  filter: grayscale(1);
}

/* A name, a zone and the image are read, never pressed: a press on them is a press on the floor. */
.layout-map__image,
.layout-map__label,
.layout-map__zone text {
  pointer-events: none;
  user-select: none;
}
</style>
