<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import Konva from 'konva'
import { useFloorplanStore } from '@/stores/floorplan'
import type { WallSegment, ObstacleZone } from '@/assets/types/datatypes'

// ── Props ──────────────────────────────────────────────────────────
const props = withDefaults(
  defineProps<{
    enabled?: boolean
  }>(),
  {
    enabled: true,
  },
)

// ── Store ──────────────────────────────────────────────────────────
const store = useFloorplanStore()

// ── Refs ───────────────────────────────────────────────────────────
const stageRef = ref()
const containerRef = ref<HTMLDivElement>()
const containerWidth = ref(0)
const containerHeight = ref(0)

// ── Viewport state (independent from FloorplanEditor) ──────────────
const stageX = ref(0)
const stageY = ref(0)
const stageScale = ref(1)

// ── UI state ───────────────────────────────────────────────────────
const wallVisible = ref(true)
const toolMode = ref<'select' | 'add-wall' | 'add-obstacle'>('select')
const selectedWallId = ref<string | null>(null)
const selectedObstacleId = ref<string | null>(null)
const hoveredVertex = ref<{ wallId: string; vertex: 'start' | 'end' } | null>(null)

// New wall placement
const newWallStart = ref<{ x: number; y: number } | null>(null)
const cursorPixel = ref<{ x: number; y: number } | null>(null)

// New obstacle placement
const newObstaclePoints = ref<Array<[number, number]>>([])

// Keyboard state for multi-select
const shiftHeld = ref(false)

// ── Resize observer ────────────────────────────────────────────────
let resizeObserver: ResizeObserver | null = null

function updateContainerSize() {
  if (containerRef.value) {
    containerWidth.value = containerRef.value.clientWidth
    containerHeight.value = containerRef.value.clientHeight
  }
}

onMounted(() => {
  updateContainerSize()
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => updateContainerSize())
    resizeObserver.observe(containerRef.value)
  }
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)
})

// ── Keyboard handlers ──────────────────────────────────────────────
function handleKeyDown(e: KeyboardEvent) {
  if (!props.enabled) return

  if (e.key === 'Shift') {
    shiftHeld.value = true
  }

  if (e.key === 'Escape') {
    cancelCurrentAction()
    return
  }

  if (e.key === 'Enter' && toolMode.value === 'add-obstacle' && newObstaclePoints.value.length >= 3) {
    e.preventDefault()
    finishObstacle()
    return
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') && toolMode.value === 'select') {
    e.preventDefault()
    deleteSelected()
  }
}

function handleKeyUp(e: KeyboardEvent) {
  if (e.key === 'Shift') {
    shiftHeld.value = false
  }
}

// ── Stage config ───────────────────────────────────────────────────
const stageConfig = computed(() => ({
  width: containerWidth.value || 800,
  height: containerHeight.value || 600,
  draggable: toolMode.value === 'select',
  x: stageX.value,
  y: stageY.value,
  scaleX: stageScale.value,
  scaleY: stageScale.value,
}))

// ── Zoom ───────────────────────────────────────────────────────────
function handleZoom(e: any) {
  e.evt.preventDefault()
  const stage = stageRef.value?.getNode()
  if (!stage) return

  const scaleBy = 1.08
  const oldScale = stage.scaleX()
  const pointer = stage.getPointerPosition()
  if (!pointer) return

  const mousePointTo = {
    x: (pointer.x - stage.x()) / oldScale,
    y: (pointer.y - stage.y()) / oldScale,
  }

  const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy
  const clamped = Math.max(0.1, Math.min(8, newScale))

  stageX.value = pointer.x - mousePointTo.x * clamped
  stageY.value = pointer.y - mousePointTo.y * clamped
  stageScale.value = clamped
}

// ── Coordinate helpers ─────────────────────────────────────────────
/** Convert stage pointer position to floorplan pixel coordinates. */
function stagePointerToFloor(pos: { x: number; y: number }): [number, number] {
  return [pos.x / store.scalePxPerMm, pos.y / store.scalePxPerMm]
}

