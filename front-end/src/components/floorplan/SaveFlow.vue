<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { useFloorplanStore } from '@/stores/floorplan'
import { api } from '@/utils/api'
import IconCloseRound from '@/components/icons/IconCloseRound.vue'

// ── Props ────────────────────────────────────────────────────────────
const props = defineProps<{
  marketId: string
}>()

// ── Emits ─────────────────────────────────────────────────────────────
const emit = defineEmits<{
  saved: [payload: { market_id: string }]
}>()

// ── Store ─────────────────────────────────────────────────────────────
const store = useFloorplanStore()

// ── Dialog state ──────────────────────────────────────────────────────
const dialogOpen = ref(false)
const saving = ref(false)
const error = ref('')
const successMessage = ref('')

// Editable copies of section data
interface EditableSection {
  id: string
  name: string
  locationName: string
  tableIds: string[]
}
const editableSections = ref<EditableSection[]>([])

// ── Computed ─────────────────────────────────────────────────────────

/** Whether the save button should be enabled. */
const canSave = computed(() => {
  if (!props.marketId) return false
  if (store.placedTables.length === 0) return false
  if (store.sections.length === 0) return false
  return true
})

/** Reason the button is disabled (for tooltip). */
const disabledReason = computed(() => {
  if (!props.marketId) return 'No market selected'
  if (store.placedTables.length === 0) return 'Place at least one table'
  if (store.sections.length === 0) return 'Define at least one section'
  return ''
})

/** Sections enriched with table count. */
const sectionSummary = computed(() =>
  editableSections.value.map((s) => ({
    ...s,
    tableCount: s.tableIds.length,
  })),
)

/** Unique location names from sections. */
const locations = computed(() => {
  const set = new Set(editableSections.value.map((s) => s.locationName).filter(Boolean))
  return Array.from(set).sort()
})

/** Total table count across all sections. */
const totalTables = computed(() =>
  editableSections.value.reduce((sum, s) => sum + s.tableIds.length, 0),
)

/** Tables not assigned to any section. */
const unassignedTableCount = computed(() => {
  const assigned = new Set(editableSections.value.flatMap((s) => s.tableIds))
  return store.placedTables.filter((t) => !assigned.has(t.id)).length
})

// ── Dialog open / close ──────────────────────────────────────────────

function openDialog() {
  if (!canSave.value) return

  // Clone store sections into editable copies
  editableSections.value = store.sections.map((s) => ({
    id: s.id,
    name: s.name,
    locationName: s.locationName,
    tableIds: [...s.tableIds],
  }))

  error.value = ''
  successMessage.value = ''
  dialogOpen.value = true
}

function closeDialog() {
  dialogOpen.value = false
}

function handleBackdropClick() {
  closeDialog()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && dialogOpen.value && !saving.value) {
    closeDialog()
  }
}

watch(
  () => dialogOpen.value,
  (isOpen) => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeydown)
    } else {
      window.removeEventListener('keydown', handleKeydown)
    }
  },
)

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

// ── Section editing ──────────────────────────────────────────────────

function updateSectionName(id: string, value: string) {
  const sec = editableSections.value.find((s) => s.id === id)
  if (sec) sec.name = value
}

function updateSectionLocation(id: string, value: string) {
  const sec = editableSections.value.find((s) => s.id === id)
  if (sec) sec.locationName = value
}

// ── Save ─────────────────────────────────────────────────────────────

