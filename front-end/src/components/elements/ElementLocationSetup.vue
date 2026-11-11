<script setup lang="ts">
/**
 * Market Setup's Location Setup: the market's locations, each a name.
 *
 * A location that has a layout takes it with it when it is removed (the plan write drops a layout
 * whose location is gone, T257), so its Remove asks first, naming the tables that would go, and
 * Cancel keeps both. A location with no layout is removed at once.
 */
import { computed, nextTick, ref, toRef, watch } from 'vue';
import { type SetupObject } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import { plural } from '@/utils/historyReaders/shared';
import IconAddRound from '@/components/icons/IconAddRound.vue';
import IconCloseRound from '@/components/icons/IconCloseRound.vue';
import { type LocationObject } from '@/assets/types/datatypes';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(['update:setupObject']);

const setupObject = toRef(props, 'setupObject');
const locationObjects = toRef(setupObject.value, 'locations');

const container = ref<HTMLElement | null>(null);
const columnTitles = ref<HTMLElement | null>(null);
const rows = ref<HTMLElement | null>(null);

watch(
  () => setupObject.value.locations,
  () => {
    emit('update:setupObject', setupObject.value);
  },
  { deep: true },
);

const hoverIndex = ref<number | null>(null);

const addRow = () => {
  const newLocation: LocationObject = {
    // Stable across renames: a location's layout names it by it (T257).
    id: crypto.randomUUID(),
    name: '',
  };
  locationObjects.value.push(newLocation);
};

/** The location whose removal is asked about, one with a layout, and whether the question is up:
 * the location stays named while the dialog closes, so its title never loses the name. */
const asking = ref<{ id: string; name: string; tables: number } | null>(null);
const askingOpen = ref(false);
const addButton = ref<HTMLButtonElement | null>(null);

const askingSentence = computed(() =>
  asking.value?.tables
    ? `Its layout of ${plural(asking.value.tables, 'table', 'tables')} goes with it.`
    : 'Its layout goes with it.',
);

const removeRow = (index: number | null) => {
  if (index == null) return;
  const location = locationObjects.value[index];
  const layout = location?.id
    ? (setupObject.value.floorplans ?? []).find((one) => one.locationId === location.id)
    : undefined;
  if (location?.id && layout) {
    asking.value = {
      id: location.id,
      name: location.name.trim() || 'this location',
      tables: layout.tables.length,
    };
    askingOpen.value = true;
    return;
  }
  locationObjects.value.splice(index, 1);
};

/** Remove the location asked about; its Remove button goes with its row, so the focus goes to
 * "Add a location" rather than being lost. */
async function removeAsked() {
  const index = locationObjects.value.findIndex((location) => location.id === asking.value?.id);
  askingOpen.value = false;
  if (index < 0) return;
  locationObjects.value.splice(index, 1);
  await nextTick();
  addButton.value?.focus();
}
</script>

<template>
  <div class="container" ref="container">
    <div class="column-titles row-container" ref="columnTitles">
      <h3>Location Name</h3>
      <h3></h3>
    </div>
    <div class="rows" ref="rows">
      <div
        class="row-container row"
        v-for="(item, index) in locationObjects"
        :key="index"
        @mouseover="hoverIndex = index"
        @mouseleave="hoverIndex = null"
      >
        <div class="row-item">
          <div class="input-container">
            <input
              type="text"
              v-model="locationObjects[index].name"
              :aria-label="`Location ${index + 1} name`"
              style="all: unset; font-size: var(--text-sm); width: 100%"
              :data-testid="'setup-location-name-input-' + index"
            />
          </div>
        </div>
        <button
          type="button"
          class="row-remove-button"
          :aria-label="`Remove location ${index + 1}`"
          @click="removeRow(index)"
        >
          <IconCloseRound
            :class="{ 'hidden-icon': hoverIndex !== index }"
            class="icon-close-round"
          />
        </button>
      </div>
      <button
        ref="addButton"
        type="button"
        class="add-row"
        aria-label="Add a location"
        data-testid="setup-location-add-button"
        @click="addRow"
      >
        <IconAddRound class="add-row__icon" />
      </button>
    </div>
    <AppDialog
      :open="askingOpen"
      :title="`Remove ${asking?.name ?? ''}?`"
      testid="remove-location"
      confirm-label="Remove location and layout"
      destructive
      @close="askingOpen = false"
      @submit="removeAsked"
    >
      <p class="remove-location-text" data-testid="remove-location-sentence">
        {{ askingSentence }}
      </p>
    </AppDialog>
  </div>
</template>

<style scoped>
.container {
  width: 100%;
  height: 100%;

  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.column-titles {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 2rem;
  margin-bottom: var(--space-4);
}

.rows {
  display: flex;
  flex-direction: column;
  width: 100%;

  align-items: center;

  gap: var(--space-2);
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 2rem;
  padding-top: var(--space-1);
  padding-bottom: var(--space-1);
}

.row-item {
  display: flex;
  flex-direction: row;
  position: relative;

  padding-left: var(--space-2);
  padding-right: var(--space-1);
  justify-content: center;
  align-items: center;

  border-right: 1px solid var(--mm-border);
}

.row-item:last-of-type {
  border: none;
}

.input-container {
  width: 80%;
  height: 100%;
  border-radius: var(--radius-card);
}

input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

input[type='number'] {
  -moz-appearance: textfield;
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

.remove-location-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.icon-close-round {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  cursor: pointer;
}
</style>
