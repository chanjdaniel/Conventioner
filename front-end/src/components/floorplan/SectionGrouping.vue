<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { Layer as VLayer, Rect as VRect, Stage as VStage } from 'vue-konva';
import { useModalRoot } from '@/utils/useModalRoot';
import ScrollBox from '@/components/ScrollBox.vue';
import { useFloorplanStore } from '@/stores/floorplan';
import type { PlacedTableObject, FloorplanSectionObject } from '@/assets/types/datatypes';

// ══════════════════════════════════════════════════════════════════
//  Store
// ══════════════════════════════════════════════════════════════════
const store = useFloorplanStore();

// ══════════════════════════════════════════════════════════════════
//  Section colour palette - distinct from table-type colours
// ══════════════════════════════════════════════════════════════════
const SECTION_PALETTE = [
  { fill: 'rgba(65, 105, 225, 0.28)', stroke: '#4169E1' }, // royal blue
  { fill: 'rgba(220, 20, 60, 0.28)', stroke: '#DC143C' }, // crimson
  { fill: 'rgba(255, 140, 0, 0.28)', stroke: '#FF8C00' }, // dark orange
  { fill: 'rgba(138, 43, 226, 0.28)', stroke: '#8A2BE2' }, // blue violet
  { fill: 'rgba(0, 139, 139, 0.28)', stroke: '#008B8B' }, // dark cyan
  { fill: 'rgba(218, 112, 214, 0.28)', stroke: '#DA70D6' }, // orchid
  { fill: 'rgba(46, 139, 87, 0.28)', stroke: '#2E8B57' }, // sea green
  { fill: 'rgba(210, 105, 30, 0.28)', stroke: '#D2691E' }, // chocolate
  { fill: 'rgba(70, 130, 180, 0.28)', stroke: '#4682B4' }, // steel blue
  { fill: 'rgba(205, 92, 92, 0.28)', stroke: '#CD5C5C' }, // indian red
  { fill: 'rgba(147, 112, 219, 0.28)', stroke: '#9370DB' }, // medium purple
  { fill: 'rgba(60, 179, 113, 0.28)', stroke: '#3CB371' }, // medium sea green
];

function sectionColors(index: number) {
  return SECTION_PALETTE[index % SECTION_PALETTE.length];
}

// ══════════════════════════════════════════════════════════════════
//  UI state
// ══════════════════════════════════════════════════════════════════
const groupMode = ref(false);
const isDrawing = ref(false);
const lassoStart = ref({ x: 0, y: 0 });
const lassoEnd = ref({ x: 0, y: 0 });
const showDialog = ref(false);

/**
 * Modal: the page behind goes out of the tab order, not just out of reach of the mouse. The
 * dialog is teleported to `body`, so the walk up from it reaches the app container as a sibling
 * and marks the whole page in one step.
 */
const modalRoot = useModalRoot(showDialog);

/** Focus goes into the dialog: `autofocus` does nothing on an element mounted after the page's load. */
const sectionNameInput = ref<HTMLInputElement | null>(null);
watch(showDialog, async (open) => {
  if (!open) return;
  await nextTick();
  sectionNameInput.value?.focus();
});
const showSectionList = ref(false);

// Dialog fields
const dialogSectionName = ref('');
const dialogLocationName = ref('');
const dialogTierId = ref('');

// Tables captured by the last lasso gesture
const lassoedTableIds = ref<string[]>([]);

// Container sizing
const containerWidth = ref(1200);
const containerHeight = ref(800);
const rootRef = ref<HTMLDivElement>();

// Store section index map for reactive colour lookup
const sectionColorMap = computed(() => {
  const map = new Map<string, { fill: string; stroke: string }>();
  store.sections.forEach((s, i) => {
    map.set(s.id, sectionColors(i));
  });
  return map;
});

// ══════════════════════════════════════════════════════════════════
//  Coordinate helpers
// ══════════════════════════════════════════════════════════════════

/** Convert a table's mm centre to stage world-px coordinates. */
function tableWorldCenter(table: PlacedTableObject): { x: number; y: number } {
  const px = store.scalePxPerMm;
  return { x: table.x * px, y: table.y * px };
}

