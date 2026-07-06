<script setup lang="ts">
import { ref, computed } from 'vue'
import { useFloorplanStore } from '@/stores/floorplan'
import FloorplanUploader from './FloorplanUploader.vue'
import ScaleCalibration from './ScaleCalibration.vue'
import TableTypePanel from './TableTypePanel.vue'
import AutoPlaceButton from './AutoPlaceButton.vue'
import FloorplanEditor from './FloorplanEditor.vue'
import WallEditor from './WallEditor.vue'
import SectionGrouping from './SectionGrouping.vue'
import SaveFlow from './SaveFlow.vue'
import TemplatePanel from './TemplatePanel.vue'
import ExportButton from './ExportButton.vue'

// ── Props ────────────────────────────────────────────────────────────
const props = defineProps<{
  marketId: string
}>()

// ── Emits ────────────────────────────────────────────────────────────
const emit = defineEmits<{
  (e: 'saved', payload: { market_id: string }): void
}>()

// ── Store ────────────────────────────────────────────────────────────
const store = useFloorplanStore()

// ── Local state ──────────────────────────────────────────────────────
const step = ref(0)
const gridfsId = ref<string | null>(null)
const wallEditMode = ref(false)
const editorRef = ref<InstanceType<typeof FloorplanEditor> | null>(null)

/** Non-null-safe string for prop binding when v-if guards the value. */
const safeGridfsId = computed(() => gridfsId.value ?? '')

// ── Step progression ─────────────────────────────────────────────────

/**
 * Whether the user can advance from the current step.
 * Each step defines its own completion criterion against the Pinia store
 * (or local ref, for upload).
 */
const canProceed = computed(() => {
  switch (step.value) {
    case 0:
      // Upload complete → gridfsId is set
      return gridfsId.value !== null
    case 1:
      // Calibration complete → scale has been set (default is 1)
      return store.scalePxPerMm !== 1
    case 2:
      // Auto-placement complete → tables placed in store
      return store.placedTables.length > 0
    case 3:
      // Sections grouped → sections array populated
      return store.sections.length > 0
    default:
      return false
  }
})

// ── Event handlers ───────────────────────────────────────────────────

function onUploaded(payload: { gridfs_id: string; width: number; height: number }) {
  gridfsId.value = payload.gridfs_id
}

function onCalibrated(_payload: {
  pxPerMm: number
  pixelDistance: number
  lengthMm: number
  unit: string
}) {
  void _payload
  // ScaleCalibration already calls store.setScale() internally
  // Auto-advance to the next step
  step.value++
}

function onPlaced(_count: number) {
  void _count
  // AutoPlaceButton already calls store.setPlacedTables() internally
}

/** No-op — SectionGrouping writes directly to store.setSections(). */
function onSectionsUpdated() {
  // store.sections is already updated reactively
}

function onSaved(payload: { market_id: string }) {
  emit('saved', payload)
}
</script>

