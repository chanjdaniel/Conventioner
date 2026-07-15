import { ref, onMounted, onUnmounted } from 'vue';
import type { Ref } from 'vue';
import Konva from 'konva';
import type { PlacedTableObject } from '@/assets/types/datatypes';
import { useFloorplanStore } from '@/stores/floorplan';

// ── Types ────────────────────────────────────────────────────────────

interface StageRef {
  getNode(): Konva.Stage | null;
}
interface TransformerRef {
  getNode(): Konva.Transformer | null;
}

export interface SnapGuide {
  key: string;
  points: number[];
  stroke: string;
  strokeWidth: number;
  dash: number[];
  listening: boolean;
}

interface RectBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Standard rotation snap angles (degrees) for the Konva Transformer. */
export const rotationSnaps: number[] = [0, 90, 180, 270];

// ── Helper ──────────────────────────────────────────────────────────

/**
 * Convert a screen (stage-container) X coordinate to a layer-local
 * X coordinate, accounting for the stage's pan and scale.
 */
function screenToLayerX(stage: Konva.Stage, screenX: number): number {
  return (screenX - stage.x()) / stage.scaleX();
}

/**
 * Convert a screen (stage-container) Y coordinate to a layer-local
 * Y coordinate, accounting for the stage's pan and scale.
 */
function screenToLayerY(stage: Konva.Stage, screenY: number): number {
  return (screenY - stage.y()) / stage.scaleY();
}

// ── Core snap algorithm ──────────────────────────────────────────────

interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

/**
 * Pure function: check whether `nodeRect` aligns with any edge or
 * center of `otherRects` within `tolerance` px. Returns the snapped
 * client-rect position and an array of visual guide-line configs, or
 * null when no snap is triggered.
 *
 * Only the **closest** snap (first match) is returned.  Guides span
 * the full stage width/height so they are visible across the viewport.
 */
function calculateSnap(
  nodeRect: RectBounds,
  otherRects: Array<{ rect: RectBounds; id: string }>,
  stageWidth: number,
  stageHeight: number,
  tolerance = 10,
): SnapResult | null {
  for (const other of otherRects) {
    const or = other.rect;

    // Left edge
    if (Math.abs(nodeRect.x - or.x) < tolerance) {
      return {
        x: nodeRect.x + (or.x - nodeRect.x),
        y: nodeRect.y,
        guides: [
          {
            key: `snap-left-${other.id}`,
            points: [or.x, 0, or.x, stageHeight],
            stroke: '#00ff00',
            strokeWidth: 1,
            dash: [4, 4],
            listening: false,
          },
        ],
      };
    }

    // Right edge
    const nodeRight = nodeRect.x + nodeRect.width;
    const otherRight = or.x + or.width;
    if (Math.abs(nodeRight - otherRight) < tolerance) {
      return {
        x: nodeRect.x + (otherRight - nodeRight),
        y: nodeRect.y,
        guides: [
          {
            key: `snap-right-${other.id}`,
            points: [otherRight, 0, otherRight, stageHeight],
            stroke: '#00ff00',
            strokeWidth: 1,
            dash: [4, 4],
            listening: false,
          },
        ],
      };
    }

    // Center X
    const nodeCenterX = nodeRect.x + nodeRect.width / 2;
    const otherCenterX = or.x + or.width / 2;
    if (Math.abs(nodeCenterX - otherCenterX) < tolerance) {
      return {
        x: nodeRect.x + (otherCenterX - nodeCenterX),
        y: nodeRect.y,
        guides: [
          {
            key: `snap-cx-${other.id}`,
            points: [otherCenterX, 0, otherCenterX, stageHeight],
            stroke: '#00ff00',
            strokeWidth: 1,
            dash: [4, 4],
            listening: false,
          },
        ],
      };
    }

    // Top edge
    if (Math.abs(nodeRect.y - or.y) < tolerance) {
      return {
        x: nodeRect.x,
        y: nodeRect.y + (or.y - nodeRect.y),
        guides: [
          {
            key: `snap-top-${other.id}`,
            points: [0, or.y, stageWidth, or.y],
            stroke: '#00ff00',
            strokeWidth: 1,
            dash: [4, 4],
            listening: false,
          },
        ],
      };
    }

    // Bottom edge
    const nodeBottom = nodeRect.y + nodeRect.height;
    const otherBottom = or.y + or.height;
    if (Math.abs(nodeBottom - otherBottom) < tolerance) {
      return {
        x: nodeRect.x,
        y: nodeRect.y + (otherBottom - nodeBottom),
        guides: [
          {
            key: `snap-bottom-${other.id}`,
            points: [0, otherBottom, stageWidth, otherBottom],
            stroke: '#00ff00',
            strokeWidth: 1,
            dash: [4, 4],
            listening: false,
          },
        ],
      };
    }

    // Center Y
    const nodeCenterY = nodeRect.y + nodeRect.height / 2;
    const otherCenterY = or.y + or.height / 2;
    if (Math.abs(nodeCenterY - otherCenterY) < tolerance) {
      return {
        x: nodeRect.x,
        y: nodeRect.y + (otherCenterY - nodeCenterY),
        guides: [
          {
            key: `snap-cy-${other.id}`,
            points: [0, otherCenterY, stageWidth, otherCenterY],
            stroke: '#00ff00',
            strokeWidth: 1,
            dash: [4, 4],
            listening: false,
          },
        ],
      };
    }
  }

  return null;
}

