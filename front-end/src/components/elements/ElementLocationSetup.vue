<script setup lang="ts">
import { ref, toRef, watch } from 'vue';
import { type SetupObject } from '@/assets/types/datatypes';
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
    name: '',
  };
  locationObjects.value.push(newLocation);
};

const removeRow = (index: number | null) => {
  if (index != null) {
    locationObjects.value.splice(index, 1);
  }
};
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
        type="button"
        class="add-row"
        aria-label="Add a location"
        data-testid="setup-location-add-button"
        @click="addRow"
      >
        <IconAddRound class="add-row__icon" />
      </button>
    </div>
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

  /* gap: 15px; */
}

.column-titles {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 2rem;
  margin-bottom: 15px;
}

.rows {
  display: flex;
  flex-direction: column;
  width: 100%;

  align-items: center;

  gap: 8px;
  padding-top: 4px;
  padding-bottom: 8px;

  overflow-y: auto;
  overflow-x: hidden;
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 2rem;
  padding-top: 5px;
  padding-bottom: 5px;
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

.icon-close-round {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  cursor: pointer;
}
</style>