/** Convert a table's mm rect to stage world-px rect. */
function tableWorldRect(table: PlacedTableObject): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const px = store.scalePxPerMm;
  return {
    x: (table.x - table.widthMm / 2) * px,
    y: (table.y - table.heightMm / 2) * px,
    width: table.widthMm * px,
    height: table.heightMm * px,
  };
}

/**
 * Convert pointer (screen) coordinates to stage world coordinates,
 * accounting for the overlay stage's x/y/scale transform.
 */
function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
  const cfg = store.stageConfig;
  return {
    x: (screenX - cfg.x) / cfg.scale,
    y: (screenY - cfg.y) / cfg.scale,
  };
}

// ══════════════════════════════════════════════════════════════════
//  Overlay stage config (synced with FloorplanEditor's transform)
// ══════════════════════════════════════════════════════════════════
const overlayStageConfig = computed(() => ({
  width: containerWidth.value,
  height: containerHeight.value,
  x: store.stageConfig.x,
  y: store.stageConfig.y,
  scaleX: store.stageConfig.scale,
  scaleY: store.stageConfig.scale,
  listening: false,
}));

// ══════════════════════════════════════════════════════════════════
//  Section table overlay rects (Konva)
// ══════════════════════════════════════════════════════════════════
const sectionOverlays = computed(() => {
  const overlays: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    fill: string;
    stroke: string;
    strokeWidth: number;
    strokeScaleEnabled: boolean;
    listening: boolean;
    name: string;
  }> = [];
  for (const section of store.sections) {
    const colors = sectionColorMap.value.get(section.id);
    if (!colors) continue;
    for (const tid of section.tableIds) {
      const table = store.placedTables.find((t) => t.id === tid);
      if (!table) continue;
      const r = tableWorldRect(table);
      overlays.push({
        id: `sec-overlay-${tid}`,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        rotation: table.rotation,
        fill: colors.fill,
        stroke: colors.stroke,
        strokeWidth: 1.5,
        strokeScaleEnabled: false,
        listening: false,
        name: 'sectionOverlay',
      });
    }
  }
  return overlays;
});

// ══════════════════════════════════════════════════════════════════
//  Lasso configuration (Konva rect in world-px coordinates)
// ══════════════════════════════════════════════════════════════════
const lassoWorldRect = computed(() => {
  if (!isDrawing.value) return null;
  const sX1 = Math.min(lassoStart.value.x, lassoEnd.value.x);
  const sY1 = Math.min(lassoStart.value.y, lassoEnd.value.y);
  const sX2 = Math.max(lassoStart.value.x, lassoEnd.value.x);
  const sY2 = Math.max(lassoStart.value.y, lassoEnd.value.y);

  const w1 = screenToWorld(sX1, sY1);
  const w2 = screenToWorld(sX2, sY2);

  return {
    x: w1.x,
    y: w1.y,
    width: w2.x - w1.x,
    height: w2.y - w1.y,
    fill: 'rgba(59, 130, 246, 0.08)',
    stroke: '#3b82f6',
    strokeWidth: 2,
    dash: [8, 4],
    strokeScaleEnabled: false,
    listening: false,
  };
});

// ══════════════════════════════════════════════════════════════════
//  Existing sections list
// ══════════════════════════════════════════════════════════════════
const sectionListItems = computed(() =>
  store.sections.map((s) => ({
    ...s,
    tableCount: s.tableIds.length,
    colors: sectionColorMap.value.get(s.id) ?? sectionColors(0),
  })),
);

// ══════════════════════════════════════════════════════════════════
//  Lasso event handlers
// ══════════════════════════════════════════════════════════════════

function handleLassoStart(e: MouseEvent) {
  if (!groupMode.value) return;
  // Only left mouse button
  if (e.button !== 0) return;
  isDrawing.value = true;
  lassoStart.value = { x: e.offsetX, y: e.offsetY };
  lassoEnd.value = { x: e.offsetX, y: e.offsetY };
  lassoedTableIds.value = [];
}

