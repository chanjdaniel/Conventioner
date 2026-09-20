<script setup lang="ts">
import { onMounted, ref, toRef, computed, watch } from 'vue';
import draggable from 'vuedraggable';
import { type SetupObject } from '@/assets/types/datatypes';
import IconAddRound from '../icons/IconAddRound.vue';
import IconClickDrag from '../icons/IconClickDrag.vue';
import IconCloseRound from '../icons/IconCloseRound.vue';
import { type TierObject } from '@/assets/types/datatypes';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(['update:setupObject']);

const setupObject = toRef(props, 'setupObject');
const tierObjects = toRef(setupObject.value, 'tiers');

/**
 * Tiers this plan declares and gives no tables to.
 *
 * Tables are generated from sections and a section carries one tier, so a tier with no section has
 * no tables on any date - a property of the plan alone, detectable with no applications and no
 * assignment. It is what produced the finding this epic answers: two vendors unplaced beside
 * nineteen free tables, because both had asked for a tier the market had no sections at.
 *
 * A warning, not an error: an organizer mid-build has one constantly, and a tier nobody has asked
 * for is harmless. `E12/F03/S02` is what refuses the assignment, and only when somebody has
 * actually asked for it.
 */
const tiersWithNoTables = computed(() => {
  const withTables = new Set(
    (setupObject.value.sections ?? [])
      .filter((section) => (section.count ?? 0) > 0 && section.tier?.name)
      .map((section) => section.tier!.name),
  );
  return new Set(
    (setupObject.value.tiers ?? [])
      .map((tier) => tier.name)
      .filter((name) => name.trim() && !withTables.has(name)),
  );
});

watch(
  () => setupObject.value.tiers,
  () => {
    emit('update:setupObject', setupObject.value);
  },
  { deep: true },
);

const watchers = new Map<number, () => void>();
const watchTierObject = (id: number) => {
  const getObjectIndex = (id: number) => {
    return tierObjects.value.findIndex((obj) => obj.id == id);
  };
  const objectIndex = getObjectIndex(id);

  const watcher = watch(
    () => tierObjects.value[objectIndex],
    (newObj) => {
      if (!newObj) {
        removeWatcher(id);
        return;
      }
    },
    { deep: true },
  );

  watchers.set(id, watcher);
};

const removeWatcher = (objId: number) => {
  if (watchers.has(objId)) {
    watchers.get(objId)!();
    watchers.delete(objId);
  }
};

const container = ref<HTMLElement | null>(null);
const rows = ref<HTMLElement | null>(null);
const columnTitles = ref<HTMLElement | null>(null);

onMounted(() => {
  // Tiers used to be pre-filled by scraping the uploaded spreadsheet's cell values. There is no
  // spreadsheet now, and a tier is the organizer's decision rather than something to infer.
});

const addTierRow = () => {
  const newTierObject: TierObject = {
    id: tierObjects.value.length + 1,
    name: '',
  };
  tierObjects.value.push(newTierObject);
  watchTierObject(newTierObject.id);
};

const removeTierRow = (index: number) => {
  tierObjects.value.splice(index, 1);
};

const hoverParentIndex = ref(null);

const dragOptions = computed(() => ({
  group: 'rows',
  disabled: false,
  ghostClass: 'sortable-chosen',
  chosenClass: 'sortable-ghost',
  dragClass: 'sortable-ghost',
  handle: '.drag-item',
  // filter: '.click-item',
  forceFallback: false,
  fallbackOnBody: false,
}));
</script>

<template>
  <div class="container" ref="container">
    <div class="column-titles row-container" ref="columnTitles">
      <h3>Priority</h3>
      <h3>Tier Name</h3>
      <h3></h3>
    </div>
    <div class="rows" ref="rows">
      <draggable class="priority-rows" v-model="tierObjects" item-key="id" v-bind="dragOptions">
        <template #item="{ element, index: parentIndex }">
          <div
            class="priority-row row-container"
            :key="element.id"
            @mouseover="hoverParentIndex = parentIndex"
            @mouseleave="hoverParentIndex = null"
          >
            <div class="row-item drag-item">
              <IconClickDrag class="click-drag" />
              <h3>{{ parentIndex + 1 }}</h3>
            </div>
            <div class="row-item">
              <div class="input-container text-item">
                <input
                  type="text"
                  v-model="tierObjects[parentIndex].name"
                  :data-testid="'setup-tier-name-input-' + parentIndex"
                  style="
                    all: unset;
                    font-size: 14px;
                    width: 100%;
                    height: 100%;
                    text-align: center;
                    text-justify: center;
                  "
                />
              </div>
              <span
                v-if="tiersWithNoTables.has(tierObjects[parentIndex].name)"
                class="tier-no-tables"
                :data-testid="'setup-tier-no-tables-' + parentIndex"
                title="Add a section at this tier to give it tables."
              >
                No tables
              </span>
            </div>
            <button
              type="button"
              class="row-remove-button"
              :aria-label="`Remove tier ${parentIndex + 1}`"
              @click="
                () => {
                  removeTierRow(parentIndex);
                }
              "
            >
              <IconCloseRound
                :class="{ 'hidden-icon': hoverParentIndex !== parentIndex }"
                class="icon-close-round"
              />
            </button>
          </div>
        </template>
      </draggable>

      <div class="add-container">
        <IconAddRound
          class="icon-add-round"
          data-testid="setup-tier-add-button"
          @click="addTierRow"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