// ── Composable ──────────────────────────────────────────────────────

/**
 * Table-editing interactions for the FloorplanEditor.
 *
 * Provides drag-with-snap, multi-select, delete, and add-table logic.
 * Designed to be called from a `<script setup>` block of the editor
 * component so that `onMounted` / `onUnmounted` wire keyboard listeners
 * automatically.
 *
 * @param stageRef     - Vue ref pointing to a `<v-stage>` element (vue-konva).
 * @param transformerRef - Vue ref pointing to a `<v-transformer>` element.
 * @param store        - The floorplan Pinia store instance.
 */
export function useTableInteraction(
  stageRef: Ref<StageRef>,
  transformerRef: Ref<TransformerRef>,
  store: ReturnType<typeof useFloorplanStore>,
) {
  // ── Reactive state ─────────────────────────────────────────────────
  const snapGuides = ref<SnapGuide[]>([]);

  // ── Internal helpers ───────────────────────────────────────────────

  /** Safely get the underlying Konva.Stage, or null if not yet mounted. */
  function getStage(): Konva.Stage | null {
    return stageRef.value?.getNode() ?? null;
  }

  /** Safely get the underlying Konva.Transformer, or null. */
  function getTransformer(): Konva.Transformer | null {
    return transformerRef.value?.getNode() ?? null;
  }

  /** Gather client-rect data for every table EXCEPT the one with `excludeId`. */
  function getOtherTableRects(
    stage: Konva.Stage,
    excludeId: string,
  ): Array<{ rect: RectBounds; id: string }> {
    const tables: Konva.Rect[] = stage.find('.table') as Konva.Rect[];
    return tables
      .filter((n) => n.id() !== excludeId)
      .map((n) => ({ rect: n.getClientRect(), id: n.id() }));
  }

  /** Update the transformer to surround the currently selected tables. */
  function syncTransformer() {
    const stage = getStage();
    const tr = getTransformer();
    if (!stage || !tr) return;

    if (store.selectedTableIds.length === 0) {
      tr.nodes([]);
    } else {
      const selectedNodes = store.selectedTableIds
        .map((id) => stage.findOne(`#${id}`))
        .filter(Boolean) as Konva.Node[];
      tr.nodes(selectedNodes);
    }
    tr.getLayer()?.batchDraw();
  }

  // ── Snap-to-edge during drag (dragBoundFunc factory) ───────────────

  /**
   * Returns a `dragBoundFunc` suitable for a Konva.Rect.  On every
   * drag-move tick it evaluates edge/center snaps against every other
   * table on the stage (10 px tolerance) and, when a snap fires,
   * populates `snapGuides` so the editor can render green dashed guide
   * lines.
   */
  function onTableDragBoundFunc(
    table: PlacedTableObject,
  ): (pos: { x: number; y: number }) => { x: number; y: number } {
    return (pos: { x: number; y: number }): { x: number; y: number } => {
      const stage = getStage();
      if (!stage) return pos;

      const node = stage.findOne(`#${table.id}`);
      if (!node) return pos;

      // Save original layer position so we can restore it after the
      // temporary probe below.
      const origX = node.x();
      const origY = node.y();

      // Temporarily move the node to the proposed position so
      // getClientRect() reflects what the user sees.
      node.x(pos.x);
      node.y(pos.y);

      const nodeRect = node.getClientRect();
      const otherRects = getOtherTableRects(stage, table.id);

      const result = calculateSnap(nodeRect, otherRects, stage.width(), stage.height());

      // Restore original position – the real position will be set by
      // Konva after this function returns.
      node.x(origX);
      node.y(origY);

      if (result) {
        snapGuides.value = result.guides;

        // Convert the screen-coordinate delta back to layer-coordinate
        // delta (accounting for stage pan & scale).
        const deltaLayerX = screenToLayerX(stage, result.x) - screenToLayerX(stage, nodeRect.x);
        const deltaLayerY = screenToLayerY(stage, result.y) - screenToLayerY(stage, nodeRect.y);

        return { x: pos.x + deltaLayerX, y: pos.y + deltaLayerY };
      }

      snapGuides.value = [];
      return pos;
    };
  }

  // ── Drag lifecycle ──────────────────────────────────────────────────

  /** Push a JSON snapshot for undo before the drag starts. */
  function onTableDragStart(_table: PlacedTableObject) {
    void _table;
    const stage = getStage();
    if (stage) store.pushHistory(stage.toJSON());
    snapGuides.value = [];
  }

  /**
   * Persist the final (potentially snapped) position to the store and
   * clear any remaining guide lines.
   */
  function onTableDragEnd(table: PlacedTableObject) {
    const stage = getStage();
    if (!stage) return;

    const node = stage.findOne(`#${table.id}`);
    if (!node) return;

    const pxPerMm = store.scalePxPerMm;

    // The node's position may already have been adjusted by
    // dragBoundFunc.  Compute the centre in mm and save it.
    store.updateTablePosition(
      table.id,
      (node.x() + node.width() / 2) / pxPerMm,
      (node.y() + node.height() / 2) / pxPerMm,
      node.rotation(),
    );

    snapGuides.value = [];
  }

  // ── Selection (click) ──────────────────────────────────────────────

  /**
   * Handle a click on a table rectangle.
   *
   * | Modifier     | Behaviour                                        |
   * |------------- |-------------------------------------------------|
   * | *none*       | Select only this table                           |
   * | Ctrl / ⌘     | Toggle this table in the selection                |
   * | Shift        | Add this table to the selection (never remove)    |
   */
  function onTableClick(
    table: PlacedTableObject,
    e: { evt?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } },
  ) {
    const stage = getStage();
    if (!stage) return;

    const ctrl = e.evt?.ctrlKey || e.evt?.metaKey;
    const shift = e.evt?.shiftKey;

    if (shift) {
      // Shift+click: always add (range-select helper).
      // Use the store's toggle method — because the table is guaranteed
      // NOT to be in the selection (we checked above), the toggle will
      // unconditionally add it.
      if (!store.selectedTableIds.includes(table.id)) {
        store.selectTable(table.id, true);
      }
    } else {
      store.selectTable(table.id, !!ctrl);
    }

    syncTransformer();
  }

  // ── Stage click (clear selection) ──────────────────────────────────

  /** Clicking on empty canvas space clears the selection. */
  function onStageMouseDown(e: { target: { getStage(): unknown } }) {
    if (e.target === e.target.getStage()) {
      store.clearSelection();
      const tr = getTransformer();
      if (tr) tr.nodes([]);
      snapGuides.value = [];
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────

  /** Remove every currently selected table from the store. */
  function deleteSelected() {
    if (store.selectedTableIds.length === 0) return;

    const tr = getTransformer();

    for (const id of store.selectedTableIds) {
      store.removePlacedTable(id);
    }
    store.clearSelection();

    if (tr) tr.nodes([]);
    snapGuides.value = [];
  }

  // ── Add table ──────────────────────────────────────────────────────

  /**
   * Create a new `PlacedTableObject` and append it to the store.
   *
   * When called without arguments the table is placed at the **centre
   * of the current viewport**.  Pass `pos` (in stage-container pixel
   * coordinates) to place the table at a specific click location.
   *
   * The first available `TableTypeObject` is used as the new table's
   * type.
   */
  function addTableAtPosition(pos?: { x: number; y: number }) {
    const stage = getStage();
    if (!stage) return;

    const tableType = store.tableTypes[0];
    if (!tableType) return;

    // Determine the layer (floorplan) coordinates for the centre
    let layerX: number;
    let layerY: number;

    if (pos) {
      // Convert the caller-provided stage-container coordinates
      layerX = screenToLayerX(stage, pos.x);
      layerY = screenToLayerY(stage, pos.y);
    } else {
      // Default: centre of the current viewport
      layerX = screenToLayerX(stage, stage.width() / 2);
      layerY = screenToLayerY(stage, stage.height() / 2);
    }

    // Convert layer px → floorplan mm
    const mmX = layerX / store.scalePxPerMm;
    const mmY = layerY / store.scalePxPerMm;

    const newTable: PlacedTableObject = {
      id: crypto.randomUUID(),
      tableTypeId: tableType.id,
      x: mmX,
      y: mmY,
      rotation: 0,
      widthMm: tableType.widthMm,
      heightMm: tableType.heightMm,
    };

    store.addPlacedTable(newTable);
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent) {
    // Delete / Backspace → remove selected tables
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Don't swallow Backspace when the user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (store.selectedTableIds.length > 0) {
        e.preventDefault();
        deleteSelected();
      }
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  // ── Public API ──────────────────────────────────────────────────────

  return {
    /** Green dashed snap-guide line configs (rendered by a guide layer). */
    snapGuides,
    /** Standard rotation snap angles for the Konva Transformer. */
    rotationSnaps,
    /** Create a new table (uses the first available table type). */
    addTableAtPosition,
    /** Remove every selected table. */
    deleteSelected,
    /** Selection handler for table-click events. */
    onTableClick,
    /** Factory that returns a Konva-compatible `dragBoundFunc` with live edge-snapping. */
    onTableDragBoundFunc,
    /** Call at the beginning of a table drag (pushes undo snapshot). */
    onTableDragStart,
    /** Call when a table drag ends (persists position to the store). */
    onTableDragEnd,
    /** Call on stage mousedown to clear selection when clicking empty space. */
    onStageMouseDown,
    /** Keyboard handler (Delete/Backspace); wired automatically via onMounted. */
    handleKeyDown,
  };
}