function handleLassoMove(e: MouseEvent) {
  if (!isDrawing.value) return;
  lassoEnd.value = { x: e.offsetX, y: e.offsetY };
}

function handleLassoEnd(_e: MouseEvent) {
  void _e;
  if (!isDrawing.value) return;
  isDrawing.value = false;

  // Determine lasso bounds in screen coords
  const sMinX = Math.min(lassoStart.value.x, lassoEnd.value.x);
  const sMinY = Math.min(lassoStart.value.y, lassoEnd.value.y);
  const sMaxX = Math.max(lassoStart.value.x, lassoEnd.value.x);
  const sMaxY = Math.max(lassoStart.value.y, lassoEnd.value.y);

  // Minimum drag distance to count as a lasso (5px)
  const dragDist = sMaxX - sMinX + (sMaxY - sMinY);
  if (dragDist < 5) {
    lassoedTableIds.value = [];
    return;
  }

  // Convert screen bounds to world coords
  const wMin = screenToWorld(sMinX, sMinY);
  const wMax = screenToWorld(sMaxX, sMaxY);

  // Find tables whose centre falls within the world-space lasso
  const ids: string[] = [];
  for (const table of store.placedTables) {
    const center = tableWorldCenter(table);
    if (center.x >= wMin.x && center.x <= wMax.x && center.y >= wMin.y && center.y <= wMax.y) {
      ids.push(table.id);
    }
  }

  lassoedTableIds.value = ids;

  if (ids.length > 0) {
    openDialog();
  }
}

// ══════════════════════════════════════════════════════════════════
//  Dialog
// ══════════════════════════════════════════════════════════════════

function openDialog() {
  dialogSectionName.value = '';
  dialogLocationName.value = '';
  dialogTierId.value = '';
  showDialog.value = true;
}

function cancelSection() {
  showDialog.value = false;
  lassoedTableIds.value = [];
}

/** Strip spaces and hyphens for table-code prefix. */
function sanitizeCode(name: string): string {
  return name.replace(/[\s-]+/g, '');
}

function confirmSection() {
  const name = dialogSectionName.value.trim();
  if (!name) return;

  const ids = lassoedTableIds.value;
  if (ids.length === 0) return;

  // Remove these tables from any existing sections
  const updatedSections = store.sections.map((s) => ({
    ...s,
    tableIds: s.tableIds.filter((tid) => !ids.includes(tid)),
  }));

  // Purge empty sections
  const nonEmpty = updatedSections.filter((s) => s.tableIds.length > 0);

  // Create new section
  const newSection: FloorplanSectionObject = {
    id: crypto.randomUUID(),
    name,
    locationName: dialogLocationName.value.trim(),
    tableIds: [...ids],
    tierId: dialogTierId.value.trim() || undefined,
  };

  const allSections = [...nonEmpty, newSection];

  // Assign table codes: {sanitizedName}{1-based index}
  const codePrefix = sanitizeCode(name);
  const tableCodes = store.placedTables.map((t) => {
    if (!ids.includes(t.id)) return t;
    const idx = ids.indexOf(t.id) + 1;
    return { ...t, tableCode: `${codePrefix}${idx}` };
  });

  // Persist
  store.setPlacedTables(tableCodes);
  store.setSections(allSections);

  // Clean up
  showDialog.value = false;
  lassoedTableIds.value = [];
}

// ══════════════════════════════════════════════════════════════════
//  Section management
// ══════════════════════════════════════════════════════════════════

function deleteSection(sectionId: string) {
  const updated = store.sections.filter((s) => s.id !== sectionId);
  store.setSections(updated);
}

// ══════════════════════════════════════════════════════════════════
//  Group mode toggle
// ══════════════════════════════════════════════════════════════════

function toggleGroupMode() {
  groupMode.value = !groupMode.value;
  if (!groupMode.value) {
    isDrawing.value = false;
    lassoedTableIds.value = [];
    showDialog.value = false;
  }
}

// ══════════════════════════════════════════════════════════════════
//  Keyboard
// ══════════════════════════════════════════════════════════════════

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (showDialog.value) {
      cancelSection();
      return;
    }
    if (groupMode.value) {
      toggleGroupMode();
    }
  }
}

