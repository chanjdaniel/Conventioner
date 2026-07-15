<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useFloorplanStore } from '@/stores/floorplan';
import { api } from '@/utils/api';
import { useUndoRedo } from '@/components/floorplan/useUndoRedo';
import type { PlacedTableObject, WallSegment } from '@/assets/types/datatypes';
import type Konva from 'konva';

// ── Props ──────────────────────────────────────────────────────────
const props = withDefaults(
  defineProps<{
    initialFloorplanId?: string;
    editMode?: boolean;
  }>(),
  {
    editMode: true,
  },
);

// ── Store ──────────────────────────────────────────────────────────
const store = useFloorplanStore();

// ── Refs ───────────────────────────────────────────────────────────
const stageRef = ref();
const transformerRef = ref();
const { pushSnapshot } = useUndoRedo(stageRef);
const containerRef = ref<HTMLDivElement>();
const bgImage = ref<HTMLImageElement | null>(null);
const showGrid = ref(true);
const containerWidth = ref(0);
const containerHeight = ref(0);
const snapGuides = ref<
  Array<{
    key: string;
    points: number[];
    stroke: string;
    strokeWidth: number;
    dash: number[];
    listening: boolean;
  }>
>([]);
const errorMsg = ref('');

// ── Resize observer ────────────────────────────────────────────────
let resizeObserver: ResizeObserver | null = null;

function updateContainerSize() {
  if (containerRef.value) {
    containerWidth.value = containerRef.value.clientWidth;
    containerHeight.value = containerRef.value.clientHeight;
  }
}

onMounted(() => {
  updateContainerSize();
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateContainerSize();
    });
    resizeObserver.observe(containerRef.value);
  }

  // Keyboard shortcuts
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('keydown', handleKeyDown);
});

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (store.selectedTableIds.length > 0 && props.editMode) {
      e.preventDefault();
      store.selectedTableIds.forEach((id) => store.removePlacedTable(id));
      store.clearSelection();
      const tr = transformerRef.value?.getNode();
      if (tr) tr.nodes([]);
    }
  }
}

// ── Stage config ───────────────────────────────────────────────────
const stageConfig = computed(() => ({
  width: containerWidth.value || 1200,
  height: containerHeight.value || 800,
  draggable: true,
  x: store.stageConfig.x,
  y: store.stageConfig.y,
  scaleX: store.stageConfig.scale,
  scaleY: store.stageConfig.scale,
}));

// ── Background image loading ───────────────────────────────────────
async function loadBackgroundImage(gridfsId: string) {
  try {
    const { data } = await api.get(`/floorplans/${gridfsId}`, {
      responseType: 'blob',
    });
    const url = URL.createObjectURL(data);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    bgImage.value = img;
    if (!store.floorplan) {
      store.initFloorplan({
        imageGridfsId: gridfsId,
        imageWidth: img.width,
        imageHeight: img.height,
        ...(store.placedTables.length > 0 ? { placedTables: store.placedTables } : {}),
        ...(store.tableTypes.length > 0 ? { tableTypes: store.tableTypes } : {}),
        ...(store.sections.length > 0 ? { sections: store.sections } : {}),
        ...(store.walls.length > 0 ? { walls: store.walls } : {}),
        ...(store.obstacles.length > 0 ? { obstacles: store.obstacles } : {}),
        ...(store.scalePxPerMm !== 1 ? { scalePxPerUnit: store.scalePxPerMm } : {}),
      });
    } else {
      store.floorplan.imageGridfsId = gridfsId;
      store.floorplan.imageWidth = img.width;
      store.floorplan.imageHeight = img.height;
    }
  } catch (_e: unknown) {
    const err = _e as {
      name?: string;
      code?: string;
      response?: { data?: { error?: string } };
      message?: string;
    };
    console.error('Failed to load floorplan image:', err);
    errorMsg.value = 'Failed to load floorplan image. Please try refreshing the page.';
  }
}

