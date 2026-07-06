<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useFloorplanStore } from '@/stores/floorplan'
import type { PlacedTableObject, FloorplanSectionObject } from '@/assets/types/datatypes'

// ══════════════════════════════════════════════════════════════════
//  Store
// ══════════════════════════════════════════════════════════════════
const store = useFloorplanStore()

// ══════════════════════════════════════════════════════════════════
//  Section colour palette — distinct from table-type colours
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
]

function sectionColors(index: number) {
  return SECTION_PALETTE[index % SECTION_PALETTE.length]
}

// ══════════════════════════════════════════════════════════════════
//  UI state
// ══════════════════════════════════════════════════════════════════
const groupMode = ref(false)
const isDrawing = ref(false)
const lassoStart = ref({ x: 0, y: 0 })
const lassoEnd = ref({ x: 0, y: 0 })
const showDialog = ref(false)
const showSectionList = ref(false)

// Dialog fields
const dialogSectionName = ref('')
const dialogLocationName = ref('')
const dialogTierId = ref('')

// Tables captured by the last lasso gesture
const lassoedTableIds = ref<string[]>([])

// Container sizing
const containerWidth = ref(1200)
const containerHeight = ref(800)
const rootRef = ref<HTMLDivElement>()

// Store section index map for reactive colour lookup
const sectionColorMap = computed(() => {
  const map = new Map<string, { fill: string; stroke: string }>()
  store.sections.forEach((s, i) => {
    map.set(s.id, sectionColors(i))
  })
  return map
})

// ══════════════════════════════════════════════════════════════════
//  Coordinate helpers
// ══════════════════════════════════════════════════════════════════

/** Convert a table's mm centre to stage world-px coordinates. */
function tableWorldCenter(table: PlacedTableObject): { x: number; y: number } {
  const px = store.scalePxPerMm
  return { x: table.x * px, y: table.y * px }
}

/** Convert a table's mm rect to stage world-px rect. */
function tableWorldRect(table: PlacedTableObject): {
  x: number
  y: number
  width: number
  height: number
} {
  const px = store.scalePxPerMm
  return {
    x: (table.x - table.widthMm / 2) * px,
    y: (table.y - table.heightMm / 2) * px,
    width: table.widthMm * px,
    height: table.heightMm * px,
  }
}

/**
 * Convert pointer (screen) coordinates to stage world coordinates,
 * accounting for the overlay stage's x/y/scale transform.
 */
function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
  const cfg = store.stageConfig
  return {
    x: (screenX - cfg.x) / cfg.scale,
    y: (screenY - cfg.y) / cfg.scale,
  }
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
}))

// ══════════════════════════════════════════════════════════════════
//  Section table overlay rects (Konva)
// ══════════════════════════════════════════════════════════════════
const sectionOverlays = computed(() => {
  const overlays: Array<{
    id: string
    x: number
    y: number
    width: number
    height: number
    rotation: number
    fill: string
    stroke: string
    strokeWidth: number
    strokeScaleEnabled: boolean
    listening: boolean
    name: string
  }> = []
  for (const section of store.sections) {
    const colors = sectionColorMap.value.get(section.id)
    if (!colors) continue
    for (const tid of section.tableIds) {
      const table = store.placedTables.find((t) => t.id === tid)
      if (!table) continue
      const r = tableWorldRect(table)
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
      })
    }
  }
  return overlays
})

// ══════════════════════════════════════════════════════════════════
//  Lasso configuration (Konva rect in world-px coordinates)
// ══════════════════════════════════════════════════════════════════
const lassoWorldRect = computed(() => {
  if (!isDrawing.value) return null
  const sX1 = Math.min(lassoStart.value.x, lassoEnd.value.x)
  const sY1 = Math.min(lassoStart.value.y, lassoEnd.value.y)
  const sX2 = Math.max(lassoStart.value.x, lassoEnd.value.x)
  const sY2 = Math.max(lassoStart.value.y, lassoEnd.value.y)

  const w1 = screenToWorld(sX1, sY1)
  const w2 = screenToWorld(sX2, sY2)

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
  }
})