// ══════════════════════════════════════════════════════════════════
//  Resize observer
// ══════════════════════════════════════════════════════════════════

let resizeObserver: ResizeObserver | null = null;

function updateContainerSize() {
  if (rootRef.value) {
    containerWidth.value = rootRef.value.clientWidth;
    containerHeight.value = rootRef.value.clientHeight;
  }
}

onMounted(() => {
  updateContainerSize();
  if (rootRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateContainerSize();
    });
    resizeObserver.observe(rootRef.value);
  }
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div ref="rootRef" class="section-grouping">
    <!-- ── Konva overlay for section highlights + lasso rect ─────── -->
    <div class="konva-overlay">
      <v-stage :config="overlayStageConfig">
        <v-layer>
          <!-- Section table colour overlays -->
          <v-rect v-for="ov in sectionOverlays" :key="ov.id" :config="ov" />
          <!-- Lasso rectangle -->
          <v-rect v-if="lassoWorldRect" :config="lassoWorldRect" />
        </v-layer>
      </v-stage>
    </div>

    <!-- ── Lasso capture layer (only when group mode is active) ──── -->
    <div
      v-if="groupMode"
      class="lasso-capture"
      @mousedown="handleLassoStart"
      @mousemove="handleLassoMove"
      @mouseup="handleLassoEnd"
    />

    <!-- ── Toolbar ───────────────────────────────────────────────── -->
    <div class="sg-toolbar">
      <button
        class="sg-toolbar-btn"
        :class="{ 'is-active': groupMode }"
        @click="toggleGroupMode"
        :title="groupMode ? 'Exit group mode' : 'Group tables into sections'"
        :aria-pressed="groupMode"
        data-testid="floorplan-section-group-toggle"
      >
        {{ groupMode ? 'Done Grouping' : 'Group Sections' }}
      </button>

      <button
        v-if="store.sections.length > 0"
        class="sg-toolbar-btn sg-toolbar-btn--sections"
        :class="{ 'is-active': showSectionList }"
        @click="showSectionList = !showSectionList"
        :aria-expanded="showSectionList"
      >
        Sections&nbsp;({{ store.sections.length }})
      </button>
    </div>

    <!-- ── Hints bar (shown when group mode is active) ───────────── -->
    <div v-if="groupMode" class="sg-hint">
      Click &amp; drag to lasso tables. Press <kbd>Esc</kbd> to cancel.
    </div>

    <!-- ── Section list panel ────────────────────────────────────── -->
    <Transition name="panel-slide">
      <aside v-if="showSectionList" class="sg-panel" data-testid="floorplan-sections-panel">
        <ScrollBox testid="floorplan-sections-list">
          <div class="sg-panel-parts">
            <h3 class="sg-panel-title">Sections</h3>

            <ul v-if="store.sections.length > 0" class="sg-list">
              <li v-for="item in sectionListItems" :key="item.id" class="sg-list-item">
                <span class="sg-color-swatch" :style="{ backgroundColor: item.colors.stroke }" />
                <div class="sg-item-info">
                  <span class="sg-item-name">{{ item.name }}</span>
                  <span class="sg-item-meta">
                    {{ item.locationName || '/' }} &middot; {{ item.tableCount }} table{{
                      item.tableCount !== 1 ? 's' : ''
                    }}
                  </span>
                </div>
                <button
                  class="sg-delete-btn"
                  title="Delete section"
                  aria-label="Delete section"
                  @click="deleteSection(item.id)"
                >
                  &times;
                </button>
              </li>
            </ul>

            <p v-else class="sg-empty">No sections yet.</p>
          </div>
        </ScrollBox>
      </aside>
    </Transition>

    <!-- ── Section assignment dialog ─────────────────────────────── -->
    <Teleport to="body">
      <Transition name="dialog-fade">
        <div
          v-if="showDialog"
          ref="modalRoot"
          class="sg-dialog-backdrop"
          @click="cancelSection"
          aria-modal="true"
          role="dialog"
        >
          <!--
            A native form, not three key handlers (E20/F01/S03). Enter runs the same handler the
            Assign button does, so it inherits the empty-name guard, and does nothing while that
            button is disabled. This panel used `@keyup.enter` on each of its three inputs, the
            two floorplan panels beside it used `@keydown.enter`, and one of those prevented the
            default - three files, three answers, which is what a policy is for.
          -->
          <form class="sg-dialog" @click.stop @submit.prevent="confirmSection">
            <ScrollBox testid="floorplan-section-dialog-body">
              <div class="sg-dialog-parts">
                <h2 class="sg-dialog-title">Create Section</h2>
                <p class="sg-dialog-sub">
                  Assign {{ lassoedTableIds.length }} selected table{{
                    lassoedTableIds.length !== 1 ? 's' : ''
                  }}
                  to a section.
                </p>

                <label class="sg-field">
                  <span class="sg-field-label">Section Name</span>
                  <input
                    v-model="dialogSectionName"
                    class="sg-field-input"
                    type="text"
                    ref="sectionNameInput"
                    placeholder="e.g. A"
                    data-testid="floorplan-section-dialog-name-input"
                  />
                </label>

                <label class="sg-field">
                  <span class="sg-field-label">Location Name</span>
                  <input
                    v-model="dialogLocationName"
                    class="sg-field-input"
                    type="text"
                    placeholder="e.g. Main Hall"
                    data-testid="floorplan-section-dialog-location-input"
                  />
                </label>

                <label class="sg-field">
                  <span class="sg-field-label">Tier <em class="sg-optional">(optional)</em></span>
                  <input
                    v-model="dialogTierId"
                    class="sg-field-input"
                    type="text"
                    placeholder="e.g. Premium"
                  />
                </label>

                <p class="sg-code-preview" v-if="dialogSectionName.trim()">
                  Table codes:&nbsp;
                  <code>{{ dialogSectionName.trim().replace(/[\s-]+/g, '') }}1</code>
                  &ndash;
                  <code
                    >{{ dialogSectionName.trim().replace(/[\s-]+/g, '')
                    }}{{ lassoedTableIds.length }}</code
                  >
                </p>

                <div class="sg-dialog-actions">
                  <button
                    type="button"
                    class="sg-btn sg-btn--cancel"
                    data-testid="floorplan-section-dialog-cancel-btn"
                    @click="cancelSection"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    class="sg-btn sg-btn--confirm"
                    :disabled="!dialogSectionName.trim()"
                    data-testid="floorplan-section-dialog-assign-btn"
                  >
                    Assign Section
                  </button>
                </div>
              </div>
            </ScrollBox>
          </form>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════════════════════════
   Root - positioned absolutely by parent container
   ═══════════════════════════════════════════════════════════════════ */