/** Convert floorplan mm coords to stage pixels. */
function mmToPx(mm: number): number {
  return mm * store.scalePxPerMm
}

/** Convert [x,y] mm pair to pixel point array for Konva line. */
function mmPairToPx(pair: [number, number]): [number, number] {
  return [mmToPx(pair[0]), mmToPx(pair[1])]
}

// ── Vertex circle config ───────────────────────────────────────────
const VERTEX_RADIUS = 7
const VERTEX_HOVER_RADIUS = 9

function vertexConfig(
  wall: WallSegment,
  vertex: 'start' | 'end',
  px: number,
  py: number,
) {
  const isHovered =
    hoveredVertex.value?.wallId === wall.id &&
    hoveredVertex.value?.vertex === vertex
  const isSelected = selectedWallId.value === wall.id

  const baseColor = isSelected ? 'var(--mm-yellow)' : 'var(--mm-green)'
  const fill = isHovered
    ? 'var(--mm-yellow)'
    : isSelected
      ? 'var(--mm-yellow)'
      : 'var(--mm-green)'

  return {
    x: px,
    y: py,
    radius: isHovered ? VERTEX_HOVER_RADIUS : VERTEX_RADIUS,
    fill,
    stroke: '#ffffff',
    strokeWidth: 2,
    name: `vertex-${vertex}`,
    draggable: props.enabled && toolMode.value === 'select',
    hitStrokeWidth: 12,
  }
}

// ── Wall line config ───────────────────────────────────────────────
function wallLineConfig(wall: WallSegment) {
  const [sx, sy] = mmPairToPx(wall.start)
  const [ex, ey] = mmPairToPx(wall.end)
  const isSelected = selectedWallId.value === wall.id
  const isExterior = wall.isExterior

  let stroke: string
  if (isSelected) stroke = '#E4A629'
  else if (isExterior) stroke = '#4a4a4a'
  else stroke = '#666666'

  return {
    points: [sx, sy, ex, ey],
    stroke,
    strokeWidth: Math.max(3, mmToPx(wall.thicknessMm)),
    name: 'wall-line',
    id: wall.id,
    hitStrokeWidth: 10,
    listening: true,
  }
}

// ── Obstacle polygon config ────────────────────────────────────────
function obstacleConfig(obs: ObstacleZone) {
  const isSelected = selectedObstacleId.value === obs.id
  const points = obs.polygon.flatMap((p) => mmPairToPx(p))

  const typeColors: Record<string, string> = {
    pillar: 'rgba(180, 130, 100, 0.4)',
    stage: 'rgba(130, 160, 200, 0.35)',
    no_table_zone: 'rgba(200, 120, 120, 0.3)',
    custom: 'rgba(150, 150, 160, 0.35)',
  }

  return {
    points,
    closed: true,
    fill: typeColors[obs.type] || typeColors.custom,
    stroke: isSelected ? '#E4A629' : 'rgba(100, 100, 110, 0.7)',
    strokeWidth: isSelected ? 2.5 : 1.5,
    name: 'obstacle',
    id: obs.id,
    listening: true,
    hitStrokeWidth: 8,
  }
}

// ── New wall preview ───────────────────────────────────────────────
const newWallPreviewConfig = computed(() => {
  if (!newWallStart.value || !cursorPixel.value) return null
  return {
    points: [newWallStart.value.x, newWallStart.value.y, cursorPixel.value.x, cursorPixel.value.y],
    stroke: '#E4A629',
    strokeWidth: 3,
    dash: [8, 6],
    name: 'wall-preview',
    listening: false,
  }
})

// ── New obstacle preview ───────────────────────────────────────────
const newObstaclePreviewConfig = computed(() => {
  if (newObstaclePoints.value.length === 0) return null
  const pxPoints = newObstaclePoints.value.flatMap((p) => mmPairToPx(p))
  if (cursorPixel.value) {
    pxPoints.push(cursorPixel.value.x, cursorPixel.value.y)
  }
  return {
    points: pxPoints,
    closed: false,
    stroke: '#E4A629',
    strokeWidth: 2,
    dash: [6, 4],
    fill: 'rgba(228, 166, 41, 0.12)',
    name: 'obstacle-preview',
    listening: false,
  }
})

