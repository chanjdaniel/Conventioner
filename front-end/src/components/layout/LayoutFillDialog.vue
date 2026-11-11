<script setup lang="ts">
/**
 * Fill an area's dialog (T257): what to fill the area with, asked once it is drawn. The section
 * and the table type the tables take, how many (a number, or as many as fit), which way the rows
 * run and the aisle between them; and "Fill what is in view", which fills the part of the hall
 * the map shows instead of a drawn area, the way in for someone who draws none. Its choices but
 * the section and the type are `layoutFill.ts`'s `fillChoices`, kept for the next area.
 *
 * It asks nothing of the server itself: Fill hands the choice to the editor, which holds the
 * dialog open and its controls still while the placement runs (`busy`), and writes a refusal
 * into it (`error`).
 */
import { computed } from 'vue';
import type { SectionObject, TableTypeObject } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import {
  MAX_FILL_TABLES,
  aisleMmOf,
  areaSaid,
  countOf,
  fillChoices,
  type FillArea,
  type FillChoice,
} from './layoutFill';

const props = defineProps<{
  open: boolean;
  /** The location's sections. */
  sections: readonly SectionObject[];
  tableTypes: readonly TableTypeObject[];
  /** The area drawn; null when the dialog was opened to fill what is in view. */
  area: FillArea | null;
  /** The placement is running. */
  busy?: boolean;
  /** Why the last try placed nothing: the server's sentence. */
  error?: string;
}>();

const emit = defineEmits<{ close: []; fill: [choice: FillChoice] }>();

/** The section a new table takes: '' is no section. */
const sectionId = defineModel<string>('sectionId', { required: true });
const tableTypeId = defineModel<string>('tableTypeId', { required: true });
/** Whether what the map shows is filled, in place of the area drawn. */
const inView = defineModel<boolean>('inView', { required: true });

const count = computed(() => countOf(fillChoices.count));
const countError = computed(() =>
  fillChoices.howMany === 'count' && count.value === null
    ? `Type a whole number of tables, 1 to ${MAX_FILL_TABLES}.`
    : '',
);
const areaText = computed(() =>
  inView.value || !props.area ? 'What is in view' : areaSaid(props.area),
);

function fill() {
  if (props.busy || countError.value) return;
  emit('fill', {
    count: fillChoices.howMany === 'fit' ? null : count.value,
    direction: fillChoices.direction,
    aisleMm: aisleMmOf(fillChoices.aisleCm),
  });
}
</script>

<template>
  <AppDialog
    :open="open"
    title="Fill an area"
    testid="layout-fill"
    :confirm-label="busy ? 'Placing…' : 'Fill'"
    :confirm-disabled="busy || !!countError"
    :close-disabled="busy"
    :error="error"
    @close="emit('close')"
    @submit="fill"
  >
    <div class="fill-fields">
      <p class="fill-area" data-testid="layout-fill-area-text">Area: {{ areaText }}</p>
      <label class="fill-field">
        <span class="field-label">Section</span>
        <select
          v-model="sectionId"
          class="field field--select"
          :disabled="busy"
          data-testid="layout-fill-section"
        >
          <option v-for="section in sections" :key="section.id" :value="section.id">
            {{ section.name || 'Unnamed section' }}
          </option>
          <option value="">No section</option>
        </select>
      </label>
      <label class="fill-field">
        <span class="field-label">Table type</span>
        <select
          v-model="tableTypeId"
          class="field field--select"
          :disabled="busy"
          data-testid="layout-fill-type"
        >
          <option v-for="type in tableTypes" :key="type.id" :value="type.id">
            {{ type.name }}
          </option>
        </select>
      </label>
      <fieldset class="fill-field" :disabled="busy">
        <legend class="field-label">How many</legend>
        <div class="fill-how-many">
          <label class="fill-choice">
            <input
              v-model="fillChoices.howMany"
              type="radio"
              name="layout-fill-how-many"
              value="count"
              data-testid="layout-fill-count-choice"
            />
            <span>This many</span>
          </label>
          <input
            v-model="fillChoices.count"
            class="field fill-count"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            aria-label="Number of tables"
            :disabled="busy || fillChoices.howMany !== 'count'"
            :aria-invalid="!!countError"
            :aria-describedby="countError ? 'layout-fill-count-error' : undefined"
            data-testid="layout-fill-count"
          />
          <label class="fill-choice">
            <input
              v-model="fillChoices.howMany"
              type="radio"
              name="layout-fill-how-many"
              value="fit"
              data-testid="layout-fill-fit-choice"
            />
            <span>As many as fit</span>
          </label>
        </div>
        <span
          v-if="countError"
          id="layout-fill-count-error"
          class="fill-error"
          role="alert"
          data-testid="layout-fill-count-error"
          >{{ countError }}</span
        >
      </fieldset>
      <div class="fill-pair">
        <label class="fill-field">
          <span class="field-label">Direction</span>
          <select
            v-model="fillChoices.direction"
            class="field field--select"
            :disabled="busy"
            data-testid="layout-fill-direction"
          >
            <option value="across">Rows across</option>
            <option value="down">Rows down</option>
          </select>
        </label>
        <label class="fill-field">
          <span class="field-label">Aisle (cm)</span>
          <input
            v-model="fillChoices.aisleCm"
            class="field"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            :disabled="busy"
            data-testid="layout-fill-aisle"
          />
        </label>
      </div>
      <label class="fill-choice">
        <input
          v-model="inView"
          type="checkbox"
          :disabled="busy || !area"
          data-testid="layout-fill-in-view"
        />
        <span>Fill what is in view</span>
      </label>
    </div>
  </AppDialog>
</template>

<style scoped>
.fill-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.fill-area {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.fill-field {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: none;
  padding: 0;
  margin: 0;
}

/* A legend's own inline padding would set "How many" apart from the labels above and below it. */
.fill-field legend {
  padding: 0;
}

.fill-how-many {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.fill-choice {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--target-min);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.fill-count {
  width: 5rem;
  margin-right: var(--space-3);
}

.fill-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.fill-error {
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: var(--mm-red);
}
</style>