.section-grouping {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  overflow: hidden;
}

/* ── Konva overlay (always visible, never captures pointer) ─────── */
.konva-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* ── Lasso capture surface (only when group mode is active) ─────── */
.lasso-capture {
  position: absolute;
  inset: 0;
  z-index: 6;
  pointer-events: all;
  cursor: crosshair;
}

/* ═══════════════════════════════════════════════════════════════════
   Toolbar
   ═══════════════════════════════════════════════════════════════════ */
.sg-toolbar {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 6px is off the spacing scale, and the nearest token would change this floorplan beta size */
  gap: 6px;
  z-index: 20;
  pointer-events: all;
}

.sg-toolbar-btn {
  --focus-border: var(--focus-border-on-fill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 var(--space-3);

  background: var(--mm-green);
  color: white;
  border: none;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- no radius token is 5px, and the nearest would change this floorplan beta corner */
  border-radius: 5px;

  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;

  transition: background-color 0.15s ease-in-out;
}

.sg-toolbar-btn:hover {
  background: var(--mm-green-hover);
}

.sg-toolbar-btn.is-active {
  --focus-border: var(--focus-border-on-fill);
  background: var(--mm-yellow);
  color: var(--mm-black);
}

.sg-toolbar-btn.is-active:hover {
  background: var(--mm-yellow-hover);
}

.sg-toolbar-btn--sections {
  --focus-border: var(--mm-green);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  color: var(--mm-black);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- --shadow-card would change how far this floorplan beta shadow draws */
  box-shadow: 0 2px 12px rgba(39, 35, 35, 0.12);
}

.sg-toolbar-btn--sections:hover {
  background: var(--mm-beige);
}

/* ── Hint bar ───────────────────────────────────────────────────── */
.sg-hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  pointer-events: none;

  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 6px and 18px are off the spacing scale, and the nearest token would change this floorplan beta size */
  padding: 6px 18px;
  background: rgba(39, 35, 35, 0.82);
  backdrop-filter: blur(6px);
  border-radius: var(--radius-pill);

  font-size: var(--text-xs);
  color: white;
}