// ── Obstacle vertex dots for editing ───────────────────────────────
function obstacleVertexConfigs(obs: ObstacleZone) {
  if (selectedObstacleId.value !== obs.id) return []
  return obs.polygon.map((pt, i) => {
    const [px, py] = mmPairToPx(pt)
    return {
      key: `${obs.id}-vtx-${i}`,
      x: px,
      y: py,
      radius: 5,
      fill: '#E4A629',
      stroke: '#ffffff',
      strokeWidth: 1.5,
      name: 'obstacle-vertex',
      draggable: props.enabled && toolMode.value === 'select',
      hitStrokeWidth: 10,
    }
  })
}

// ── Stage event handlers ───────────────────────────────────────────
function handleStageMouseDown(e: any) {
  if (!props.enabled) return

  // Check if click is on empty stage area
  const clickedOnStage = e.target === e.target.getStage()

  if (toolMode.value === 'add-wall') {
    if (!clickedOnStage) return
    const pos = e.target.getStage().getPointerPosition()
    if (!pos) return

    if (!newWallStart.value) {
      // First click: set start point
      newWallStart.value = { x: pos.x, y: pos.y }
    } else {
      // Second click: create wall
      const startMm = stagePointerToFloor(newWallStart.value)
      const endMm = stagePointerToFloor(pos)
      addWall(startMm, endMm)
      newWallStart.value = null
      cursorPixel.value = null
      setToolMode('select')
    }
    return
  }

  if (toolMode.value === 'add-obstacle') {
    if (!clickedOnStage) return
    const pos = e.target.getStage().getPointerPosition()
    if (!pos) return
    const mm = stagePointerToFloor(pos)
    newObstaclePoints.value = [...newObstaclePoints.value, mm]
    return
  }

  if (toolMode.value === 'select') {
    // Deselect when clicking stage background
    if (clickedOnStage) {
      clearSelection()
    }
  }
}

function handleStageMouseMove(e: any) {
  if (!props.enabled) return
  const stage = stageRef.value?.getNode()
  if (!stage) return
  const pos = stage.getPointerPosition()
  if (!pos) return
  cursorPixel.value = { x: pos.x, y: pos.y }
}

function handleStageDblClick(e: any) {
  if (!props.enabled) return
  if (toolMode.value === 'add-obstacle' && newObstaclePoints.value.length >= 3) {
    e.evt.preventDefault()
    finishObstacle()
  }
}

// ── Wall click handler ─────────────────────────────────────────────
function onWallClick(wall: WallSegment) {
  if (!props.enabled || toolMode.value !== 'select') return
  selectedWallId.value = selectedWallId.value === wall.id ? null : wall.id
  selectedObstacleId.value = null
}

// ── Obstacle click handler ─────────────────────────────────────────
function onObstacleClick(obs: ObstacleZone) {
  if (!props.enabled || toolMode.value !== 'select') return
  selectedObstacleId.value = selectedObstacleId.value === obs.id ? null : obs.id
  selectedWallId.value = null
}

// ── Vertex drag handlers ───────────────────────────────────────────
function onVertexDragStart(wall: WallSegment, vertex: 'start' | 'end', e: any) {
  if (!props.enabled) return
  // Store initial coords in case we need them
  const node = e.target
  node.setAttrs({
    _dragStartX: node.x(),
    _dragStartY: node.y(),
  })
}

function onVertexDragMove(wall: WallSegment, vertex: 'start' | 'end', _e: any) {
  // Real-time preview: nothing extra needed, Konva handles visual
}

function onVertexDragEnd(wall: WallSegment, vertex: 'start' | 'end', e: any) {
  if (!props.enabled) return
  const node = e.target
  const newPx = { x: node.x(), y: node.y() }
  const [newXmm, newYmm] = stagePointerToFloor(newPx)

  const updates: Partial<WallSegment> =
    vertex === 'start'
      ? { start: [newXmm, newYmm] }
      : { end: [newXmm, newYmm] }

  store.updateWall(wall.id, updates)
}

