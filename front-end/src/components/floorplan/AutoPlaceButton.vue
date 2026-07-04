<script setup lang="ts">
import { ref, computed } from 'vue'
import { useFloorplanStore } from '@/stores/floorplan'
import { api } from '@/utils/api'
import type { PlacedTableObject } from '@/assets/types/datatypes'

// ── Emits ──────────────────────────────────────────────────────────
const emit = defineEmits<{
  placed: [count: number]
  error: [message: string]
}>()

// ── Store ──────────────────────────────────────────────────────────
const store = useFloorplanStore()

// ── State ──────────────────────────────────────────────────────────
const isLoading = ref(false)
const errorMessage = ref('')

// ── Computed ───────────────────────────────────────────────────────
const isDisabled = computed(
  () => isLoading.value || store.tableTypes.length === 0 || !store.scalePxPerMm,
)

// ── Helpers ────────────────────────────────────────────────────────

/** Build the request body from current store state. */
function buildRequestBody() {
  const walls = store.walls.map((w) => ({
    start: w.start,
    end: w.end,
    thickness_mm: w.thicknessMm,
    is_exterior: w.isExterior,
  }))

  const obstacles = store.obstacles.map((o) => ({
    polygon: o.polygon,
    type: o.type,
  }))

  const tableTypes = store.tableTypes.map((tt) => ({
    id: tt.id,
    name: tt.name,
    width_mm: tt.widthMm,
    height_mm: tt.heightMm,
    max_capacity: tt.maxCapacity,
  }))

  // Derive counts from existing placed tables, or default to 1 per type
  const counts: Record<string, number> = {}
  for (const tt of store.tableTypes) {
    const existingCount = store.placedTables.filter(
      (pt) => pt.tableTypeId === tt.id,
    ).length
    counts[tt.id] = existingCount > 0 ? existingCount : 1
  }

  return {
    walls,
    obstacles,
    table_types: tableTypes,
    counts,
    scale_px_per_mm: store.scalePxPerMm,
    aisle_config: {
      wallBufferMm: 1500,
      tableSpacingMm: 1200,
    },
  }
}

/** Map the API response to PlacedTableObject array. */
function mapResponseToPlacedTables(
  raw: Array<{
    x_mm: number
    y_mm: number
    rotation: number
    width_mm: number
    height_mm: number
    table_type_id: string
  }>,
): PlacedTableObject[] {
  return raw.map((t) => ({
    id: crypto.randomUUID(),
    tableTypeId: t.table_type_id,
    x: t.x_mm,
    y: t.y_mm,
    rotation: t.rotation,
    widthMm: t.width_mm,
    heightMm: t.height_mm,
  }))
}

// ── Auto-place action ──────────────────────────────────────────────

async function triggerAutoPlace() {
  if (isDisabled.value) return

  isLoading.value = true
  errorMessage.value = ''

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30_000)

  try {
    const body = buildRequestBody()

    const { data } = await api.post('/floorplans/place-tables', body, {
      signal: controller.signal,
    })

    const placed = mapResponseToPlacedTables(data.placed_tables ?? [])
    store.setPlacedTables(placed)
    emit('placed', placed.length)
  } catch (_e: unknown) {
    const err = _e as { name?: string; code?: string; response?: { data?: { error?: string } }; message?: string }
    if (err?.name === 'AbortError' || err?.code === 'ECONNABORTED') {
      errorMessage.value = 'Placement timed out. Please try again with fewer tables.'
    } else if (err?.response?.data?.error) {
      errorMessage.value = err.response.data.error
    } else {
      errorMessage.value = err?.message || 'Auto-placement failed. Please try again.'
    }
    emit('error', errorMessage.value)
  } finally {
    clearTimeout(timeoutId)
    isLoading.value = false
  }
}
</script>

<template>
  <div class="auto-place-wrapper">
    <button
      class="auto-place-btn"
      :disabled="isDisabled"
      :title="
        store.tableTypes.length === 0
          ? 'Define at least one table type first'
          : !store.scalePxPerMm
            ? 'Calibrate the scale first'
            : 'Auto-place tables on the floorplan'
      "
      aria-label="Auto-place tables"
      @click="triggerAutoPlace"
    >
      <!-- Icon: a magic wand / sparkle for auto-placement -->
      <svg
        class="btn-icon"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M15 4V2m0 2v2m0-2h2m-2 0h-2" />
        <path d="M10.5 21l-3-7.5L0 10.5 7.5 10 10.5 3 13.5 10 21 10.5 13.5 13.5l-3 7.5z" />
      </svg>
      <span v-if="!isLoading" class="btn-label">Auto-Place Tables</span>
      <span v-else class="btn-loading">
        <span class="spinner" />
        <span>Analyzing floorplan and placing tables…</span>
      </span>
    </button>

    <!-- Error display -->
    <div v-if="errorMessage && !isLoading" class="placement-error">
      {{ errorMessage }}
    </div>
  </div>
</template>

<style scoped>
.auto-place-wrapper {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

/* ── Button ──────────────────────────────────────────────────── */

.auto-place-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 180px;
  height: 36px;
  padding: 0 16px;

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

.auto-place-btn:hover:not(:disabled) {
  opacity: 0.85;
  background: color-mix(in srgb, var(--mm-green) 85%, black);
}

.auto-place-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--mm-grey);
}

/* ── Icon ────────────────────────────────────────────────────── */

.btn-icon {
  flex-shrink: 0;
}

/* ── Loading state ───────────────────────────────────────────── */

.btn-loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: auto-place-spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes auto-place-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Error ───────────────────────────────────────────────────── */

.placement-error {
  width: 100%;
  padding: 8px 14px;
  background: color-mix(in srgb, var(--mm-yellow) 20%, transparent);
  border: 1px solid var(--mm-yellow);
  border-radius: 8px;

  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: var(--mm-black);
  line-height: 1.4;
}
</style>