async function handleSave() {
  error.value = ''
  successMessage.value = ''

  // Apply edits back to store before saving
  store.setSections(
    editableSections.value.map((s) => ({
      id: s.id,
      name: s.name,
      locationName: s.locationName,
      tableIds: s.tableIds,
    })),
  )

  const payload = {
    market_id: props.marketId,
    floorplan: store.currentFloorplan,
  }

  saving.value = true
  try {
    await api.post('/floorplans/save-to-market', payload)
    successMessage.value = 'Floorplan saved successfully!'
    emit('saved', { market_id: props.marketId })

    // Auto-close after brief delay so user can see success
    setTimeout(() => {
      dialogOpen.value = false
    }, 1200)
  } catch (err: unknown) {
    const msg =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined
    error.value = msg || 'Failed to save floorplan. Please try again.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="save-flow">
    <!-- Save & Continue button -->
    <button
      class="save-button"
      :class="{ 'is-disabled': !canSave }"
      :disabled="!canSave"
      :title="disabledReason || 'Save floorplan to market'"
      @click="openDialog"
    >
      Save &amp; Continue
    </button>

    <!-- Success toast (external to dialog) -->
    <Transition name="toast-fade">
      <p v-if="successMessage && !dialogOpen" class="save-toast">{{ successMessage }}</p>
    </Transition>

    <!-- Dialog -->
    <Teleport to="body">
      <div
        class="save-dialog-root"
        :class="{ 'save-dialog-root--open': dialogOpen }"
        :aria-hidden="!dialogOpen"
      >
        <div class="save-dialog-background" @click="handleBackdropClick" />
        <div
          class="save-dialog-window"
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-dialog-title"
          @click.stop
        >
          <!-- Header -->
          <div class="save-dialog-header">
            <div class="save-dialog-header-side save-dialog-header-side--left">
              <button
                type="button"
                class="save-dialog-close"
                aria-label="Close"
                :disabled="saving"
                @click="closeDialog"
              >
                <IconCloseRound class="save-dialog-close-icon" />
              </button>
            </div>
            <h2 id="save-dialog-title" class="save-dialog-title">Review &amp; Save Floorplan</h2>
            <div class="save-dialog-header-side save-dialog-header-side--right" />
          </div>

          <!-- Body -->
          <div class="save-dialog-body">
            <!-- Success / Error messages -->
            <p v-if="successMessage" class="save-dialog-success">{{ successMessage }}</p>
            <p v-if="error" class="save-dialog-error">{{ error }}</p>

            <!-- Summary stats -->
            <div class="save-summary-stats">
              <div class="save-stat">
                <span class="save-stat-label">Total Tables</span>
                <span class="save-stat-value">{{ totalTables }}</span>
              </div>
              <div class="save-stat">
                <span class="save-stat-label">Sections</span>
                <span class="save-stat-value">{{ sectionSummary.length }}</span>
              </div>
              <div class="save-stat">
                <span class="save-stat-label">Locations</span>
                <span class="save-stat-value">{{ locations.length }}</span>
              </div>
              <div v-if="unassignedTableCount > 0" class="save-stat save-stat--warn">
                <span class="save-stat-label">Unassigned Tables</span>
                <span class="save-stat-value">{{ unassignedTableCount }}</span>
              </div>
            </div>

            <!-- Locations list -->
            <div v-if="locations.length > 0" class="save-section">
              <h3 class="save-section-title">Locations</h3>
              <ul class="save-tag-list">
                <li v-for="loc in locations" :key="loc" class="save-tag">
                  {{ loc }}
                </li>
              </ul>
            </div>

            <!-- Sections list (editable) -->
            <div v-if="sectionSummary.length > 0" class="save-section">
              <h3 class="save-section-title">
                Sections
                <span class="save-section-subtitle">— click to edit names &amp; locations</span>
              </h3>
              <div class="save-sections-grid">
                <div
                  v-for="section in sectionSummary"
                  :key="section.id"
                  class="save-section-card"
                >
                  <div class="save-section-card-field">
                    <label class="save-section-card-label" :for="`sec-name-${section.id}`">
                      Section Name
                    </label>
                    <input
                      :id="`sec-name-${section.id}`"
                      type="text"
                      class="save-section-card-input"
                      :value="section.name"
                      :disabled="saving"
                      @input="
                        (e) =>
                          updateSectionName(section.id, (e.target as HTMLInputElement).value)
                      "
                    />
                  </div>
                  <div class="save-section-card-field">
                    <label class="save-section-card-label" :for="`sec-loc-${section.id}`">
                      Location
                    </label>
                    <input
                      :id="`sec-loc-${section.id}`"
                      type="text"
                      class="save-section-card-input"
                      :value="section.locationName"
                      :disabled="saving"
                      @input="
                        (e) =>
                          updateSectionLocation(section.id, (e.target as HTMLInputElement).value)
                      "
                    />
                  </div>
                  <div class="save-section-card-meta">
                    <span class="save-section-card-tables">
                      {{ section.tableCount }}
                      {{ section.tableCount === 1 ? 'table' : 'tables' }}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Empty state -->
            <div v-if="sectionSummary.length === 0" class="save-empty">
              <p>No sections defined yet. Create sections in the floorplan editor first.</p>
            </div>
          </div>

          <!-- Footer -->
          <div class="save-dialog-footer">
            <button
              type="button"
              class="save-dialog-btn save-dialog-btn--cancel"
              :disabled="saving"
              @click="closeDialog"
            >
              Cancel
            </button>
            <button
              type="button"
              class="save-dialog-btn save-dialog-btn--primary"
              :disabled="saving"
              @click="handleSave"
            >
              <span v-if="saving" class="save-spinner" />
              <span>{{ saving ? 'Saving&hellip;' : 'Save Floorplan' }}</span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ── Wrapper ────────────────────────────────────────────────── */
.save-flow {
  display: inline-flex;
}

/* ── Save Button ────────────────────────────────────────────── */
.save-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 160px;
  height: 40px;
  padding: 0 24px;

  background: var(--mm-green);
  color: #ffffff;
  border: none;
  border-radius: 5px;

  font-family: 'Merge One', sans-serif;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;

  transition:
    opacity 0.15s ease-in-out,
    background-color 0.15s ease-in-out,
    box-shadow 0.15s ease-in-out;

  box-shadow: 0 2px 8px rgba(39, 35, 35, 0.15);
}

.save-button:hover:not(:disabled) {
  opacity: 0.9;
  background: color-mix(in srgb, var(--mm-green) 85%, black);
  box-shadow: 0 4px 14px rgba(39, 35, 35, 0.22);
}

.save-button:active:not(:disabled) {
  opacity: 0.85;
  transform: translateY(1px);
}

.save-button.is-disabled,
.save-button:disabled {
  background: var(--mm-grey);
  cursor: not-allowed;
  opacity: 0.55;
  box-shadow: none;
}

/* ── Toast ──────────────────────────────────────────────────── */
.save-toast {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3000;

  padding: 12px 28px;
  background: var(--mm-green);
  color: #ffffff;
  border-radius: 8px;

  font-family: 'Outfit Regular', sans-serif;
  font-size: 15px;
  box-shadow: 0 4px 20px rgba(39, 35, 35, 0.22);
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}

/* ── Dialog Root ────────────────────────────────────────────── */
.save-dialog-root {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  visibility: hidden;
  opacity: 0;
  transition:
    opacity 0.15s ease,
    visibility 0.15s ease;
}

.save-dialog-root--open {
  pointer-events: auto;
  visibility: visible;
  opacity: 1;
}

.save-dialog-background {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 0;
}

.save-dialog-window {
  position: relative;
  z-index: 1;
  width: min(94vw, 600px);
  max-height: min(88vh, 700px);
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.28);
  overflow: hidden;
  border: 1px solid rgba(39, 35, 35, 0.18);
}