const bgImageConfig = computed(() => {
  if (!bgImage.value) return {};
  return {
    image: bgImage.value,
    x: 0,
    y: 0,
    width: store.floorplan?.imageWidth || bgImage.value.width,
    height: store.floorplan?.imageHeight || bgImage.value.height,
  };
});

// ── Zoom ───────────────────────────────────────────────────────────
function handleZoom(e: Konva.KonvaEventObject<WheelEvent>) {
  e.evt.preventDefault();
  const scaleBy = 1.1;
  const stage = stageRef.value?.getNode();
  if (!stage) return;

  const oldScale = stage.scaleX();
  const pointer = stage.getPointerPosition();
  if (!pointer) return;

  const mousePointTo = {
    x: (pointer.x - stage.x()) / oldScale,
    y: (pointer.y - stage.y()) / oldScale,
  };

  const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
  const clampedScale = Math.max(0.1, Math.min(5, newScale));

  const newPos = {
    x: pointer.x - mousePointTo.x * clampedScale,
    y: pointer.y - mousePointTo.y * clampedScale,
  };

  stage.scale({ x: clampedScale, y: clampedScale });
  stage.position(newPos);
  store.setStageConfig({ x: newPos.x, y: newPos.y, scale: clampedScale });
}

function zoomIn() {
  const stage = stageRef.value?.getNode();
  if (!stage) return;
  const scaleBy = 1.1;
  const oldScale = stage.scaleX();
  const newScale = Math.min(5, oldScale * scaleBy);
  const center = {
    x: stage.width() / 2,
    y: stage.height() / 2,
  };
  const mousePointTo = {
    x: (center.x - stage.x()) / oldScale,
    y: (center.y - stage.y()) / oldScale,
  };
  const newPos = {
    x: center.x - mousePointTo.x * newScale,
    y: center.y - mousePointTo.y * newScale,
  };
  stage.scale({ x: newScale, y: newScale });
  stage.position(newPos);
  store.setStageConfig({ x: newPos.x, y: newPos.y, scale: newScale });
}

function zoomOut() {
  const stage = stageRef.value?.getNode();
  if (!stage) return;
  const scaleBy = 1.1;
  const oldScale = stage.scaleX();
  const newScale = Math.max(0.1, oldScale / scaleBy);
  const center = {
    x: stage.width() / 2,
    y: stage.height() / 2,
  };
  const mousePointTo = {
    x: (center.x - stage.x()) / oldScale,
    y: (center.y - stage.y()) / oldScale,
  };
  const newPos = {
    x: center.x - mousePointTo.x * newScale,
    y: center.y - mousePointTo.y * newScale,
  };
  stage.scale({ x: newScale, y: newScale });
  stage.position(newPos);
  store.setStageConfig({ x: newPos.x, y: newPos.y, scale: newScale });
}

function fitToScreen() {
  const stage = stageRef.value?.getNode();
  if (!stage) return;
  stage.position({ x: 0, y: 0 });
  stage.scale({ x: 1, y: 1 });
  store.setStageConfig({ x: 0, y: 0, scale: 1 });
}

function toggleGrid() {
  showGrid.value = !showGrid.value;
}

// ── Stage mouse handlers ───────────────────────────────────────────
function handleStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
  // Click on empty space → clear selection
  if (e.target === e.target.getStage()) {
    store.clearSelection();
    const tr = transformerRef.value?.getNode();
    if (tr) tr.nodes([]);
    snapGuides.value = [];
  }
}

function handleStageMouseMove() {
  // No-op: panning handled by stage.draggable
}

function handleStageMouseUp() {
  // Clear snap guides on mouse up
  snapGuides.value = [];
}

// ── Table helpers ──────────────────────────────────────────────────
function getTableColor(table: PlacedTableObject): string {
  const tt = store.tableTypes.find((t) => t.id === table.tableTypeId);
  return tt?.color || '#49B096';
}

