<script setup lang="ts">
/**
 * A location's layout, its page (T257): `/markets/:marketId/layout/:locationId`, under the Market
 * Setup tab, in the market's frame like every market page.
 *
 * The head row says where it is and how it stands: "Layout", the switch between the market's
 * named locations (each a link to its own address), the save state and the scale ("36.0 m
 * across", or "Not calibrated"), and the way back to Market Setup. Below it the map column and the
 * side panel, the panel going under the map with less than 1100px of room.
 *
 * A location's layout begins with its floorplan: before an image the map column is the upload's
 * drop zone, and its first save (`layoutSave.ts`) is the layout's start, which the server answers
 * with the layout as stored; before a scale it is the calibration over the image
 * (`LayoutCalibration.vue`), and Recalibrate draws the line again; with a scale it is the layout's
 * drawing (`LayoutMap.vue`), the whole hall, read, drawn over the floor alone while the image is
 * on its way or could not be had, and the panel lists the location's sections in the colours the
 * map draws them in. Each save names the revision it
 * read, and a save over one another tab saved says so with Reload. The page shows the server's
 * answer at once and then re-reads the market through the one store.
 *
 * With no location in the address it opens the market's first named one. A location with no id
 * (a market stored before ids, until its next write) or no name offers no layout.
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { FloorplanObject, LocationObject } from '@/assets/types/datatypes';
import MarketFrame from '@/components/MarketFrame.vue';
import { useOpenMarket } from '@/utils/openMarket';
import { MarketAction, mayTake } from '@/utils/marketActions';
import { layoutPath, marketPath } from '@/utils/market';
import FloorplanUploader from './FloorplanUploader.vue';
import LayoutCalibration from './LayoutCalibration.vue';
import LayoutMap from './LayoutMap.vue';
import LayoutPanelSections from './LayoutPanelSections.vue';
import { metresAcross, pxPerMm, type Point } from './calibration';
import { layoutSections } from './layoutDrawing';
import { saveLayout, saveRefusal, type UploadedFloorplan } from './layoutSave';
import { useFloorplanImage } from './useFloorplanImage';

const route = useRoute();
const router = useRouter();
const marketId = computed(() => String(route.params.marketId ?? ''));
const locationId = computed(() => String(route.params.locationId ?? ''));
const { market, refresh } = useOpenMarket(marketId);

/** The locations a layout can be opened for: named, and with the id a layout names. */
const locations = computed<(LocationObject & { id: string })[]>(() =>
  (market.value?.setupObject?.locations ?? []).filter(
    (location): location is LocationObject & { id: string } =>
      Boolean(location.id) && location.name.trim() !== '',
  ),
);

const location = computed(() => locations.value.find((l) => l.id === locationId.value) ?? null);

// The market's layout address opens its first location's.
watch(
  [market, locationId],
  () => {
    if (market.value && !locationId.value && locations.value.length) {
      void router.replace(layoutPath(market.value.id, locations.value[0].id));
    }
  },
  { immediate: true },
);

/** Whether this person may change the layout here, now. Past Draft the save is refused (until a
 * later ticket narrows it), so the page offers no change there either. */
const editable = computed(
  () => mayTake(market.value, MarketAction.ChangeSetup) && !market.value?.setupLockReason,
);

const stored = computed<FloorplanObject | null>(
  () =>
    (market.value?.setupObject?.floorplans ?? []).find(
      (floorplan) => floorplan.locationId === locationId.value,
    ) ?? null,
);

/** The layout as the last save answered, shown until the store's re-read holds it too. */
const adopted = ref<FloorplanObject | null>(null);
watch(locationId, () => {
  adopted.value = null;
  saveState.value = 'idle';
  recalibrating.value = false;
});

const floorplan = computed<FloorplanObject | null>(() => {
  const answer = adopted.value;
  const held = stored.value;
  if (
    answer &&
    answer.locationId === locationId.value &&
    (!held || answer.revision >= held.revision)
  ) {
    return answer;
  }
  return held;
});

const { url: imageUrl, failed: imageFailed } = useFloorplanImage(
  computed(() => floorplan.value?.imageGridfsId),
);

const scaleText = computed(() => metresAcross(floorplan.value) ?? 'Not calibrated');
const calibrated = computed(() => Boolean(floorplan.value?.scalePxPerUnit));
const recalibrating = ref(false);

/** The location's sections as the map draws them, for the panel's list. */
const sections = computed(() =>
  floorplan.value ? layoutSections(floorplan.value, market.value?.setupObject?.sections ?? []) : [],
);

// ── Saving ───────────────────────────────────────────────────────────────────

const saveState = ref<'idle' | 'saving' | 'saved' | 'failed' | 'stale'>('idle');
const saveMessage = ref('');
/** The save that failed, which Retry sends again. */
let lastTry: FloorplanObject | null = null;