/* ── Dialog Header ──────────────────────────────────────────── */
.save-dialog-header {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 10px 16px 12px;
  background-color: var(--mm-black);
  color: #fff;
}

.save-dialog-header-side {
  display: flex;
  align-items: center;
  min-width: 0;
}

.save-dialog-header-side--left {
  justify-content: flex-start;
}

.save-dialog-header-side--right {
  justify-content: flex-end;
}

.save-dialog-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #fff;
  cursor: pointer;
}

.save-dialog-close:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.save-dialog-close:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.save-dialog-close-icon {
  width: 22px;
  height: 22px;
}

.save-dialog-title {
  margin: 0;
  font-family: 'Merge One', 'Outfit', sans-serif;
  font-size: 20px;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: #fff;
  text-align: center;
}

/* ── Dialog Body ────────────────────────────────────────────── */
.save-dialog-body {
  flex: 1;
  min-height: 0;
  padding: 24px 22px 20px;
  background: #fff;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ── Messages ───────────────────────────────────────────────── */
.save-dialog-success {
  margin: 0;
  padding: 10px 16px;
  background: color-mix(in srgb, var(--mm-green) 18%, transparent);
  border: 1px solid var(--mm-green);
  border-radius: 8px;
  color: var(--mm-green);
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  text-align: center;
}

.save-dialog-error {
  margin: 0;
  padding: 10px 16px;
  background: color-mix(in srgb, var(--mm-yellow) 20%, transparent);
  border: 1px solid var(--mm-yellow);
  border-radius: 8px;
  color: var(--mm-black);
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  text-align: center;
}

/* ── Summary Stats ──────────────────────────────────────────── */
.save-summary-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 12px;
}

