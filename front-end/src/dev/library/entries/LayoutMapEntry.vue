<script setup lang="ts">
/**
 * The layout map (T257): `LayoutMap`, the one drawing of a location's layout, on a fixture hall of
 * four sections and 49 tables. It is drawn in each of its modes, read, edit and print; at any
 * zoom, where its edges, names and numbers hold their size on the screen; with the palette's eight
 * colours and a ninth section; and at 400 tables, panned, with the frames it drew read out. Every
 * map here is the real component; the line under each reads out what it holds.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import LayoutMap, { type MapView } from '@/components/layout/LayoutMap.vue';
import LayoutPanelSections from '@/components/layout/LayoutPanelSections.vue';
import { layoutSections, tableName } from '@/components/layout/layoutDrawing';
import { PX_PER_MM_AT_100, hallOf, zoomPercent } from '@/components/layout/layoutGeometry';
import ChoicesForYou from '../parts/ChoicesForYou.vue';
import LibraryPanel from '../parts/LibraryPanel.vue';
import LibrarySection from '../parts/LibrarySection.vue';
import ReadOut from '../parts/ReadOut.vue';
import { bigHall, nineSections, upperHall, type FixtureHall } from '../layoutFixture';

const upper = upperHall();
const nine = nineSections();
const big = bigHall(257);

const nameOf = (hall: FixtureHall, id: string): string => {
  const table = hall.layout.tables.find((t) => t.id === id);
  if (!table) return id;
  return tableName(
    table,
    hall.sections.find((s) => s.id === table.sectionId),
    hall.tableTypes.find((t) => t.id === table.tableTypeId),
  );
};

// ── Read: a press, and the zoom ──────────────────────────────────────────────

const pressed = ref('');
const readFrame = ref<HTMLElement | null>(null);
/** The zoom asked for, as a share of 100% (1 px to 25 mm); null fits the hall. */
const zoom = ref<number | null>(null);
const ZOOMS: { label: string; zoom: number | null }[] = [
  { label: 'Fit', zoom: null },
  { label: '10%', zoom: 0.1 },
  { label: '100%', zoom: 1 },
  { label: '800%', zoom: 8 },
];
/** What the map shows at a zoom: as much of the hall as the box holds, about Silver aisle 5. */
const readView = computed<MapView | null>(() => {
  const frame = readFrame.value;
  if (zoom.value === null || !frame) return null;
  const about = upper.layout.tables.find((t) => t.id === 'sec-silver-5')!;
  const widthMm = frame.clientWidth / (zoom.value * PX_PER_MM_AT_100);
  const heightMm = frame.clientHeight / (zoom.value * PX_PER_MM_AT_100);
  return { xMm: about.xMm - widthMm / 2, yMm: about.yMm - heightMm / 2, widthMm, heightMm };
});
const zoomRead = computed(() => {
  if (zoom.value !== null) return `${zoomPercent(zoom.value * PX_PER_MM_AT_100)}%`;
  const frame = readFrame.value;
  const hall = hallOf(upper.layout);
  if (!frame || !hall) return 'fitted';
  return `fitted, ${zoomPercent(frame.clientWidth / hall.widthMm)}%`;
});

// ── Edit: a selection and a guide ────────────────────────────────────────────

const selection = ['sec-silver-4', 'sec-silver-5', 'sec-silver-6'];
/** A guide down the left edge of Silver aisle's rows, as a snap would show it. */
const guides = [{ x1Mm: 9900, y1Mm: 0, x2Mm: 9900, y2Mm: 24_000 }];

// ── 400 tables, panned ───────────────────────────────────────────────────────

const bigFrame = ref<HTMLElement | null>(null);
const bigView = ref<MapView | null>(null);
const panned = ref('not panned yet');
let frame = 0;

/** Pans the 400-table hall from its west wall to its east at 100% for three seconds, a new view
 *  every frame, and reads out the frames drawn and the slowest of them. */
function pan() {
  const box = bigFrame.value;
  const hall = hallOf(big.layout);
  if (!box || !hall) return;
  cancelAnimationFrame(frame);
  const widthMm = box.clientWidth / PX_PER_MM_AT_100;
  const heightMm = box.clientHeight / PX_PER_MM_AT_100;
  const reach = Math.max(hall.widthMm - widthMm, 0);
  const lasts = 3000;
  let frames = 0;
  let slowest = 0;
  let began = 0;
  let last = 0;
  panned.value = 'panning';
  const step = (now: number) => {
    if (!began) began = now;
    else {
      frames += 1;
      slowest = Math.max(slowest, now - last);
    }
    last = now;
    const share = Math.min((now - began) / lasts, 1);
    bigView.value = {
      xMm: reach * share,
      yMm: (hall.heightMm - heightMm) / 2,
      widthMm,
      heightMm,
    };
    if (share < 1) {
      frame = requestAnimationFrame(step);
      return;
    }
    const seconds = (now - began) / 1000;
    panned.value = `${Math.round(frames / seconds)} frames a second over ${big.layout.tables.length} tables, the slowest frame ${Math.round(slowest)} ms`;
  };
  frame = requestAnimationFrame(step);
}

function fitBig() {
  cancelAnimationFrame(frame);
  bigView.value = null;
  panned.value = 'not panned yet';
}

onBeforeUnmount(() => cancelAnimationFrame(frame));
</script>