// ══════════════════════════════════════════════════════════════════
//  Existing sections list
// ══════════════════════════════════════════════════════════════════
const sectionListItems = computed(() =>
  store.sections.map((s) => ({
    ...s,
    tableCount: s.tableIds.length,
    colors: sectionColorMap.value.get(s.id) ?? sectionColors(0),
  })),
)

// ══════════════════════════════════════════════════════════════════
//  Lasso event handlers
// ══════════════════════════════════════════════════════════════════

function handleLassoStart(e: MouseEvent) {
  if (!groupMode.value) return
  // Only left mouse button
  if (e.button !== 0) return
  isDrawing.value = true
  lassoStart.value = { x: e.offsetX, y: e.offsetY }
  lassoEnd.value = { x: e.offsetX, y: e.offsetY }
  lassoedTableIds.value = []
}

function handleLassoMove(e: MouseEvent) {
  if (!isDrawing.value) return
  lassoEnd.value = { x: e.offsetX, y: e.offsetY }
}

function handleLassoEnd(_e: MouseEvent) {
  void _e
  if (!isDrawing.value) return
  isDrawing.value = false

  // Determine lasso bounds in screen coords
  const sMinX = Math.min(lassoStart.value.x, lassoEnd.value.x)
  const sMinY = Math.min(lassoStart.value.y, lassoEnd.value.y)
  const sMaxX = Math.max(lassoStart.value.x, lassoEnd.value.x)
  const sMaxY = Math.max(lassoStart.value.y, lassoEnd.value.y)

  // Minimum drag distance to count as a lasso (5px)
  const dragDist = sMaxX - sMinX + (sMaxY - sMinY)
  if (dragDist < 5) {
    lassoedTableIds.value = []
    return
  }

  // Convert screen bounds to world coords
  const wMin = screenToWorld(sMinX, sMinY)
  const wMax = screenToWorld(sMaxX, sMaxY)

  // Find tables whose centre falls within the world-space lasso
  const ids: string[] = []
  for (const table of store.placedTables) {
    const center = tableWorldCenter(table)
    if (center.x >= wMin.x && center.x <= wMax.x && center.y >= wMin.y && center.y <= wMax.y) {
      ids.push(table.id)
    }
  }

  lassoedTableIds.value = ids

  if (ids.length > 0) {
    openDialog()
  }
}

// ══════════════════════════════════════════════════════════════════
//  Dialog
// ══════════════════════════════════════════════════════════════════

function openDialog() {
  dialogSectionName.value = ''
  dialogLocationName.value = ''
  dialogTierId.value = ''
  showDialog.value = true
}

function cancelSection() {
  showDialog.value = false
  lassoedTableIds.value = []
}

/** Strip spaces and hyphens for table-code prefix. */
function sanitizeCode(name: string): string {
  return name.replace(/[\s-]+/g, '')
}

function confirmSection() {
  const name = dialogSectionName.value.trim()
  if (!name) return

  const ids = lassoedTableIds.value
  if (ids.length === 0) return

  // Remove these tables from any existing sections
  const updatedSections = store.sections.map((s) => ({
    ...s,
    tableIds: s.tableIds.filter((tid) => !ids.includes(tid)),
  }))

  // Purge empty sections
  const nonEmpty = updatedSections.filter((s) => s.tableIds.length > 0)

  // Create new section
  const newSection: FloorplanSectionObject = {
    id: crypto.randomUUID(),
    name,
    locationName: dialogLocationName.value.trim(),
    tableIds: [...ids],
    tierId: dialogTierId.value.trim() || undefined,
  }

  const allSections = [...nonEmpty, newSection]

  // Assign table codes: {sanitizedName}{1-based index}
  const codePrefix = sanitizeCode(name)
  const tableCodes = store.placedTables.map((t) => {
    if (!ids.includes(t.id)) return t
    const idx = ids.indexOf(t.id) + 1
    return { ...t, tableCode: `${codePrefix}${idx}` }
  })

  // Persist
  store.setPlacedTables(tableCodes)
  store.setSections(allSections)

  // Clean up
  showDialog.value = false
  lassoedTableIds.value = []
}