.save-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 14px 12px;
  background: var(--mm-beige);
  border-radius: 10px;
}

.save-stat--warn {
  background: color-mix(in srgb, var(--mm-yellow) 18%, var(--mm-beige));
}

.save-stat-label {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
  color: var(--mm-black);
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.save-stat-value {
  font-family: 'Merge One', sans-serif;
  font-size: 28px;
  color: var(--mm-black);
  line-height: 1.1;
}

.save-stat--warn .save-stat-value {
  color: var(--mm-yellow);
}

/* ── Section blocks ─────────────────────────────────────────── */
.save-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.save-section-title {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: 16px;
  color: var(--mm-black);
  border-bottom: 2px solid var(--mm-grey);
  padding-bottom: 6px;
}

.save-section-subtitle {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
  font-weight: 400;
  color: var(--mm-grey);
  letter-spacing: 0.01em;
}

/* ── Tag list (locations) ───────────────────────────────────── */
.save-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.save-tag {
  padding: 5px 14px;
  background: var(--mm-beige);
  border-radius: 999px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: var(--mm-black);
  border: 1px solid transparent;
}

/* ── Sections Grid ──────────────────────────────────────────── */
.save-sections-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.save-section-card {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
  padding: 14px 16px;
  background: var(--mm-beige);
  border-radius: 10px;
  border: 1px solid transparent;
  transition: border-color 0.15s ease;
}

.save-section-card:hover {
  border-color: var(--mm-grey);
}

.save-section-card-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 140px;
}

.save-section-card-label {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 11px;
  color: var(--mm-black);
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding-left: 2px;
}

.save-section-card-input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  background: #ffffff;
  border: 1px solid var(--mm-grey);
  border-radius: 6px;

  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-black);

  transition: border-color 0.15s ease;
  outline: none;
}

.save-section-card-input:focus {
  border-color: var(--mm-green);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--mm-green) 25%, transparent);
}

.save-section-card-input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.save-section-card-meta {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding-bottom: 2px;
}

.save-section-card-tables {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
  color: var(--mm-black);
  opacity: 0.55;
  white-space: nowrap;
}

/* ── Empty state ────────────────────────────────────────────── */
.save-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
}

.save-empty p {
  margin: 0;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-grey);
  text-align: center;
}

/* ── Dialog Footer ──────────────────────────────────────────── */
.save-dialog-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px 18px;
  background: #fff;
  border-top: 1px solid var(--mm-grey);
}

.save-dialog-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 100px;
  height: 36px;
  padding: 0 20px;
  border: none;
  border-radius: 5px;

  font-family: 'Merge One', sans-serif;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;

  transition:
    opacity 0.15s ease-in-out,
    background-color 0.15s ease-in-out;
}

.save-dialog-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.save-dialog-btn--cancel {
  background: var(--mm-beige);
  color: var(--mm-black);
}

.save-dialog-btn--cancel:hover:not(:disabled) {
  background: color-mix(in srgb, var(--mm-beige) 90%, black);
}

.save-dialog-btn--primary {
  background: var(--mm-green);
  color: #ffffff;
  min-width: 150px;
}

.save-dialog-btn--primary:hover:not(:disabled) {
  opacity: 0.9;
  background: color-mix(in srgb, var(--mm-green) 85%, black);
}

/* ── Spinner ────────────────────────────────────────────────── */
.save-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: save-spin 0.7s linear infinite;
}

@keyframes save-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