<template>
  <div class="floorplan-workflow">
    <!-- ── Progress indicator ──────────────────────────────────── -->
    <div
      class="workflow-progress"
      role="progressbar"
      aria-valuenow="step"
      :aria-valuetext="`Step ${step + 1} of 5`"
    >
      <span :class="{ active: step === 0, done: step > 0 }">1. Upload</span>
      <span :class="{ active: step === 1, done: step > 1 }">2. Calibrate</span>
      <span :class="{ active: step === 2, done: step > 2 }">3. Place Tables</span>
      <span :class="{ active: step === 3, done: step > 3 }">4. Edit Layout</span>
      <span :class="{ active: step === 4 }">5. Save</span>
    </div>

    <!-- ── Step 0: Upload ─────────────────────────────────────── -->
    <div v-if="step === 0" class="step-body">
      <FloorplanUploader @uploaded="onUploaded" />
    </div>

    <!-- ── Step 1: Calibrate ──────────────────────────────────── -->
    <div v-if="step === 1" class="step-body">
      <ScaleCalibration :gridfs-id="safeGridfsId" @calibrated="onCalibrated" />
    </div>

    <!-- ── Step 2: Define Tables + Auto-Place ─────────────────── -->
    <div v-if="step === 2" class="step-place">
      <TableTypePanel />
      <AutoPlaceButton @placed="onPlaced" />
    </div>

    <!-- ── Step 3: Edit Layout ────────────────────────────────── -->
    <div v-if="step === 3" class="step-edit">
      <div class="step-edit-toolbar">
        <label class="wall-toggle">
          <input v-model="wallEditMode" type="checkbox" />
          Wall Editor
        </label>
      </div>
      <div class="step-edit-canvas-area">
        <FloorplanEditor ref="editorRef" :edit-mode="true" :initial-floorplan-id="safeGridfsId" />
        <SectionGrouping @sections-updated="onSectionsUpdated" />
      </div>
      <WallEditor :enabled="wallEditMode" />
    </div>

    <!-- ── Step 4: Save + Export + Templates ──────────────────── -->
    <div v-if="step === 4" class="step-save">
      <SaveFlow :market-id="props.marketId" @saved="onSaved" />
      <TemplatePanel />
      <ExportButton />
    </div>

    <!-- ── Navigation ─────────────────────────────────────────── -->
    <div class="workflow-nav">
      <button
        v-if="step > 0"
        class="nav-btn nav-btn--back"
        data-testid="floorplan-workflow-back-btn"
        @click="step--"
      >
        ← Back
      </button>
      <button
        v-if="step < 4"
        class="nav-btn nav-btn--next"
        :disabled="!canProceed"
        data-testid="floorplan-workflow-next-btn"
        @click="step++"
      >
        Next →
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ── Container ─────────────────────────────────────────────────── */
.floorplan-workflow {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* ── Progress indicator ────────────────────────────────────────── */
.workflow-progress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 24px;
  background: var(--mm-beige);
  border-bottom: 1.5px solid var(--mm-grey);
  flex-shrink: 0;
}

.workflow-progress span {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: rgba(39, 35, 35, 0.35);
  padding: 6px 14px;
  border-radius: 20px;
  background: transparent;
  transition:
    color 0.2s ease,
    background 0.2s ease;
}

.workflow-progress span.active {
  color: #ffffff;
  background: var(--mm-green);
  font-weight: 500;
}

.workflow-progress span.done {
  color: var(--mm-green);
  font-weight: 500;
}

/* ── Step bodies ────────────────────────────────────────────────── */
.step-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

/* ── Step 2: Place ──────────────────────────────────────────────── */
.step-place {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  overflow: auto;
}

/* ── Step 3: Edit ───────────────────────────────────────────────── */
.step-edit {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.step-edit-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--mm-beige);
  border-bottom: 1px solid var(--mm-grey);
  flex-shrink: 0;
}

.wall-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: var(--mm-black);
  cursor: pointer;
  user-select: none;
}

.wall-toggle input[type='checkbox'] {
  accent-color: var(--mm-green);
}

.step-edit-canvas-area {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

/* ── Step 4: Save ───────────────────────────────────────────────── */
.step-save {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  overflow: auto;
}

/* ── Navigation ──────────────────────────────────────────────────── */
.workflow-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  background: #ffffff;
  border-top: 1.5px solid var(--mm-grey);
  flex-shrink: 0;
}

.nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 20px;
  font-family: 'Merge One', sans-serif;
  font-size: 14px;
  line-height: 1;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition:
    opacity 0.15s ease-in-out,
    background-color 0.15s ease-in-out;
}

.nav-btn:hover:not(:disabled) {
  opacity: 0.85;
}

.nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.nav-btn--back {
  background: transparent;
  color: var(--mm-black);
  border: 1.5px solid var(--mm-grey);
}

.nav-btn--next {
  background: var(--mm-green);
  color: #ffffff;
  margin-left: auto;
}
</style>