// ══════════════════════════════════════════════════════════════════
//  Section management
// ══════════════════════════════════════════════════════════════════

function deleteSection(sectionId: string) {
  const updated = store.sections.filter((s) => s.id !== sectionId)
  store.setSections(updated)
}

// ══════════════════════════════════════════════════════════════════
//  Group mode toggle
// ══════════════════════════════════════════════════════════════════

function toggleGroupMode() {
  groupMode.value = !groupMode.value
  if (!groupMode.value) {
    isDrawing.value = false
    lassoedTableIds.value = []
    showDialog.value = false
  }
}

// ══════════════════════════════════════════════════════════════════
//  Keyboard
// ══════════════════════════════════════════════════════════════════

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (showDialog.value) {
      cancelSection()
      return
    }
    if (groupMode.value) {
      toggleGroupMode()
    }
  }
}

// ══════════════════════════════════════════════════════════════════
//  Resize observer
// ══════════════════════════════════════════════════════════════════

let resizeObserver: ResizeObserver | null = null

function updateContainerSize() {
  if (rootRef.value) {
    containerWidth.value = rootRef.value.clientWidth
    containerHeight.value = rootRef.value.clientHeight
  }
}

onMounted(() => {
  updateContainerSize()
  if (rootRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateContainerSize()
    })
    resizeObserver.observe(rootRef.value)
  }
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', handleKeydown)
})
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
      <aside v-if="showSectionList" class="sg-panel">
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
      </aside>
    </Transition>

    <!-- ── Section assignment dialog ─────────────────────────────── -->
    <Teleport to="body">
      <Transition name="dialog-fade">
        <div
          v-if="showDialog"
          class="sg-dialog-backdrop"
          @click="cancelSection"
          aria-modal="true"
          role="dialog"
        >
          <div class="sg-dialog" @click.stop>
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
                placeholder="e.g. A"
                autofocus
                data-testid="floorplan-section-dialog-name-input"
                @keyup.enter="confirmSection"
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
                @keyup.enter="confirmSection"
              />
            </label>

            <label class="sg-field">
              <span class="sg-field-label">Tier <em class="sg-optional">(optional)</em></span>
              <input
                v-model="dialogTierId"
                class="sg-field-input"
                type="text"
                placeholder="e.g. Premium"
                @keyup.enter="confirmSection"
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
                class="sg-btn sg-btn--cancel"
                data-testid="floorplan-section-dialog-cancel-btn"
                @click="cancelSection"
              >
                Cancel
              </button>
              <button
                class="sg-btn sg-btn--confirm"
                :disabled="!dialogSectionName.trim()"
                data-testid="floorplan-section-dialog-assign-btn"
                @click="confirmSection"
              >
                Assign Section
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════════════════════════
   Root — positioned absolutely by parent container
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
  gap: 6px;
  z-index: 20;
  pointer-events: all;
}

.sg-toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 12px;

  background: var(--mm-green);
  color: #ffffff;
  border: none;
  border-radius: 5px;

  font-family: 'Merge One', sans-serif;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;

  transition:
    opacity 0.15s ease-in-out,
    background-color 0.15s ease-in-out;
}

.sg-toolbar-btn:hover {
  opacity: 0.85;
  background: color-mix(in srgb, var(--mm-green) 85%, black);
}

.sg-toolbar-btn.is-active {
  background: var(--mm-yellow);
  color: var(--mm-black);
}

.sg-toolbar-btn.is-active:hover {
  background: color-mix(in srgb, var(--mm-yellow) 85%, black);
  opacity: 0.9;
}

