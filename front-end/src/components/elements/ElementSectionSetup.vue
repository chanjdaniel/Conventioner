<script setup lang="ts">
import { ref, toRef, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { type SetupObject, type SectionObject } from '@/assets/types/datatypes';
import IconAddRound from '@/components/icons/IconAddRound.vue';
import IconCloseRound from '@/components/icons/IconCloseRound.vue';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(['update:setupObject']);

const setupObject = toRef(props, 'setupObject');
const sections = toRef(setupObject.value, 'sections');
const locations = toRef(setupObject.value, 'locations');
const tiers = toRef(setupObject.value, 'tiers');

const container = ref<HTMLElement | null>(null);
const columnTitles = ref<HTMLElement | null>(null);
const tableCount = ref<HTMLElement | null>(null);
const rows = ref<HTMLElement | null>(null);

const rowsMaxHeight = ref<string | null>(null);

const setHeight = () => {
  rowsMaxHeight.value = '0px';
  nextTick(() => {
    if (container.value && columnTitles.value && rows.value) {
      rowsMaxHeight.value = `${container.value.clientHeight - columnTitles.value.clientHeight - 30}px`;
    }
  });
};

const resizeObserver = new ResizeObserver(setHeight);

onMounted(() => {
  setHeight();
  nextTick(() => {
    resizeObserver.observe(document.body);
  });
});

onUnmounted(() => {
  resizeObserver.disconnect();
});

watch(
  () => setupObject.value.sections,
  () => {
    emit('update:setupObject', setupObject.value);
  },
  { deep: true },
);

const hoverIndex = ref<number | null>(null);

const handleCountInput = (index: number, value: number) => {
  if (value < 0 || isNaN(value)) {
    // if value is less than zero or is not a number, set to zero
    sections.value[index].count = 0;
  }
};

const addRow = () => {
  const newSection: SectionObject = {
    name: '',
    location: null,
    tier: null,
    count: 0,
  };
  sections.value.push(newSection);
  setHeight();
};

const removeRow = (index: number | null) => {
  if (index != null) {
    sections.value.splice(index, 1);
  }
  setHeight();
};

const countTables = () => {
  let sum = 0;
  for (let i = 0; i < sections.value.length; i++) {
    sum += sections.value[i].count;
  }
  return sum;
};
</script>

<template>
  <div class="container" ref="container">
    <div class="column-titles row-container" ref="columnTitles">
      <h3>Section Name</h3>
      <h3>Location</h3>
      <h3>Tier</h3>
      <h3>Count</h3>
    </div>
    <div class="rows" ref="rows">
      <div
        class="row-container row"
        v-for="(item, index) in sections"
        :key="index"
        @mouseover="hoverIndex = index"
        @mouseleave="hoverIndex = null"
      >
        <div class="row-item">
          <div class="input-container">
            <input
              type="text"
              v-model="sections[index].name"
              style="all: unset; font-size: 14px; width: 100%"
              :data-testid="'setup-section-name-input-' + index"
            />
          </div>
        </div>
        <div class="row-item enum-item">
          <select
            class="dropdown"
            v-model="sections[index].location"
            :data-testid="'setup-section-location-select-' + index"
          >
            <!-- :value="null", not value="": a new row's location IS null, and a string ""
                 placeholder never matches it, which left the select rendering blank. -->
            <option disabled :value="null">{{ 'Location' }}</option>
            <option
              class="display-list"
              v-for="(value, index) in locations"
              :key="index"
              :value="value"
            >
              {{ value.name }}
            </option>
          </select>
        </div>
        <div class="row-item enum-item">
          <select
            class="dropdown"
            v-model="sections[index].tier"
            :data-testid="'setup-section-tier-select-' + index"
          >
            <option disabled :value="null">{{ 'Tier' }}</option>
            <option
              class="display-list"
              v-for="(value, index) in tiers"
              :key="index"
              :value="value"
            >
              {{ value.name }}
            </option>
          </select>
        </div>
        <div class="row-item">
          <div class="input-container">
            <input
              type="number"
              v-model="sections[index].count"
              @input="
                handleCountInput(index, Number(($event.target as HTMLInputElement)?.value || NaN))
              "
              style="font-size: 14px; width: 100%"
              class="number-input"
              :data-testid="'setup-section-count-input-' + index"
            />
          </div>
        </div>
        <button
          type="button"
          class="row-remove-button"
          :aria-label="`Remove section ${index + 1}`"
          @click="removeRow(index)"
        >
          <IconCloseRound
            :class="{ 'hidden-icon': hoverIndex !== index }"
            class="icon-close-round"
          />
        </button>
      </div>
      <div class="add-container">
        <IconAddRound
          class="icon-add-round"
          @click="addRow"
          data-testid="setup-section-add-button"
        />
      </div>
    </div>
    <div ref="tableCount" style="position: absolute; left: 5px; bottom: -10px">
      <h3 style="font-size: 14px">Total tables: {{ countTables() }}</h3>
    </div>
  </div>
</template>

<style scoped>
.container {
  /* A section's name and its location are the organizer's own words and need room for them; a
     count is at most three digits, and the remove control is an icon. The even quarters clipped
     a name to about eight characters and truncated "Nest Ballroom" to "Nest Ballrc". */
  --section-columns: minmax(0, 1.5fr) minmax(0, 1.3fr) minmax(0, 1fr) 4.5rem 2rem;
  width: 100%;
  height: 100%;

  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;

  /* gap: 15px; */
}

/* One template, shared, so a heading always sits over the control it names. */
.column-titles {
  display: grid;
  grid-template-columns: var(--section-columns);
  width: 100%;
  margin-bottom: 15px;
}

.rows {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: v-bind(rowsMaxHeight);

  align-items: center;

  gap: 8px;
  padding-top: 4px;
  padding-bottom: 8px;

  overflow-y: auto;
  overflow-x: hidden;
}

.row {
  display: grid;
  grid-template-columns: var(--section-columns);
  width: 100%;
  padding-top: 5px;
  padding-bottom: 5px;
}

.row-item {
  display: flex;
  flex-direction: row;
  position: relative;

  padding-left: 6px;
  padding-right: 5px;
  justify-content: center;
  align-items: center;

  border-right: 3px solid var(--mm-border);
}

.row-item:last-of-type {
  border: none;
}

.input-container {
  /* The column already decides how much room this field gets; 80% of it threw a fifth away. */
  width: 100%;
  height: 100%;
  box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
  border-radius: 8px;
}

input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

input[type='number'] {
  -moz-appearance: textfield;
}

.icon-add-round {
  width: 40px;
  height: 40px;
  cursor: pointer;
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

.enum-item {
  cursor: pointer;
}

.dropdown {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  /* Bordered like the name and count fields beside it. With `border: none` it read as bare text
     with a stray chevron rather than as something you could operate. */
  border: 1px solid var(--mm-border);
  border-radius: 20px;
  padding-left: 8px;
  outline: none;
  cursor: pointer;
  font-size: 14px;
  padding-right: 5px;
  background-color: white;
  /* A location name that still will not fit says so, rather than stopping mid-word. */
  text-overflow: ellipsis;
}

.number-input {
  all: unset;
  font-size: 14px;
  width: 100%;
}

.number-input::-webkit-outer-spin-button,
.number-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.number-input[type='number'] {
  -moz-appearance: textfield;
}
</style>