// ── Obstacle vertex drag ───────────────────────────────────────────
function onObstacleVertexDragEnd(obs: ObstacleZone, vertexIndex: number, e: any) {
  if (!props.enabled) return
  const node = e.target
  const [newXmm, newYmm] = stagePointerToFloor({ x: node.x(), y: node.y() })
  const newPolygon = obs.polygon.map((p, i) =>
    i === vertexIndex ? ([newXmm, newYmm] as [number, number]) : p,
  )
  store.updateObstacle(obs.id, { polygon: newPolygon })
}

// ── Hover handlers ─────────────────────────────────────────────────
function onVertexMouseEnter(wall: WallSegment, vertex: 'start' | 'end') {
  hoveredVertex.value = { wallId: wall.id, vertex }
}

function onVertexMouseLeave() {
  hoveredVertex.value = null
}

// ── Actions ────────────────────────────────────────────────────────
function setToolMode(mode: 'select' | 'add-wall' | 'add-obstacle') {
  cancelCurrentAction()
  toolMode.value = mode
}

function cancelCurrentAction() {
  newWallStart.value = null
  newObstaclePoints.value = []
  cursorPixel.value = null
}

function addWall(startMm: [number, number], endMm: [number, number]) {
  const wall: WallSegment = {
    id: crypto.randomUUID(),
    start: startMm,
    end: endMm,
    thicknessMm: 100,
    isExterior: false,
  }
  store.setWalls([...store.walls, wall])
}

function finishObstacle() {
  if (newObstaclePoints.value.length < 3) return
  const obs: ObstacleZone = {
    id: crypto.randomUUID(),
    polygon: newObstaclePoints.value,
    type: 'custom',
  }
  store.obstacles.push(obs)
  store.markDirty()
  newObstaclePoints.value = []
  cursorPixel.value = null
  setToolMode('select')
}

function deleteSelected() {
  if (selectedWallId.value) {
    store.setWalls(store.walls.filter((w) => w.id !== selectedWallId.value))
    selectedWallId.value = null
  }
  if (selectedObstacleId.value) {
    store.obstacles.splice(
      store.obstacles.findIndex((o) => o.id === selectedObstacleId.value),
      1,
    )
    store.markDirty()
    selectedObstacleId.value = null
  }
}

function clearSelection() {
  selectedWallId.value = null
  selectedObstacleId.value = null
}

function toggleWallVisibility() {
  wallVisible.value = !wallVisible.value
}

function zoomIn() {
  stageScale.value = Math.min(8, stageScale.value * 1.2)
}

function zoomOut() {
  stageScale.value = Math.max(0.1, stageScale.value / 1.2)
}

function fitToScreen() {
  stageX.value = 0
  stageY.value = 0
  stageScale.value = 1
}

// ── Wall count computed ────────────────────────────────────────────
const wallCount = computed(() => store.walls.length)
const obstacleCount = computed(() => store.obstacles.length)

// ── Watch enabled to cancel actions ────────────────────────────────
watch(
  () => props.enabled,
  (val) => {
    if (!val) cancelCurrentAction()
  },
)
</script>