<template>
  <LibrarySection
    title="The three modes"
    about="One component draws a layout wherever it is shown. Upper Hall here is 36 m by 24 m, with four sections, 49 tables, a stage and two pillars, over the floorplan a venue might send."
  >
    <LibraryPanel
      class="library-wide"
      label="Read: each table a button, one Tab stop, a press read out"
    >
      <div class="library-demo">
        <div class="library-zooms" role="group" aria-label="Zoom">
          <button
            v-for="option in ZOOMS"
            :key="option.label"
            type="button"
            class="btn btn--compact"
            :class="option.zoom === zoom ? 'btn--primary' : 'btn--secondary'"
            :aria-pressed="option.zoom === zoom"
            :data-testid="`library-map-zoom-${option.label.replace('%', '')}`"
            @click="zoom = option.zoom"
          >
            {{ option.label }}
          </button>
        </div>
        <div ref="readFrame" class="library-map" data-testid="library-map-read">
          <LayoutMap
            :layout="upper.layout"
            :locationName="upper.locationName"
            :sections="upper.sections"
            :tableTypes="upper.tableTypes"
            :imageUrl="upper.imageUrl"
            :view="readView"
            mode="read"
            @activate="pressed = nameOf(upper, $event)"
          />
        </div>
        <ReadOut label="Pressed" :value="pressed" />
        <ReadOut label="Zoom" :value="zoomRead" />
      </div>
    </LibraryPanel>

    <LibraryPanel
      class="library-wide"
      label="Edit: the selection outlined, a guide, nothing emitted"
    >
      <div class="library-demo">
        <div class="library-map" data-testid="library-map-edit">
          <LayoutMap
            :layout="upper.layout"
            :locationName="upper.locationName"
            :sections="upper.sections"
            :tableTypes="upper.tableTypes"
            :imageUrl="upper.imageUrl"
            :selection="selection"
            :guides="guides"
            mode="edit"
          />
        </div>
        <ReadOut label="Selected" :value="selection.map((id) => nameOf(upper, id))" />
      </div>
    </LibraryPanel>

    <LibraryPanel class="library-wide" label="Print: a picture, without the floorplan">
      <div class="library-demo">
        <div class="library-map library-map--print" data-testid="library-map-print">
          <LayoutMap
            :layout="upper.layout"
            :locationName="upper.locationName"
            :sections="upper.sections"
            :tableTypes="upper.tableTypes"
            :showImage="false"
            mode="print"
          />
        </div>
        <ReadOut label="Keyboard stops" :value="null" />
      </div>
    </LibraryPanel>

    <LibraryPanel label="The page's list of the same sections">
      <LayoutPanelSections
        class="library-sections"
        :locationName="upper.locationName"
        :sections="layoutSections(upper.layout, upper.sections)"
      />
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection title="The states" about="What a layout meets on a real market.">
    <LibraryPanel
      class="library-wide"
      label="Nine sections: the palette's eight colours, the ninth the first again; two tables in no section; a name placed by hand"
    >
      <div class="library-demo">
        <div class="library-map" data-testid="library-map-nine">
          <LayoutMap
            :layout="nine.layout"
            :locationName="nine.locationName"
            :sections="nine.sections"
            :tableTypes="nine.tableTypes"
            :imageUrl="nine.imageUrl"
            mode="read"
          />
        </div>
        <ReadOut
          label="Colours"
          :value="
            layoutSections(nine.layout, nine.sections).map(
              ({ section, color }) => `${section.name}: ${color}`,
            )
          "
        />
      </div>
    </LibraryPanel>

    <LibraryPanel class="library-wide" :label="`${big.layout.tables.length} tables, panned`">
      <div class="library-demo">
        <div class="library-zooms">
          <button
            type="button"
            class="btn btn--secondary btn--compact"
            data-testid="library-map-pan"
            @click="pan"
          >
            Pan across
          </button>
          <button
            type="button"
            class="btn btn--secondary btn--compact"
            data-testid="library-map-pan-fit"
            @click="fitBig"
          >
            Fit
          </button>
        </div>
        <div ref="bigFrame" class="library-map" data-testid="library-map-big">
          <LayoutMap
            :layout="big.layout"
            :locationName="big.locationName"
            :sections="big.sections"
            :tableTypes="big.tableTypes"
            :imageUrl="big.imageUrl"
            :view="bigView"
            mode="read"
          />
        </div>
        <ReadOut label="Panned" :value="panned" />
      </div>
    </LibraryPanel>
  </LibrarySection>

  <ChoicesForYou>
    <li>
      <strong>The palette:</strong> gold, blue, terracotta and green from the prototype, then
      violet, teal, rose and olive, each a tint with its hue as the edge. A section's style stores
      the colour's number, so the order is kept once layouts exist.
    </li>
    <li>
      <strong>What 100% is:</strong> 1 px to 25 mm, at which a 6 ft table is 73 by 30 px. A hall
      fitted to its box reads its own percentage, as the read-out above says.
    </li>
    <li>
      <strong>A number on a turned table:</strong> turned with it, as the spec says, and never
      upside down; a table turned a quarter reads top to bottom. Upright always would read easier
      and no longer follow the table.
    </li>
    <li>
      <strong>A table too small for its number:</strong> the number shrinks to fit, to 6 px, then is
      left out, as at 10%.
    </li>
    <li>
      <strong>A section's name:</strong> beside its own tables on the longer side of their box,
      toward the middle of the hall, so Gold row's stands by its column and not out on the floor
      inside its corner.
    </li>
    <li>
      <strong>A focused table:</strong> the app's button border in the deep green, over the table's
      own edge. A wider ring outside the edge would show more among 49 tables and would cover its
      neighbours.
    </li>
  </ChoicesForYou>
</template>

<style scoped>
.library-wide {
  grid-column: 1 / -1;
}

.library-demo {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
}

.library-zooms {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

/* A target is never narrower than it is tall. */
.library-zooms .btn {
  min-width: var(--target-min);
}

/* The box a page gives the map: the hall's shape, here 3 to 2. */
.library-map {
  width: 100%;
  aspect-ratio: 3 / 2;
  overflow: hidden;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
}

.library-sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
}
</style>
