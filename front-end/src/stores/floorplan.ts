import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  FloorplanObject,
  TableTypeObject,
  WallSegment,
  ObstacleZone,
  PlacedTableObject,
  FloorplanSectionObject,
} from '@/assets/types/datatypes'

export const useFloorplanStore = defineStore('floorplan', () => {
  // ── Core data ──────────────────────────────────────────────────────
  const floorplan = ref<FloorplanObject | null>(null)
  const tableTypes = ref<TableTypeObject[]>([])
  const walls = ref<WallSegment[]>([])
  const obstacles = ref<ObstacleZone[]>([])
  const placedTables = ref<PlacedTableObject[]>([])
  const sections = ref<FloorplanSectionObject[]>([])

  // ── UI state ───────────────────────────────────────────────────────
  const selectedTableIds = ref<string[]>([])
  const scalePxPerMm = ref<number>(1)
  const stageConfig = ref({ x: 0, y: 0, scale: 1 })
  const isLoading = ref(false)
  const isDirty = ref(false)

  // ── Undo / redo history ────────────────────────────────────────────
  const MAX_HISTORY = 50
  const history = ref<string[]>([])
  const historyIndex = ref(-1)

  // ── Getters ────────────────────────────────────────────────────────
  const canUndo = computed(() => historyIndex.value > 0)
  const canRedo = computed(() => historyIndex.value < history.value.length - 1)
  const selectedTables = computed(() =>
    placedTables.value.filter((t) => selectedTableIds.value.includes(t.id)),
  )
  const tableCount = computed(() => placedTables.value.length)

  /** Full floorplan snapshot suitable for saving to the API. */
  const currentFloorplan = computed<FloorplanObject | null>(() => {
    if (!floorplan.value) return null
    return {
      ...floorplan.value,
      tableTypes: tableTypes.value,
      walls: walls.value,
      obstacles: obstacles.value,
      placedTables: placedTables.value,
      sections: sections.value,
      scalePxPerUnit: scalePxPerMm.value,
    }
  })

  // ── Internal helpers ───────────────────────────────────────────────
  function markDirty() {
    isDirty.value = true
  }

  function resetState() {
    history.value = []
    historyIndex.value = -1
    isDirty.value = false
    selectedTableIds.value = []
  }

  // ── Floorplan lifecycle ────────────────────────────────────────────

  /** Create a brand-new floorplan from a partial definition. */
  function initFloorplan(data: Partial<FloorplanObject>) {
    floorplan.value = {
      id: crypto.randomUUID(),
      scaleUnit: 'mm',
      tableTypes: [],
      walls: [],
      obstacles: [],
      placedTables: [],
      sections: [],
      ...data,
    }
    tableTypes.value = floorplan.value.tableTypes
    walls.value = floorplan.value.walls
    obstacles.value = floorplan.value.obstacles
    placedTables.value = floorplan.value.placedTables
    sections.value = floorplan.value.sections
    scalePxPerMm.value = floorplan.value.scalePxPerUnit ?? 1
    resetState()
  }

  /** Hydrate the store from an existing floorplan object (e.g. from the API). */
  function setFloorplan(fp: FloorplanObject) {
    floorplan.value = fp
    tableTypes.value = fp.tableTypes ?? []
    walls.value = fp.walls ?? []
    obstacles.value = fp.obstacles ?? []
    placedTables.value = fp.placedTables ?? []
    sections.value = fp.sections ?? []
    scalePxPerMm.value = fp.scalePxPerUnit ?? 1
    resetState()
  }

  // ── Table-type management ──────────────────────────────────────────
  function addTableType(tt: TableTypeObject) {
    tableTypes.value.push(tt)
    markDirty()
  }

  function removeTableType(id: string) {
    tableTypes.value = tableTypes.value.filter((t) => t.id !== id)
    markDirty()
  }

  // ── Wall / obstacle management ─────────────────────────────────────
  function setWalls(w: WallSegment[]) {
    walls.value = w
    markDirty()
  }

  function updateWall(id: string, updates: Partial<WallSegment>) {
    const idx = walls.value.findIndex((w) => w.id === id)
    if (idx >= 0) {
      walls.value[idx] = { ...walls.value[idx], ...updates }
      markDirty()
    }
  }

  function updateObstacle(id: string, updates: Partial<ObstacleZone>) {
    const idx = obstacles.value.findIndex((o) => o.id === id)
    if (idx >= 0) {
      obstacles.value[idx] = { ...obstacles.value[idx], ...updates }
      markDirty()
    }
  }

  // ── Table placement ────────────────────────────────────────────────
  function setPlacedTables(tables: PlacedTableObject[]) {
    placedTables.value = tables
    markDirty()
  }

  function updateTablePosition(id: string, x: number, y: number, rotation?: number) {
    const tbl = placedTables.value.find((t) => t.id === id)
    if (tbl) {
      tbl.x = x
      tbl.y = y
      if (rotation !== undefined) tbl.rotation = rotation
      markDirty()
    }
  }

  function addPlacedTable(table: PlacedTableObject) {
    placedTables.value.push(table)
    markDirty()
  }

  function removePlacedTable(id: string) {
    placedTables.value = placedTables.value.filter((t) => t.id !== id)
    markDirty()
  }

  // ── Selection ──────────────────────────────────────────────────────
  function selectTable(id: string, multi = false) {
    if (multi) {
      const idx = selectedTableIds.value.indexOf(id)
      if (idx >= 0) selectedTableIds.value.splice(idx, 1)
      else selectedTableIds.value.push(id)
    } else {
      selectedTableIds.value = [id]
    }
  }

  function clearSelection() {
    selectedTableIds.value = []
  }

  // ── Scale & stage ──────────────────────────────────────────────────
  function setScale(pxPerMm: number) {
    scalePxPerMm.value = pxPerMm
  }

  function setStageConfig(cfg: { x: number; y: number; scale: number }) {
    stageConfig.value = cfg
  }

  // ── Sections ───────────────────────────────────────────────────────
  function setSections(secs: FloorplanSectionObject[]) {
    sections.value = secs
    markDirty()
  }

  // ── Undo / redo history ────────────────────────────────────────────

  /**
   * Push a Konva-compatible JSON snapshot onto the history stack.
   * The FloorplanEditor component is responsible for calling
   * `stage.toJSON()` and passing the serialised string here.
   */
  function pushHistory(snapshot: string) {
    // Discard any “future” states when a new action is performed
    history.value = history.value.slice(0, historyIndex.value + 1)
    history.value.push(snapshot)
    if (history.value.length > MAX_HISTORY) history.value.shift()
    historyIndex.value = history.value.length - 1
  }

  function undo() {
    if (!canUndo.value) return
    historyIndex.value--
  }

  function redo() {
    if (!canRedo.value) return
    historyIndex.value++
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
    initFloorplan,
    setFloorplan,
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
  }
})