<template>
  <div
    class="wall-editor"
    :class="{ 'is-disabled': !props.enabled }"
    ref="containerRef"
  >
    <v-stage
      ref="stageRef"
      :config="stageConfig"
      @wheel="handleZoom"
      @mousedown="handleStageMouseDown"
      @mousemove="handleStageMouseMove"
      @dblclick="handleStageDblClick"
    >
      <!-- Layer 1: Walls -->
      <v-layer v-if="wallVisible" ref="wallLayerRef">
        <!-- Wall lines -->
        <v-line
          v-for="wall in store.walls"
          :key="wall.id"
          :config="wallLineConfig(wall)"
          @click="() => onWallClick(wall)"
        />

        <!-- Vertex circles for each wall endpoint -->
        <template v-for="wall in store.walls" :key="`vtx-${wall.id}`">
          <v-circle
            :config="{
              ...vertexConfig(
                wall,
                'start',
                mmToPx(wall.start[0]),
                mmToPx(wall.start[1]),
              ),
              id: `${wall.id}-start`,
            }"
            @dragstart="(e: any) => onVertexDragStart(wall, 'start', e)"
            @dragmove="(e: any) => onVertexDragMove(wall, 'start', e)"
            @dragend="(e: any) => onVertexDragEnd(wall, 'start', e)"
            @mouseenter="() => onVertexMouseEnter(wall, 'start')"
            @mouseleave="() => onVertexMouseLeave()"
          />
          <v-circle
            :config="{
              ...vertexConfig(
                wall,
                'end',
                mmToPx(wall.end[0]),
                mmToPx(wall.end[1]),
              ),
              id: `${wall.id}-end`,
            }"
            @dragstart="(e: any) => onVertexDragStart(wall, 'end', e)"
            @dragmove="(e: any) => onVertexDragMove(wall, 'end', e)"
            @dragend="(e: any) => onVertexDragEnd(wall, 'end', e)"
            @mouseenter="() => onVertexMouseEnter(wall, 'end')"
            @mouseleave="() => onVertexMouseLeave()"
          />
        </template>

        <!-- New wall preview -->
        <v-line
          v-if="newWallPreviewConfig"
          :config="newWallPreviewConfig"
        />
        <!-- New wall start marker -->
        <v-circle
          v-if="newWallStart"
          :config="{
            x: newWallStart.x,
            y: newWallStart.y,
            radius: 6,
            fill: '#E4A629',
            stroke: '#ffffff',
            strokeWidth: 2,
            listening: false,
          }"
        />
      </v-layer>

      <!-- Layer 2: Obstacles -->
      <v-layer v-if="wallVisible" ref="obstacleLayerRef">
        <v-line
          v-for="obs in store.obstacles"
          :key="obs.id"
          :config="obstacleConfig(obs)"
          @click="() => onObstacleClick(obs)"
        />

        <!-- Obstacle vertex handles (when selected) -->
        <template v-for="obs in store.obstacles" :key="`oh-${obs.id}`">
          <v-circle
            v-for="(vc, vi) in obstacleVertexConfigs(obs)"
            :key="vc.key"
            :config="vc"
            @dragend="(e: any) => onObstacleVertexDragEnd(obs, vi, e)"
          />
        </template>

        <!-- New obstacle preview -->
        <v-line
          v-if="newObstaclePreviewConfig"
          :config="newObstaclePreviewConfig"
        />
      </v-layer>
    </v-stage>

    <!-- Toolbar overlay -->
    <div class="wall-editor-toolbar">
      <!-- Visibility toggle -->
      <button
        class="toolbar-btn"
        :class="{ 'is-active': !wallVisible }"
        @click="toggleWallVisibility"
        :title="wallVisible ? 'Hide walls' : 'Show walls'"
        :aria-label="wallVisible ? 'Hide walls' : 'Show walls'"
      >
        <svg
          v-if="wallVisible"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <svg
          v-else
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"
          />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      </button>

      <div class="toolbar-separator" />

      <!-- Select tool -->
      <button
        class="toolbar-btn"
        :class="{ 'is-active': toolMode === 'select' }"
        @click="setToolMode('select')"
        title="Select / edit"
        aria-label="Select tool"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
        </svg>
      </button>

      <!-- Add wall tool -->
      <button
        class="toolbar-btn"
        :class="{ 'is-active': toolMode === 'add-wall' }"
        @click="setToolMode('add-wall')"
        title="Add wall"
        aria-label="Add wall"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
        >
          <line x1="5" y1="19" x2="19" y2="5" />
          <line x1="5" y1="5" x2="19" y2="19" />
        </svg>
      </button>

      <!-- Add obstacle tool -->
      <button
        class="toolbar-btn"
        :class="{ 'is-active': toolMode === 'add-obstacle' }"
        @click="setToolMode('add-obstacle')"
        title="Add obstacle zone"
        aria-label="Add obstacle zone"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
        >
          <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
        </svg>
      </button>

      <div class="toolbar-separator" />

      <!-- Delete button -->
      <button
        class="toolbar-btn toolbar-btn--danger"
        :disabled="!selectedWallId && !selectedObstacleId"
        @click="deleteSelected"
        title="Delete selected"
        aria-label="Delete selected"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>

      <div class="toolbar-separator" />

      <!-- Zoom controls -->
      <button
        class="toolbar-btn"
        @click="zoomIn"
        title="Zoom in"
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        class="toolbar-btn"
        @click="zoomOut"
        title="Zoom out"
        aria-label="Zoom out"
      >
        &minus;
      </button>
      <button
        class="toolbar-btn"
        @click="fitToScreen"
        title="Fit to screen"
        aria-label="Fit to screen"
      >
        Fit
      </button>
    </div>

    <!-- Status bar -->
    <div class="wall-editor-status">
      <span class="status-label">
        {{ wallCount }} wall{{ wallCount !== 1 ? 's' : '' }}
      </span>
      <span class="status-sep">·</span>
      <span class="status-label">
        {{ obstacleCount }} zone{{ obstacleCount !== 1 ? 's' : '' }}
      </span>
      <span
        v-if="toolMode === 'add-wall'"
        class="status-hint"
      >
        {{ newWallStart ? 'Click to place end point' : 'Click to place start point' }}
      </span>
      <span
        v-if="toolMode === 'add-obstacle'"
        class="status-hint"
      >
        Click points · dbl-click or Enter to finish ({{ newObstaclePoints.length }})
      </span>
    </div>
  </div>