function tableRectConfig(table: PlacedTableObject) {
  const pxPerMm = store.scalePxPerMm;
  return {
    x: table.x * pxPerMm - (table.widthMm * pxPerMm) / 2,
    y: table.y * pxPerMm - (table.heightMm * pxPerMm) / 2,
    width: table.widthMm * pxPerMm,
    height: table.heightMm * pxPerMm,
    rotation: table.rotation,
    fill: getTableColor(table),
    stroke: store.selectedTableIds.includes(table.id) ? '#00ff00' : '#272323',
    strokeWidth: 1.5,
    draggable: props.editMode,
    name: 'table',
    id: table.id,
  };
}

// ── Table drag handlers ────────────────────────────────────────────
function onTableDragStart(_table: PlacedTableObject) {
  void _table;
  const stage = stageRef.value?.getNode();
  if (!stage) return;
  pushSnapshot();
  snapGuides.value = [];
}

function onTableDragEnd(table: PlacedTableObject) {
  const stage = stageRef.value?.getNode();
  if (!stage) return;
  const node = stage.findOne(`#${table.id}`);
  if (!node) return;

  const pxPerMm = store.scalePxPerMm;
  const snapped = checkSnaps(node);

  store.updateTablePosition(
    table.id,
    (node.x() + node.width() / 2) / pxPerMm,
    (node.y() + node.height() / 2) / pxPerMm,
    node.rotation(),
  );

  if (!snapped) {
    snapGuides.value = [];
  }
}

// ── Table click (selection) ────────────────────────────────────────
function onTableClick(table: PlacedTableObject, e: Konva.KonvaEventObject<MouseEvent>) {
  if (!props.editMode) return;

  const multi = e.evt?.ctrlKey || e.evt?.metaKey;
  store.selectTable(table.id, multi);

  const stage = stageRef.value?.getNode();
  const tr = transformerRef.value?.getNode();
  if (!stage || !tr) return;

  if (store.selectedTableIds.length === 0) {
    tr.nodes([]);
  } else {
    const selectedNodes = store.selectedTableIds
      .map((id) => stage.findOne(`#${id}`))
      .filter(Boolean);
    tr.nodes(selectedNodes);
  }
  tr.getLayer()?.batchDraw();
}

// ── Transformer config ─────────────────────────────────────────────
const transformerConfig = computed(() => ({
  keepRatio: true,
  enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as string[],
  borderStroke: '#00ff00',
  borderStrokeWidth: 1.5,
  anchorSize: 8,
  anchorFill: '#00ff00',
  anchorStroke: '#ffffff',
  anchorStrokeWidth: 1.5,
  rotateEnabled: true,
}));