.sg-toolbar-btn--sections {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  color: var(--mm-black);
  box-shadow: 0 2px 12px rgba(39, 35, 35, 0.12);
}

.sg-toolbar-btn--sections:hover {
  background: var(--mm-beige);
  opacity: 1;
}

/* ── Hint bar ───────────────────────────────────────────────────── */
.sg-hint {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  pointer-events: none;

  padding: 6px 18px;
  background: rgba(39, 35, 35, 0.82);
  backdrop-filter: blur(6px);
  border-radius: 999px;

  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: #ffffff;
}

.sg-hint kbd {
  display: inline-block;
  padding: 0 5px;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
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
  overflow-y: auto;

  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(39, 35, 35, 0.1);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(39, 35, 35, 0.12);
  padding: 14px 0 8px;
}

.sg-panel-title {
  margin: 0 16px 10px;
  font-family: 'Merge One', sans-serif;
  font-size: 16px;
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
  gap: 10px;
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
  border-radius: 3px;
}

.sg-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.sg-item-name {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--mm-black);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sg-item-meta {
  font-size: 12px;
  color: var(--mm-grey);
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
  border-radius: 4px;
  background: transparent;
  color: var(--mm-grey);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 0.12s ease-in-out,
    color 0.12s ease-in-out;
}

.sg-delete-btn:hover {
  background: rgba(220, 20, 60, 0.1);
  color: #dc143c;
}

.sg-empty {
  margin: 0;
  padding: 12px 16px;
  font-size: 13px;
  color: var(--mm-grey);
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
  overflow-y: auto;

  background: #ffffff;
  border-radius: 14px;
  box-shadow: 0 16px 48px rgba(39, 35, 35, 0.18);
  padding: 28px 28px 22px;
}

.sg-dialog-title {
  margin: 0 0 6px;
  font-family: 'Merge One', sans-serif;
  font-size: 20px;
  font-weight: 400;
  color: var(--mm-black);
}

.sg-dialog-sub {
  margin: 0 0 20px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-grey);
}

/* ── Form fields ────────────────────────────────────────────────── */
.sg-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 14px;
}

.sg-field-label {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--mm-black);
}

.sg-optional {
  font-style: normal;
  font-weight: 400;
  color: var(--mm-grey);
  font-size: 12px;
}

.sg-field-input {
  width: 100%;
  height: 38px;
  padding: 0 12px;

  border: 2px solid rgba(39, 35, 35, 0.15);
  border-radius: 8px;
  outline: none;

  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-black);
  background: #ffffff;

  transition: border-color 0.15s ease-in-out;
}

.sg-field-input:focus {
  border-color: var(--mm-green);
}

.sg-field-input::placeholder {
  color: rgba(39, 35, 35, 0.3);
}

/* ── Code preview ───────────────────────────────────────────────── */
.sg-code-preview {
  margin: 0 0 18px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: var(--mm-black);
}

.sg-code-preview code {
  display: inline;
  padding: 2px 7px;
  background: var(--mm-beige);
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: var(--mm-black);
}

/* ── Dialog actions ─────────────────────────────────────────────── */
.sg-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.sg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: 0 18px;

  border: none;
  border-radius: 6px;

  font-family: 'Merge One', sans-serif;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;

  transition:
    opacity 0.15s ease-in-out,
    background-color 0.15s ease-in-out;
}

.sg-btn--cancel {
  background: var(--mm-beige);
  color: var(--mm-black);
}

.sg-btn--cancel:hover {
  background: color-mix(in srgb, var(--mm-beige) 85%, black);
}

.sg-btn--confirm {
  background: var(--mm-green);
  color: #ffffff;
}

.sg-btn--confirm:hover:not(:disabled) {
  opacity: 0.9;
  background: color-mix(in srgb, var(--mm-green) 85%, black);
}

.sg-btn--confirm:disabled {
  opacity: 0.45;
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
