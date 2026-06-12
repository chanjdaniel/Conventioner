<script setup lang="ts">
import { ref } from 'vue'
import { useFloorplanStore } from '@/stores/floorplan'
import { api } from '@/utils/api'

const store = useFloorplanStore()

const showDropdown = ref(false)
const showCodes = ref(true)
const showSections = ref(true)
const isExporting = ref(false)
const exportError = ref('')

async function handleExport() {
  if (isExporting.value) return

  const body = {
    gridfs_id: store.floorplan?.imageGridfsId,
    placed_tables: store.placedTables,
    scale_px_per_mm: store.scalePxPerMm,
    options: { show_codes: showCodes.value, show_sections: showSections.value },
  }

  isExporting.value = true
  try {
    const response = await api.post('/floorplans/export', body, {
      responseType: 'blob',
    })
    const url = URL.createObjectURL(response.data)
    const a = document.createElement('a')
    a.href = url
    a.download = 'floorplan.png'
    a.click()
    URL.revokeObjectURL(url)
    showDropdown.value = false
  } catch (err) {
    console.error('Floorplan export failed:', err)
    exportError.value = 'Export failed. Please try again.'
  } finally {
    isExporting.value = false
  }
}

function toggleDropdown() {
  if (!isExporting.value) {
    showDropdown.value = !showDropdown.value
    if (showDropdown.value) exportError.value = ''
  }
}
</script>

<template>
  <div class="export-wrapper">
    <button
      class="export-btn"
      :class="{ 'is-loading': isExporting }"
      :disabled="isExporting"
      @click="toggleDropdown"
      title="Export floorplan as PNG"
      aria-label="Export floorplan"
    >
      <!-- Download icon -->
      <svg
        v-if="!isExporting"
        class="export-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <span v-if="isExporting" class="spinner" />
      <span>Export PNG</span>
    </button>

    <Transition name="dropdown">
      <div v-if="showDropdown" class="export-dropdown">
        <p v-if="exportError" class="export-error-msg">{{ exportError }}</p>
        <label class="export-option">
          <input v-model="showCodes" type="checkbox" />
          Show Table Codes
        </label>
        <label class="export-option">
          <input v-model="showSections" type="checkbox" />
          Show Sections
        </label>
        <button
          class="export-action-btn"
          :disabled="isExporting"
          @click="handleExport"
        >
          <span v-if="isExporting" class="spinner spinner--small" />
          {{ isExporting ? 'Exporting…' : 'Export' }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.export-wrapper {
  position: relative;
  display: inline-block;
}

/* ── Main button ─────────────────────────────────── */
.export-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

  transition:
    opacity 0.15s ease-in-out,
    background-color 0.15s ease-in-out;
}

.export-btn:hover:not(:disabled) {
  opacity: 0.85;
  background: color-mix(in srgb, var(--mm-green) 85%, black);
}

.export-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.export-btn.is-loading {
  background: color-mix(in srgb, var(--mm-green) 70%, black);
}

.export-icon {
  flex-shrink: 0;
}

/* ── Spinner ─────────────────────────────────────── */
.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.spinner--small {
  width: 12px;
  height: 12px;
  border-width: 1.5px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Dropdown panel ──────────────────────────────── */
.export-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;

  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 180px;
  padding: 10px 12px;

  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(39, 35, 35, 0.15);
}

.export-error-msg {
  margin: 0;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--mm-yellow) 18%, transparent);
  border: 1px solid var(--mm-yellow);
  border-radius: 5px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
  color: var(--mm-black);
  text-align: center;
}

.export-option {
  display: flex;
  align-items: center;
  gap: 8px;

  font-family: 'Merge One', sans-serif;
  font-size: 13px;
  color: var(--mm-black);
  cursor: pointer;
  user-select: none;
}

.export-option input[type='checkbox'] {
  accent-color: var(--mm-green);
  width: 15px;
  height: 15px;
  cursor: pointer;
}

.export-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 30px;
  margin-top: 2px;
  padding: 0 12px;

  background: var(--mm-green);
  color: #ffffff;
  border: none;
  border-radius: 5px;

  font-family: 'Merge One', sans-serif;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;

  transition:
    opacity 0.15s ease-in-out,
    background-color 0.15s ease-in-out;
}

.export-action-btn:hover:not(:disabled) {
  opacity: 0.85;
  background: color-mix(in srgb, var(--mm-green) 85%, black);
}

.export-action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* ── Dropdown transition ─────────────────────────── */
.dropdown-enter-active,
.dropdown-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