// ── Snap-to-edge/corner ────────────────────────────────────────────
function checkSnaps(node: {
  id(): string;
  getClientRect(): { x: number; y: number; width: number; height: number };
  x: { (): number; (val: number): void };
  y: { (): number; (val: number): void };
}): boolean {
  snapGuides.value = [];
  const tolerance = 10;

  const stage = stageRef.value?.getNode();
  if (!stage) return false;

  const nodeRect = node.getClientRect();
  const tables = stage.find('.table').filter((n: Konva.Node) => n.id() !== node.id());

  let snapped = false;

  for (const other of tables) {
    const otherRect = other.getClientRect();

    // Left edge alignment
    if (Math.abs(nodeRect.x - otherRect.x) < tolerance) {
      node.x(node.x() + (otherRect.x - nodeRect.x));
      snapGuides.value.push({
        key: `snap-left-${other.id()}`,
        points: [otherRect.x, 0, otherRect.x, stage.height()],
        stroke: '#00ff00',
        strokeWidth: 1,
        dash: [4, 4],
        listening: false,
      });
      snapped = true;
      break;
    }

    // Right edge alignment
    if (Math.abs(nodeRect.x + nodeRect.width - (otherRect.x + otherRect.width)) < tolerance) {
      const targetX = otherRect.x + otherRect.width;
      node.x(node.x() + (targetX - (nodeRect.x + nodeRect.width)));
      snapGuides.value.push({
        key: `snap-right-${other.id()}`,
        points: [targetX, 0, targetX, stage.height()],
        stroke: '#00ff00',
        strokeWidth: 1,
        dash: [4, 4],
        listening: false,
      });
      snapped = true;
      break;
    }

    // Center X alignment
    const nodeCenterX = nodeRect.x + nodeRect.width / 2;
    const otherCenterX = otherRect.x + otherRect.width / 2;
    if (Math.abs(nodeCenterX - otherCenterX) < tolerance) {
      node.x(node.x() + (otherCenterX - nodeCenterX));
      snapGuides.value.push({
        key: `snap-cx-${other.id()}`,
        points: [otherCenterX, 0, otherCenterX, stage.height()],
        stroke: '#00ff00',
        strokeWidth: 1,
        dash: [4, 4],
        listening: false,
      });
      snapped = true;
      break;
    }

    // Top edge alignment
    if (Math.abs(nodeRect.y - otherRect.y) < tolerance) {
      node.y(node.y() + (otherRect.y - nodeRect.y));
      snapGuides.value.push({
        key: `snap-top-${other.id()}`,
        points: [0, otherRect.y, stage.width(), otherRect.y],
        stroke: '#00ff00',
        strokeWidth: 1,
        dash: [4, 4],
        listening: false,
      });
      snapped = true;
      break;
    }

    // Bottom edge alignment
    if (Math.abs(nodeRect.y + nodeRect.height - (otherRect.y + otherRect.height)) < tolerance) {
      const targetY = otherRect.y + otherRect.height;
      node.y(node.y() + (targetY - (nodeRect.y + nodeRect.height)));
      snapGuides.value.push({
        key: `snap-bottom-${other.id()}`,
        points: [0, targetY, stage.width(), targetY],
        stroke: '#00ff00',
        strokeWidth: 1,
        dash: [4, 4],
        listening: false,
      });
      snapped = true;
      break;
    }

    // Center Y alignment
    const nodeCenterY = nodeRect.y + nodeRect.height / 2;
    const otherCenterY = otherRect.y + otherRect.height / 2;
    if (Math.abs(nodeCenterY - otherCenterY) < tolerance) {
      node.y(node.y() + (otherCenterY - nodeCenterY));
      snapGuides.value.push({
        key: `snap-cy-${other.id()}`,
        points: [0, otherCenterY, stage.width(), otherCenterY],
        stroke: '#00ff00',
        strokeWidth: 1,
        dash: [4, 4],
        listening: false,
      });
      snapped = true;
      break;
    }
  }

  if (snapped) {
    stage.batchDraw();
  }

  return snapped;
}

// ── Wall rendering ─────────────────────────────────────────────────
function wallLineConfig(wall: WallSegment) {
  return {
    points: [wall.start[0], wall.start[1], wall.end[0], wall.end[1]],
    stroke: '#666666',
    strokeWidth: Math.max(2, wall.thicknessMm * store.scalePxPerMm),
    name: 'wall',
    id: wall.id,
    listening: false,
  };
}

// ── Grid lines ─────────────────────────────────────────────────────
const gridLines = computed(() => {
  if (!showGrid.value) return [];

  const scale = store.stageConfig.scale;
  const baseGridSize = 50;
  const gridSize = Math.max(10, baseGridSize * scale);

  const w = (containerWidth.value || 1200) * 3;
  const h = (containerHeight.value || 800) * 3;
  const lines: Array<{
    key: string;
    points: number[];
    stroke: string;
    strokeWidth: number;
    listening: boolean;
  }> = [];

  const offsetX = ((store.stageConfig.x % gridSize) + gridSize) % gridSize;
  const offsetY = ((store.stageConfig.y % gridSize) + gridSize) % gridSize;

  for (let x = -offsetX; x <= w; x += gridSize) {
    lines.push({
      key: `gx-${Math.round(x)}`,
      points: [x, -h, x, h * 2],
      stroke: '#e0ddd8',
      strokeWidth: 0.5,
      listening: false,
    });
  }
  for (let y = -offsetY; y <= h; y += gridSize) {
    lines.push({
      key: `gy-${Math.round(y)}`,
      points: [-w, y, w * 2, y],
      stroke: '#e0ddd8',
      strokeWidth: 0.5,
      listening: false,
    });
  }
  return lines;
});