.sg-hint kbd {
  display: inline-block;
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 5px is off the spacing scale, and the nearest token would change this floorplan beta size */
  padding: 0 5px;
  background: rgba(255, 255, 255, 0.18);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- no radius token is 4px, and the nearest would change this floorplan beta corner */
  border-radius: 4px;
  font-family: inherit;
  font-size: var(--text-xs);
}

/* ═══════════════════════════════════════════════════════════════════
   Section list panel
   ═══════════════════════════════════════════════════════════════════ */
.sg-panel {
  position: absolute;
  top: 56px;
  left: 12px;
  z-index: 20;
  pointer-events: all;

  width: 260px;
  max-height: min(420px, calc(100% - 72px));
  display: flex;
  flex-direction: column;
  overflow: hidden;

  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(39, 35, 35, 0.1);
  border-radius: var(--radius-card);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- --shadow-card would change how far this floorplan beta shadow draws */
  box-shadow: 0 8px 32px rgba(39, 35, 35, 0.12);
}

/* Padding inside the scroller, so the shades lie at the panel's edge and not over a gap. */
.sg-panel-parts {
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 14px is off the spacing scale, and the nearest token would change this floorplan beta size */
  padding: 14px 0 8px;
}

.sg-panel-title {
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 10px is off the spacing scale, and the nearest token would change this floorplan beta size */
  margin: 0 16px 10px;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-md);
  font-weight: 400;
  color: var(--mm-black);
}

.sg-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.sg-list-item {
  display: flex;
  align-items: center;
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 10px is off the spacing scale, and the nearest token would change this floorplan beta size */
  gap: 10px;
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 14px is off the spacing scale, and the nearest token would change this floorplan beta size */
  padding: 8px 14px;
  transition: background-color 0.12s ease-in-out;
}

.sg-list-item:hover {
  background: var(--hover-grey);
}

.sg-color-swatch {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- no radius token is 3px, and the nearest would change this floorplan beta corner */
  border-radius: 3px;
}

.sg-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 1px is off the spacing scale, and the nearest token would change this floorplan beta size */
  gap: 1px;
}

.sg-item-name {
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--mm-black);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sg-item-meta {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

/* A hovered row's grey takes `--mm-text-muted` to 4.13, and this to 5.04. */
.sg-list-item:hover .sg-item-meta,
.sg-list-item:hover .sg-delete-btn:not(:hover) {
  color: var(--mm-text-muted-on-beige);
}

.sg-delete-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- no radius token is 4px, and the nearest would change this floorplan beta corner */
  border-radius: 4px;
  background: transparent;
  color: var(--mm-text-muted);
  font-size: var(--text-lg);
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 0.12s ease-in-out,
    color 0.12s ease-in-out;
}

/* Opaque, so the pair reads the same over the hovered row's grey under it. */
.sg-delete-btn:hover {
  background: var(--mm-chip-destructive);
  color: var(--mm-text-red-on-tint);
}

.sg-empty {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  text-align: center;
}

/* ── Panel slide transition ──────────────────────────────────────── */
.panel-slide-enter-active,
.panel-slide-leave-active {
  transition:
    opacity 0.18s ease-out,
    transform 0.18s ease-out;
}
.panel-slide-enter-from,
.panel-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ═══════════════════════════════════════════════════════════════════
   Dialog (Teleported to body)
   ═══════════════════════════════════════════════════════════════════ */