async function save(next: FloorplanObject): Promise<boolean> {
  if (!market.value) return false;
  const revision = floorplan.value?.id === next.id ? floorplan.value.revision : 0;
  saveState.value = 'saving';
  saveMessage.value = '';
  try {
    const answer = await saveLayout(market.value.id, next, revision);
    adopted.value = answer.floorplan;
    saveState.value = 'saved';
    lastTry = null;
    void refresh();
    return true;
  } catch (err: unknown) {
    const refusal = saveRefusal(err);
    saveState.value = refusal.kind;
    saveMessage.value = refusal.message;
    lastTry = next;
    return false;
  }
}

function retry() {
  if (lastTry) void save(lastTry);
}

async function reload() {
  adopted.value = null;
  saveState.value = 'idle';
  lastTry = null;
  await refresh();
}

/** The floorplan chosen for the location: its layout's start, or its image on a layout begun. */
function onUploaded(image: UploadedFloorplan) {
  const imageFields = {
    imageGridfsId: image.gridfs_id,
    imageWidth: image.width,
    imageHeight: image.height,
    pdfPage: image.page ?? null,
  };
  const next: FloorplanObject = floorplan.value
    ? { ...floorplan.value, ...imageFields }
    : {
        id: crypto.randomUUID(),
        locationId: locationId.value,
        revision: 0,
        ...imageFields,
        tables: [],
        zones: [],
        sectionStyles: [],
        startingCounts: [],
      };
  void save(next);
}

async function onCalibrated(line: { start: Point; end: Point; lengthMm: number }) {
  const current = floorplan.value;
  const scale = pxPerMm(line.start, line.end, line.lengthMm);
  if (!current || scale === null) return;
  const round = (n: number) => Math.round(n * 10) / 10;
  const saved = await save({
    ...current,
    scalePxPerUnit: scale,
    referenceLineStart: [round(line.start[0]), round(line.start[1])],
    referenceLineEnd: [round(line.end[0]), round(line.end[1])],
    referenceLineLengthMm: line.lengthMm,
  });
  if (saved) recalibrating.value = false;
}

const showSaveState = computed(() => saveState.value !== 'idle' || Boolean(stored.value));
</script>

<template>
  <MarketFrame :market="market">
    <div v-if="market" class="layout-page" data-testid="layout-page">
      <header class="layout-head">
        <h1 class="layout-title">Layout</h1>
        <nav
          v-if="locations.length"
          class="layout-locations"
          aria-label="Locations"
          data-testid="layout-locations"
        >
          <RouterLink
            v-for="place in locations"
            :key="place.id"
            :to="layoutPath(market.id, place.id)"
            class="layout-location"
            :class="{ 'layout-location--here': place.id === locationId }"
            :aria-current="place.id === locationId ? 'page' : undefined"
            :data-testid="`layout-location-${place.id}`"
          >
            {{ place.name }}
          </RouterLink>
        </nav>
        <div class="layout-status">
          <template v-if="showSaveState && location">
            <p
              v-if="saveState === 'failed' || saveState === 'stale'"
              class="layout-save layout-save--failed"
              role="alert"
              data-testid="layout-save-state"
            >
              {{ saveMessage }}
              <button
                v-if="saveState === 'failed'"
                type="button"
                class="btn btn--secondary btn--compact"
                data-testid="layout-save-retry"
                @click="retry"
              >
                Retry
              </button>
              <button
                v-else
                type="button"
                class="btn btn--secondary btn--compact"
                data-testid="layout-save-reload"
                @click="reload"
              >
                Reload
              </button>
            </p>
            <p v-else class="layout-save" role="status" data-testid="layout-save-state">
              {{ saveState === 'saving' ? 'Saving…' : 'Saved' }}
            </p>
          </template>
          <p v-if="location && floorplan" class="layout-scale" data-testid="layout-scale">
            {{ scaleText }}
          </p>
          <RouterLink
            :to="marketPath(market.id, 'setup')"
            class="btn btn--secondary"
            data-testid="layout-back-to-setup"
          >
            Back to Market Setup
          </RouterLink>
        </div>
      </header>

      <p v-if="market.setupLockReason" class="note" data-testid="layout-setup-settled">
        {{ market.setupLockReason }}
      </p>

      <p v-if="!locations.length" class="layout-empty" data-testid="layout-no-locations">
        Name a location on Market Setup's Location Setup to lay it out.
      </p>
      <p v-else-if="locationId && !location" class="layout-empty" data-testid="layout-no-location">
        This location is not one of the market's.
      </p>

      <div v-else-if="location" class="layout-columns">
        <section class="layout-map-column" :aria-label="`${location.name}'s floorplan`">
          <template v-if="!floorplan?.imageGridfsId">
            <FloorplanUploader
              v-if="editable"
              :marketId="market.id"
              :busy="saveState === 'saving'"
              @uploaded="onUploaded"
            />
            <p v-else class="layout-empty" data-testid="layout-no-floorplan">
              No floorplan has been uploaded for {{ location.name }} yet.
            </p>
          </template>
          <template v-else-if="calibrated && !(editable && recalibrating)">
            <p v-if="imageFailed" class="layout-empty" data-testid="layout-image-failed">
              The floorplan's image could not be shown. Reload the page to try again.
            </p>
            <div
              class="layout-map-frame"
              :style="{
                aspectRatio: `${floorplan.imageWidth ?? 1} / ${floorplan.imageHeight ?? 1}`,
              }"
            >
              <LayoutMap
                :layout="floorplan"
                :locationName="location.name"
                :sections="market.setupObject?.sections ?? []"
                :tableTypes="market.setupObject?.tableTypes ?? []"
                :imageUrl="imageUrl"
                mode="read"
              />
            </div>
          </template>
          <p v-else-if="imageFailed" class="layout-empty" data-testid="layout-image-failed">
            The floorplan's image could not be shown. Reload the page to try again.
          </p>
          <LayoutCalibration
            v-else-if="imageUrl && editable"
            :key="`${floorplan.id}-${floorplan.imageGridfsId}`"
            :imageUrl="imageUrl"
            :imageWidth="floorplan.imageWidth ?? 1"
            :imageHeight="floorplan.imageHeight ?? 1"
            :locationName="location.name"
            :start="floorplan.referenceLineStart"
            :end="floorplan.referenceLineEnd"
            :lengthMm="floorplan.referenceLineLengthMm"
            :busy="saveState === 'saving'"
            :cancellable="calibrated"
            @set="onCalibrated"
            @cancel="recalibrating = false"
          />
          <img
            v-else-if="imageUrl"
            :src="imageUrl"
            class="layout-image"
            :alt="`${location.name}'s floorplan`"
            data-testid="layout-image"
          />
        </section>

        <aside class="layout-panel" aria-label="Layout details">
          <section v-if="!floorplan?.imageGridfsId" class="layout-card">
            <p class="layout-card-text" data-testid="layout-panel-start">
              <template v-if="editable">
                Upload the venue's floorplan for {{ location.name }} to start.
              </template>
              <template v-else>{{ location.name }} has no layout yet.</template>
            </p>
          </section>
          <section v-else-if="!calibrated && editable" class="layout-card">
            <h2 class="layout-card-title">Set the scale</h2>
            <p class="layout-card-text">
              Draw a line over something of known length, then type its length, so every table is
              drawn at its true size.
            </p>
          </section>
          <template v-else-if="calibrated">
            <LayoutPanelSections
              class="layout-card"
              :locationName="location.name"
              :sections="sections"
            />
            <section class="layout-card" data-testid="layout-panel-floorplan">
              <h2 class="layout-card-title">Floorplan</h2>
              <p class="layout-card-text">{{ location.name }}'s floorplan reads {{ scaleText }}.</p>
              <button
                v-if="editable && !recalibrating"
                type="button"
                class="btn btn--secondary"
                data-testid="layout-recalibrate"
                @click="recalibrating = true"
              >
                Recalibrate
              </button>
            </section>
          </template>
        </aside>
      </div>
    </div>
  </MarketFrame>