// ── Expose for parent ──────────────────────────────────────────────
defineExpose({ loadBackgroundImage });

// ── Watch initialFloorplanId ───────────────────────────────────────
watch(
  () => props.initialFloorplanId,
  (id) => {
    if (id) {
      loadBackgroundImage(id);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="floorplan-editor" ref="containerRef" data-testid="floorplan-editor-stage">
    <Transition name="fade">
      <div v-if="errorMsg" class="editor-error-banner" data-testid="floorplan-editor-error">
        {{ errorMsg }}
      </div>
    </Transition>
    <v-stage
      ref="stageRef"
      :config="stageConfig"
      @wheel="handleZoom"
      @mousedown="handleStageMouseDown"
      @mousemove="handleStageMouseMove"
      @mouseup="handleStageMouseUp"
    >
      <!-- Layer 1: Background image + gridlines -->
      <v-layer ref="bgLayerRef">
        <v-image v-if="bgImage" :config="bgImageConfig" />
        <v-line v-for="line in gridLines" :key="line.key" :config="line" />
      </v-layer>

      <!-- Layer 2: Walls -->
      <v-layer ref="wallLayerRef">
        <v-line v-for="wall in store.walls" :key="wall.id" :config="wallLineConfig(wall)" />
      </v-layer>

      <!-- Layer 3: Tables (interactive) -->
      <v-layer ref="tableLayerRef">
        <v-rect
          v-for="table in store.placedTables"
          :key="table.id"
          :config="tableRectConfig(table)"
          @dragstart="onTableDragStart(table)"
          @dragend="onTableDragEnd(table)"
          @click="onTableClick(table, $event)"
        />
        <v-transformer ref="transformerRef" :config="transformerConfig" />
      </v-layer>

      <!-- Layer 4: Guides (snap indicators) -->
      <v-layer ref="guideLayerRef">
        <v-line v-for="guide in snapGuides" :key="guide.key" :config="guide" />
      </v-layer>
    </v-stage>

    <!-- Toolbar overlay -->
    <div class="editor-toolbar">
      <button
        class="toolbar-btn"
        data-testid="floorplan-editor-zoom-in"
        @click="zoomIn"
        title="Zoom in"
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        class="toolbar-btn"
        data-testid="floorplan-editor-zoom-out"
        @click="zoomOut"
        title="Zoom out"
        aria-label="Zoom out"
      >
        &minus;
      </button>
      <button
        class="toolbar-btn"
        data-testid="floorplan-editor-fit"
        @click="fitToScreen"
        title="Fit to screen"
        aria-label="Fit to screen"
      >
        Fit
      </button>
      <button
        class="toolbar-btn"
        :class="{ 'is-active': showGrid }"
        data-testid="floorplan-editor-grid"
        @click="toggleGrid"
        title="Toggle grid"
        aria-label="Toggle grid"
      >
        Grid
      </button>
    </div>
  </div>
</template>

<style scoped>
.floorplan-editor {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 400px;
  overflow: hidden;
  background: var(--mm-beige);
  border-radius: 10px;
  border: 2px solid var(--mm-grey);
}

/* ── Toolbar overlay ──────────────────────────────────────────── */
.editor-toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 6px;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(39, 35, 35, 0.12);
  z-index: 10;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 10px;

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

.toolbar-btn:hover {
  opacity: 0.85;
  background: color-mix(in srgb, var(--mm-green) 85%, black);
}

.toolbar-btn.is-active {
  background: var(--mm-yellow);
  color: var(--mm-black);
}

.toolbar-btn.is-active:hover {
  background: color-mix(in srgb, var(--mm-yellow) 85%, black);
  opacity: 0.9;
}

/* ── Error banner ────────────────────────────────────────────── */
.editor-error-banner {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 15;
  padding: 8px 20px;
  background: color-mix(in srgb, var(--mm-yellow) 22%, transparent);
  border: 1px solid var(--mm-yellow);
  border-radius: 6px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-black);
  text-align: center;
  max-width: 90%;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