.sg-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;

  display: flex;
  align-items: center;
  justify-content: center;

  background: rgba(39, 35, 35, 0.45);
  backdrop-filter: blur(4px);
}

.sg-dialog {
  width: min(400px, 92vw);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  background: white;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- no radius token is 14px, and the nearest would change this floorplan beta corner */
  border-radius: 14px;
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- --shadow-card would change how far this floorplan beta shadow draws */
  box-shadow: 0 16px 48px rgba(39, 35, 35, 0.18);
}

.sg-dialog-parts {
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 28px and 22px are off the spacing scale, and the nearest token would change this floorplan beta size */
  padding: 28px 28px 22px;
}

.sg-dialog-title {
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 6px is off the spacing scale, and the nearest token would change this floorplan beta size */
  margin: 0 0 6px;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  font-weight: 400;
  color: var(--mm-black);
}

.sg-dialog-sub {
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 20px is off the spacing scale, and the nearest token would change this floorplan beta size */
  margin: 0 0 20px;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

/* ── Form fields ────────────────────────────────────────────────── */
.sg-field {
  display: flex;
  flex-direction: column;
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 5px is off the spacing scale, and the nearest token would change this floorplan beta size */
  gap: 5px;
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 14px is off the spacing scale, and the nearest token would change this floorplan beta size */
  margin-bottom: 14px;
}

.sg-field-label {
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--mm-black);
}

.sg-optional {
  font-style: normal;
  font-weight: 400;
  color: var(--mm-text-muted);
  font-size: var(--text-xs);
}

.sg-field-input {
  width: 100%;
  height: 38px;
  padding: 0 var(--space-3);

  border: 2px solid rgba(39, 35, 35, 0.15);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- no radius token is 8px, and the nearest would change this floorplan beta corner */
  border-radius: 8px;
  outline: none;

  font-size: var(--text-sm);
  color: var(--mm-black);
  background: white;
}

.sg-field-input::placeholder {
  color: rgba(39, 35, 35, 0.3);
}

/* ── Code preview ───────────────────────────────────────────────── */
.sg-code-preview {
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 18px is off the spacing scale, and the nearest token would change this floorplan beta size */
  margin: 0 0 18px;
  font-size: var(--text-xs);
  color: var(--mm-black);
}

.sg-code-preview code {
  display: inline;
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 7px is off the spacing scale, and the nearest token would change this floorplan beta size */
  padding: 2px 7px;
  background: var(--mm-beige);
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- no radius token is 4px, and the nearest would change this floorplan beta corner */
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: var(--text-xs);
  color: var(--mm-black);
}

/* ── Dialog actions ─────────────────────────────────────────────── */
.sg-dialog-actions {
  display: flex;
  justify-content: flex-end;
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 10px is off the spacing scale, and the nearest token would change this floorplan beta size */
  gap: 10px;
}

.sg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- 18px is off the spacing scale, and the nearest token would change this floorplan beta size */
  padding: 0 18px;

  /* Transparent at rest, so the disabled state draws its line without a shift (`.btn`). */
  border: 1px solid transparent;
  border-radius: var(--radius-control);

  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  line-height: 1;
  cursor: pointer;

  transition: background-color 0.15s ease-in-out;
}

.sg-btn--cancel {
  background: var(--mm-beige);
  color: var(--mm-black);
}

.sg-btn--cancel:hover {
  background: var(--mm-beige-hover);
}

.sg-btn--confirm {
  --focus-border: var(--focus-border-on-fill);
  background: var(--mm-green);
  color: white;
}

.sg-btn--confirm:hover:not(:disabled) {
  background: var(--mm-green-hover);
}

.sg-btn--confirm:disabled {
  /* The primitives' one disabled state (`.btn:disabled`): readable, never dimmed by opacity. */
  background: var(--mm-beige);
  color: var(--mm-text-muted-on-beige);
  border-color: var(--mm-border);
  cursor: not-allowed;
}

/* ── Dialog fade transition ──────────────────────────────────────── */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.2s ease-out;
}
.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}
</style>