</template>

<style scoped>
/* The frame's gutter, as on every market page. A container, so the panel moves under the map by
   the room the page has, not the window's. */
.layout-page {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
  container-type: inline-size;
  min-width: 0;
}

.layout-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-4);
}

.layout-title {
  margin: 0;
  font-family: 'Merge One';
  font-size: var(--text-xl);
  font-weight: 400;
}

/* A segmented control of the market's locations, the one shown pressed. */
.layout-locations {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  padding: var(--space-1);
  border-radius: var(--radius-pill);
  background: var(--mm-beige);
}

.layout-location {
  display: inline-flex;
  align-items: center;
  /* A thumb's target on a phone, where --target-min is 44px. */
  min-height: var(--target-min);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  font-size: var(--text-sm);
  color: var(--mm-black);
  text-decoration: none;
}

.layout-location:hover {
  background: var(--mm-beige-hover);
}

.layout-location--here,
.layout-location--here:hover {
  background: white;
  box-shadow: var(--shadow-card);
}

.layout-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-left: auto;
}

.layout-save,
.layout-scale {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.layout-save--failed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  color: var(--mm-text-red-on-tint);
}

.layout-scale {
  color: var(--mm-black);
}

.layout-empty {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.layout-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  align-items: start;
  gap: var(--space-6);
}

@container (width < 1100px) {
  .layout-columns {
    grid-template-columns: minmax(0, 1fr);
  }
}

.layout-map-column {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

/* A floorplan with no scale yet, shown to someone who cannot set one: the image alone, whole. */
.layout-image {
  display: block;
  width: 100%;
  height: auto;
  max-height: 70vh;
  object-fit: contain;
  background: var(--layout-floor);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
}

/* The map fills the column at the floorplan's shape, the whole hall in it edge to edge. It caps no
   height of its own: a tall hall grows the page, which scrolls, as every screen does. */
.layout-map-frame {
  width: 100%;
  overflow: hidden;
  background: var(--layout-floor);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
}

.layout-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.layout-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  border-radius: var(--radius-card);
  background: white;
  box-shadow: var(--shadow-card);
}

.layout-card-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}

.layout-card-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

@media (width <= 640px) {
  .layout-page {
    padding: var(--space-4);
  }
}
</style>