h4 {
  height: auto;
  text-align: center;
  text-justify: center;
  min-height: 30px;
  max-height: 200px;
  max-width: 400px;
  overflow-y: scroll;
  scrollbar-width: none;
}

h3 {
  padding-left: 5px;
  padding-right: 5px;
}

.container {
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;
  align-items: center;

  padding-left: 5px;
  padding-right: 5px;
  gap: 15px;
}

.input-container {
  width: 80%;
  height: 100%;
  box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
  border-radius: 8px;
}

.column-titles {
  display: grid;
  grid-template-columns: minmax(max-content, 15%) minmax(0, 1fr) 2rem;
}

.priority-row {
  display: grid;
  grid-template-columns: minmax(max-content, 15%) minmax(0, 1fr) 2rem;
  padding-top: 5px;
  padding-bottom: 5px;
  min-height: 48px;
  overflow: visible;
}

.sortable-ghost {
  box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
  opacity: 0.7;
}

.sorting-ghost {
  opacity: 0.8;
}

.sortable-chosen {
  visibility: hidden;
}

/* .row-item {
    display: flex;
    flex-direction: row;

    padding-left: 5px;
    padding-right: 5px;
    justify-content: space-between;
    align-items: center;

    position: relative;

    border-right: 3px solid var(--mm-border);
} */

/* A warning, not a failure: amber on the market's own beige, at the size of a note rather than
   an error. An organizer mid-build has one constantly. */
.tier-no-tables {
  flex: 0 0 auto;
  margin-left: 8px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--mm-yellow);
  color: var(--mm-black);
  font-size: 11px;
  white-space: nowrap;
}

.row-item {
  display: flex;
  flex-direction: row;
  position: relative;

  padding-left: 10px;
  padding-right: 5px;
  justify-content: center;
  align-items: center;

  border-right: 3px solid var(--mm-border);
}

.row-item:last-of-type {
  border: none;
}

.priority-rows {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  overflow: visible;
}

.sorting-rows {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0px;
  overflow: visible;
}

.rows {
  display: flex;
  flex-direction: column;
  width: 100%;

  align-items: center;

  gap: 8px;
  padding-top: 4px;
  padding-bottom: 8px;

  overflow: auto;
  scrollbar-width: none;
}

.icon-add-round {
  width: 40px;
  height: 40px;
  cursor: pointer;
}

.dropdown {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  border: none;
  outline: none;
  cursor: pointer;
  font-size: 14px;
  padding-right: 5px;
  background-color: white;
}

.click-item {
  cursor: pointer;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
}

.text-item {
  cursor: text;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
}

.drag-item {
  cursor: grab;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.drag-item:active {
  cursor: grabbing;
}

/* Was `height: 56px` inside a 48px row, absolutely positioned, so the grip lines were painted
   outside the row and read as a rendering error rather than a handle. */
.click-drag {
  width: 16px;
  height: 24px;
  position: absolute;
  left: 0;
}

/* A fixed square. Sized as a percentage of its cell it rendered 8x20 in the narrow columns -
   the same icon that came out 24x24 in Section Setup, side by side on one screen. */
/* A real button: the control was a <div> with cursor:auto, tabIndex -1, no role and no
   accessible name, in a 10px-wide hit target. Keyboard users could not remove a row at all. */
.row-remove-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 24px;
  min-height: 24px;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
}

.icon-close-round {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  cursor: pointer;
}

.sorting-order-container {
  width: 100%;
  max-height: 200px;
  overflow-y: auto;
  overflow-x: hidden;
  padding-top: 10px;
  gap: 0px;
}

.sorting-order-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  height: auto;
  width: 100%;
  cursor: grab;
  padding: 4px;
}

.sorting-index-drag {
  min-width: 40px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: left;
}

.sorting-text {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 5px;
  margin-right: 5px;
  padding-left: 5px;
  padding-right: 5px;
}

.sorting-click-drag {
  width: 16px;
  height: 30px;
}
</style>
