<script setup lang="ts">
import { ref, toRef, watch } from 'vue';
import { type SetupObject } from '@/assets/types/datatypes';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(['update:setupObject']);

const setupObject = toRef(props, 'setupObject');
const assignmentOptions = toRef(setupObject.value, 'assignmentOptions');

const container = ref<HTMLElement | null>(null);
const rows = ref<HTMLElement | null>(null);

/** What the product changed about what the organizer typed, and why. Cleared on the next edit. */
const daysNote = ref('');
const proportionNote = ref('');

watch(
  () => setupObject.value.assignmentOptions,
  () => {
    emit('update:setupObject', setupObject.value);
  },
  { deep: true },
);

/**
 * How many dates one vendor may be given.
 *
 * Anything below one leaves the setting unset, which the solver reads as "the organizer named no
 * ceiling". Zero is included deliberately: the solver honours a cap literally, so a stored zero
 * assigns nobody, and nobody means zero days per vendor when they type it into a field whose
 * every other value answers "how many days may one vendor have".
 */
const handleDaysInput = (value: number) => {
  if (value < 1 || isNaN(value)) {
    assignmentOptions.value.maxAssignmentsPerVendor = null;
    return;
  }

  const MAX_DAYS = setupObject.value.marketDates.length;
  if (value > MAX_DAYS) {
    assignmentOptions.value.maxAssignmentsPerVendor = MAX_DAYS;
    daysNote.value = `Capped at ${MAX_DAYS}, the number of dates this market runs.`;
  } else {
    assignmentOptions.value.maxAssignmentsPerVendor = Math.floor(value); // Ensure integer
    daysNote.value = '';
  }
};

const handleProportionInput = (value: number) => {
  if (value < 0 || isNaN(value)) {
    // if value is less than zero or is not a number, set to null
    assignmentOptions.value.maxHalfTableProportionPerSection = null;
    return;
  }

  const MAX_PROPORTION = 100; // Backend expects percentage as integer (0-100)
  if (value > MAX_PROPORTION) {
    assignmentOptions.value.maxHalfTableProportionPerSection = MAX_PROPORTION;
    proportionNote.value = 'Capped at 100%.';
  } else {
    assignmentOptions.value.maxHalfTableProportionPerSection = Math.floor(value); // Ensure integer percentage
    proportionNote.value = '';
  }
};
</script>

<template>
  <div class="container" ref="container">
    <div class="rows" ref="rows">
      <div class="row-container row">
        <div class="row-item">
          <h3>Max assignments per vendor</h3>
          <p class="option-help">
            The most dates any one vendor can be given. Leave blank for no ceiling.
          </p>
        </div>
        <div class="row-item">
          <div class="input-container">
            <input
              type="number"
              min="1"
              :max="setupObject.marketDates.length"
              step="1"
              inputmode="numeric"
              v-model="assignmentOptions.maxAssignmentsPerVendor"
              @input="handleDaysInput(Number(($event.target as HTMLInputElement)?.value || NaN))"
              style="all: unset; font-size: 14px; width: 100%"
              data-testid="setup-options-max-assignments-input"
            />
          </div>
          <p v-if="daysNote" class="option-note" data-testid="setup-options-max-assignments-note">
            {{ daysNote }}
          </p>
        </div>
      </div>
      <div class="row-container row">
        <div class="row-item">
          <h3>Max half table proportion per section (%)</h3>
          <p class="option-help">
            A table seats two vendors side by side. This is the most of a section's tables that may
            be split in half rather than given to one vendor each.
          </p>
        </div>
        <div class="row-item">
          <div class="input-container">
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              inputmode="numeric"
              v-model="assignmentOptions.maxHalfTableProportionPerSection"
              @blur="
                handleProportionInput(Number(($event.target as HTMLInputElement)?.value || NaN))
              "
              style="all: unset; font-size: 14px; width: 100%"
              data-testid="setup-options-max-proportion-input"
            />
          </div>
          <p
            v-if="proportionNote"
            class="option-note"
            data-testid="setup-options-max-proportion-note"
          >
            {{ proportionNote }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.option-help {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
  color: var(--mm-text-muted);
  margin: 4px 0 0;
  text-align: left;
}

.option-note {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
  color: var(--mm-text-yellow);
  margin: 4px 0 0;
}

/* Match ElementMarketDates.vue select behavior: left-aligned text, ellipsis for overflow */
option {
  text-align: left;
}

select.datatype-dropdown {
  max-width: 100%;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.container {
  width: 100%;
  height: 100%;

  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;

  /* Offset parent .setting-body padding-top so "Column mapping" sits closer to the card top */
  margin-top: -8px;
}

.rows {
  display: flex;
  flex-direction: column;
  width: 100%;

  align-items: stretch;

  gap: 8px;
  padding-top: 0;
  padding-bottom: 8px;

  overflow-y: auto;
  overflow-x: hidden;
}

.mapping-heading {
  width: 100%;
  padding: 0 10px 4px;
  text-align: left;
}

.mapping-title {
  margin: 0;
  font-size: 16px;
  color: var(--mm-black);
}

.optional-label {
  font-weight: normal;
  font-size: 0.85em;
  opacity: 0.85;
}

.additional-options-heading {
  margin-top: 12px;
  padding-top: 6px;
}

.row {
  display: grid;
  grid-template-columns: 60% 40%;
  padding-top: 5px;
  padding-bottom: 5px;
}

.row-item {
  display: flex;
  /* column, not row: the help text under each label competed with it for width and wrapped to one
     word per line. Each cell stacks its own content. */
  flex-direction: column;
  position: relative;

  padding-left: 10px;
  padding-right: 10px;
  justify-content: center;
  align-items: flex-start;
  gap: 2px;

  border-right: 3px solid var(--mm-border);
}

.row-item h3 {
  margin: 0;
}

.row-item:last-of-type {
  border: none;
}

.enum-item {
  cursor: pointer;
}

/* Native select arrows ignore padding; use appearance:none + background chevron for consistent inset */
.datatype-dropdown {
  width: 100%;
  height: 100%;
  min-height: 32px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  text-align: left;
  text-align-last: left;
  direction: ltr;
  border: none;
  outline: none;
  cursor: pointer;
  font-size: 16px;
  padding-left: 8px;
  /* Text stops before icon; chevron sits inset from the right edge */
  padding-right: 1.5rem;
  box-sizing: border-box;
  box-shadow: inset 0px 0px 4px 2px rgba(0, 0, 0, 0.25);
  border-radius: 8px;
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  background-color: white;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%23333333' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.375rem center;
  background-size: 1.125rem 1.125rem;
}

.datatype-dropdown::-ms-expand {
  display: none;
}

.datatype-dropdown,
.datatype-dropdown option {
  font-family: inherit;
  font-size: 16px;
  color: #333;
}

.input-container {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  width: 80%;
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
.icon-close-round {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  cursor: pointer;
}
</style>