</template>

<style scoped>
/* ── Container ────────────────────────────────────────────────── */
.wall-editor {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 360px;
  overflow: hidden;
  background: var(--mm-beige, #e9e6e1);
  border-radius: 10px;
  border: 2px solid var(--mm-grey, rgba(39, 35, 35, 0.25));
  transition: opacity 0.2s ease-in-out;
}

.wall-editor.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}

/* ── Toolbar overlay ──────────────────────────────────────────── */
.wall-editor-toolbar {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 5px 6px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(39, 35, 35, 0.12);
  z-index: 10;
}

.toolbar-separator {
  width: 1px;
  height: 22px;
  margin: 0 4px;
  background: var(--mm-grey, rgba(39, 35, 35, 0.2));
  border-radius: 1px;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 30px;
  padding: 0 8px;

  background: transparent;
  color: var(--mm-black, #272323);
  border: none;
  border-radius: 5px;

  font-family: 'Merge One', sans-serif;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;

  transition:
    background-color 0.15s ease-in-out,
    color 0.15s ease-in-out;
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--mm-beige, #e9e6e1);
}

.toolbar-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.toolbar-btn.is-active {
  background: var(--mm-green, #49b096);
  color: #ffffff;
}

.toolbar-btn.is-active:hover {
  background: color-mix(in srgb, var(--mm-green, #49b096) 85%, black);
}

.toolbar-btn--danger:hover:not(:disabled) {
  background: rgba(220, 80, 80, 0.12);
  color: #c0392b;
}

.toolbar-btn svg {
  flex-shrink: 0;
}

/* ── Status bar ────────────────────────────────────────────────── */
.wall-editor-status {
  position: absolute;
  bottom: 8px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(6px);
  border-radius: 6px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
  color: var(--mm-black, #272323);
  box-shadow: 0 1px 6px rgba(39, 35, 35, 0.08);
  z-index: 10;
}

.status-label {
  white-space: nowrap;
}

.status-sep {
  color: var(--mm-grey, rgba(39, 35, 35, 0.35));
}

.status-hint {
  margin-left: 6px;
  padding-left: 8px;
  border-left: 1px solid var(--mm-grey, rgba(39, 35, 35, 0.2));
  color: var(--mm-yellow, #e4a629);
  font-style: italic;
  white-space: nowrap;
}
</style>
