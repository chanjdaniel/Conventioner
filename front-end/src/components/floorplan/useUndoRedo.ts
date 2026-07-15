import { computed, onMounted, onUnmounted } from 'vue';
import type { Ref } from 'vue';
import Konva from 'konva';
import { useFloorplanStore } from '@/stores/floorplan';

/**
 * Composable providing undo / redo for a Konva stage.
 *
 * @param stageRef - A Vue ref pointing to a `<v-stage>` element (vue-konva).
 */
export function useUndoRedo(stageRef: Ref<{ getNode(): Konva.Stage | null }>) {
  const store = useFloorplanStore();

  // ── Snapshot ────────────────────────────────────────────────────────

  /** Serialise the current Konva stage and push onto the store's history stack. */
  function pushSnapshot() {
    const stage = stageRef.value?.getNode();
    if (stage) store.pushHistory(stage.toJSON());
  }

  // ── Undo / redo ─────────────────────────────────────────────────────

  /** Restore the previous history snapshot. */
  function undo() {
    if (!store.canUndo) return;
    store.undo(); // decrements historyIndex
    const stage = stageRef.value?.getNode();
    const snapshot = store.history[store.historyIndex];
    if (stage && snapshot) {
      stage.destroyChildren();
      Konva.Node.create(JSON.parse(snapshot), stage.container());
      stage.batchDraw();
    }
  }

  /** Advance to the next history snapshot (if any). */
  function redo() {
    if (!store.canRedo) return;
    store.redo(); // increments historyIndex
    const stage = stageRef.value?.getNode();
    const snapshot = store.history[store.historyIndex];
    if (stage && snapshot) {
      stage.destroyChildren();
      Konva.Node.create(JSON.parse(snapshot), stage.container());
      stage.batchDraw();
    }
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent) {
    const isCtrl = e.ctrlKey || e.metaKey;

    // Ctrl+Z → undo
    if (isCtrl && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
    // Ctrl+Shift+Z or Ctrl+Y → redo
    if ((isCtrl && e.key === 'z' && e.shiftKey) || (isCtrl && e.key === 'y')) {
      e.preventDefault();
      redo();
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
    undo,
    redo,
    canUndo: computed(() => store.canUndo),
    canRedo: computed(() => store.canRedo),
    pushSnapshot,
  };
}
