import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type {
  BetaFloorplan,
  BetaTableType,
  WallSegment,
  ObstacleZone,
  BetaPlacedTable,
  BetaFloorplanSection,
} from '@/assets/types/datatypes';

export const useFloorplanStore = defineStore('floorplan', () => {
  // ── Core data ──────────────────────────────────────────────────────
  const floorplan = ref<BetaFloorplan | null>(null);
  const tableTypes = ref<BetaTableType[]>([]);
  const walls = ref<WallSegment[]>([]);
  const obstacles = ref<ObstacleZone[]>([]);
  const placedTables = ref<BetaPlacedTable[]>([]);
  const sections = ref<BetaFloorplanSection[]>([]);

  // ── UI state ───────────────────────────────────────────────────────
  const selectedTableIds = ref<string[]>([]);
  const scalePxPerMm = ref<number>(1);
  /**
   * The floor plan image's own size in pixels - with the scale, the size of the room. Known from
   * the upload on, because Auto-Place needs it before the editor has ever loaded the image: the
   * room was a fixed 10 m square while this went unrecorded until a later step (bug 38).
   */
  const imageSizePx = ref<{ width: number; height: number } | null>(null);
  const stageConfig = ref({ x: 0, y: 0, scale: 1 });
  const isLoading = ref(false);
  const isDirty = ref(false);

  // ── Undo / redo history ────────────────────────────────────────────
  const MAX_HISTORY = 50;
  const history = ref<string[]>([]);
  const historyIndex = ref(-1);

  // ── Getters ────────────────────────────────────────────────────────
  const canUndo = computed(() => historyIndex.value > 0);
  const canRedo = computed(() => historyIndex.value < history.value.length - 1);
  const selectedTables = computed(() =>
    placedTables.value.filter((t) => selectedTableIds.value.includes(t.id)),
  );
  const tableCount = computed(() => placedTables.value.length);

  /** Full floorplan snapshot suitable for saving to the API. */
  const currentFloorplan = computed<BetaFloorplan | null>(() => {
    if (!floorplan.value) return null;
    return {
      ...floorplan.value,
      tableTypes: tableTypes.value,
      walls: walls.value,
      obstacles: obstacles.value,
      placedTables: placedTables.value,
      sections: sections.value,
      scalePxPerUnit: scalePxPerMm.value,
    };
  });

  // ── Internal helpers ───────────────────────────────────────────────
  function markDirty() {
    isDirty.value = true;
  }

  function resetState() {
    history.value = [];
    historyIndex.value = -1;
    isDirty.value = false;
    selectedTableIds.value = [];
  }

  // ── Floorplan lifecycle ────────────────────────────────────────────

  /**
   * The id of the floorplan the market already stores, which the wizard's floorplan takes, so a
   * later visit's save replaces that floorplan rather than adding one (T272); null for a new id.
   */
  const storedFloorplanId = ref<string | null>(null);

  /** The wizard opens on a market: its floorplan takes the id of the one the market stores. */
  function openOnMarket(storedId: string | null) {
    storedFloorplanId.value = storedId;
    if (storedId && floorplan.value) floorplan.value.id = storedId;
  }

  /** Create a brand-new floorplan from a partial definition. */
  function initFloorplan(data: Partial<BetaFloorplan>) {
    floorplan.value = {
      id: storedFloorplanId.value ?? crypto.randomUUID(),
      scaleUnit: 'mm',
      tableTypes: [],
      walls: [],
      obstacles: [],
      placedTables: [],
      sections: [],
      ...data,
    };
    tableTypes.value = floorplan.value.tableTypes;
    walls.value = floorplan.value.walls;
    obstacles.value = floorplan.value.obstacles;
    placedTables.value = floorplan.value.placedTables;
    sections.value = floorplan.value.sections;
    scalePxPerMm.value = floorplan.value.scalePxPerUnit ?? 1;
    adoptImageSize(floorplan.value);
    resetState();
  }

  /** Take the image size a floorplan carries, keeping the one already known when it has none. */
  function adoptImageSize(fp: Partial<BetaFloorplan>) {
    if (fp.imageWidth && fp.imageHeight) {
      imageSizePx.value = { width: fp.imageWidth, height: fp.imageHeight };
    }
  }

  function setImageSize(width: number, height: number) {
    imageSizePx.value = { width, height };
  }

  /** Hydrate the store from an existing floorplan object (e.g. from the API). */
  function setFloorplan(fp: BetaFloorplan) {
    floorplan.value = fp;
    tableTypes.value = fp.tableTypes ?? [];
    walls.value = fp.walls ?? [];
    obstacles.value = fp.obstacles ?? [];
    placedTables.value = fp.placedTables ?? [];
    sections.value = fp.sections ?? [];
    scalePxPerMm.value = fp.scalePxPerUnit ?? 1;
    adoptImageSize(fp);
    resetState();
  }

  // ── Table-type management ──────────────────────────────────────────
  function addTableType(tt: BetaTableType) {
    tableTypes.value.push(tt);
    markDirty();
  }

  function removeTableType(id: string) {
    tableTypes.value = tableTypes.value.filter((t) => t.id !== id);
    markDirty();
  }

  // ── Wall / obstacle management ─────────────────────────────────────
  function setWalls(w: WallSegment[]) {
    walls.value = w;
    markDirty();
  }

  function updateWall(id: string, updates: Partial<WallSegment>) {
    const idx = walls.value.findIndex((w) => w.id === id);
    if (idx >= 0) {
      walls.value[idx] = { ...walls.value[idx], ...updates };
      markDirty();
    }
  }

  function updateObstacle(id: string, updates: Partial<ObstacleZone>) {
    const idx = obstacles.value.findIndex((o) => o.id === id);
    if (idx >= 0) {
      obstacles.value[idx] = { ...obstacles.value[idx], ...updates };
      markDirty();
    }
  }

  // ── Table placement ────────────────────────────────────────────────
  function setPlacedTables(tables: BetaPlacedTable[]) {
    placedTables.value = tables;
    markDirty();
  }

  function updateTablePosition(id: string, x: number, y: number, rotation?: number) {
    const tbl = placedTables.value.find((t) => t.id === id);
    if (tbl) {
      tbl.x = x;
      tbl.y = y;
      if (rotation !== undefined) tbl.rotation = rotation;
      markDirty();
    }
  }

  function addPlacedTable(table: BetaPlacedTable) {
    placedTables.value.push(table);
    markDirty();
  }

  function removePlacedTable(id: string) {
    placedTables.value = placedTables.value.filter((t) => t.id !== id);
    markDirty();
  }

  // ── Selection ──────────────────────────────────────────────────────
  function selectTable(id: string, multi = false) {
    if (multi) {
      const idx = selectedTableIds.value.indexOf(id);
      if (idx >= 0) selectedTableIds.value.splice(idx, 1);
      else selectedTableIds.value.push(id);
    } else {
      selectedTableIds.value = [id];
    }
  }

  function clearSelection() {
    selectedTableIds.value = [];
  }

  // ── Scale & stage ──────────────────────────────────────────────────
  function setScale(pxPerMm: number) {
    scalePxPerMm.value = pxPerMm;
  }

  function setStageConfig(cfg: { x: number; y: number; scale: number }) {
    stageConfig.value = cfg;
  }

  // ── Sections ───────────────────────────────────────────────────────
  function setSections(secs: BetaFloorplanSection[]) {
    sections.value = secs;
    markDirty();
  }

  // ── Undo / redo history ────────────────────────────────────────────

  /**
   * Push a Konva-compatible JSON snapshot onto the history stack.
   * The FloorplanEditor component is responsible for calling
   * `stage.toJSON()` and passing the serialised string here.
   */
  function pushHistory(snapshot: string) {
    // Discard any “future” states when a new action is performed
    history.value = history.value.slice(0, historyIndex.value + 1);
    history.value.push(snapshot);
    if (history.value.length > MAX_HISTORY) history.value.shift();
    historyIndex.value = history.value.length - 1;
  }

  function undo() {
    if (!canUndo.value) return;
    historyIndex.value--;
  }

  function redo() {
    if (!canRedo.value) return;
    historyIndex.value++;
  }

  // ── Public API ─────────────────────────────────────────────────────
  return {
    // state
    floorplan,
    tableTypes,
    walls,
    obstacles,
    placedTables,
    sections,
    selectedTableIds,
    scalePxPerMm,
    imageSizePx,
    stageConfig,
    isLoading,
    isDirty,
    history,
    historyIndex,

    // getters
    canUndo,
    canRedo,
    selectedTables,
    tableCount,
    currentFloorplan,

    // actions – lifecycle
    openOnMarket,
    initFloorplan,
    setFloorplan,
    setImageSize,
    resetState,
    markDirty,

    // actions – table types
    addTableType,
    removeTableType,

    // actions – walls & obstacles
    setWalls,
    updateWall,
    updateObstacle,

    // actions – placement
    setPlacedTables,
    updateTablePosition,
    addPlacedTable,
    removePlacedTable,

    // actions – selection
    selectTable,
    clearSelection,

    // actions – viewport
    setScale,
    setStageConfig,

    // actions – sections
    setSections,

    // actions – history
    pushHistory,
    undo,
    redo,
  };
});
