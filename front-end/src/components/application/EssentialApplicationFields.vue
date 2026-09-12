<script setup lang="ts">
/**
 * The essential questions every applicant answers: available dates, how many dates they want,
 * and ranked section and table type preferences. Their answers are what the assignment solver
 * reads, so the shape is fixed - the market plan only decides what they offer.
 *
 * One component for both applicant surfaces and the organizer's preview (`disabled`), for the
 * same no-drift reason as ApplicationFormFields: what the organizer previews must be what the
 * applicant gets.
 */
import { computed, watch } from 'vue';
import type { EssentialFormOptions } from '@/assets/types/datatypes';
import {
  AVAILABLE_DATES_KEY,
  AVAILABLE_DATES_LABEL,
  MAX_DATES_KEY,
  MAX_DATES_LABEL,
  SECTION_RANKING_KEY,
  SECTION_RANKING_LABEL,
  TABLE_TYPE_RANKING_KEY,
  TABLE_TYPE_RANKING_LABEL,
  formattedEssentialDate,
} from '@/utils/essentialFields';
import RankedChoiceInput from './RankedChoiceInput.vue';

const props = withDefaults(
  defineProps<{
    options: EssentialFormOptions;
    modelValue: Record<string, unknown>;
    errors?: Record<string, string>;
    prefix?: string;
    email?: string | null;
    disabled?: boolean;
  }>(),
  { errors: () => ({}), prefix: 'apply', email: null, disabled: false },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, unknown>): void;
  (e: 'field-change', key: string): void;
}>();

const selectedDates = computed(() => (props.modelValue[AVAILABLE_DATES_KEY] as string[]) ?? []);

const sectionRanking = computed(
  () => (props.modelValue[SECTION_RANKING_KEY] as string[]) ?? props.options.sections,
);
const tableTypeRanking = computed(
  () => (props.modelValue[TABLE_TYPE_RANKING_KEY] as string[]) ?? props.options.tableTypes,
);

/**
 * A ranking is total, so it always holds every offered option - seed it from the plan's order
 * the moment the offering is known, and the applicant only ever reorders.
 */
watch(
  () => props.options,
  (options) => {
    if (props.disabled) return;
    const seeded: Record<string, unknown> = {};
    if (options.sections.length && !props.modelValue[SECTION_RANKING_KEY]) {
      seeded[SECTION_RANKING_KEY] = [...options.sections];
    }
    if (options.tableTypes.length && !props.modelValue[TABLE_TYPE_RANKING_KEY]) {
      seeded[TABLE_TYPE_RANKING_KEY] = [...options.tableTypes];
    }
    if (Object.keys(seeded).length) {
      emit('update:modelValue', { ...props.modelValue, ...seeded });
    }
  },
  { immediate: true },
);

function setAnswer(key: string, value: unknown) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
  emit('field-change', key);
}

function toggleDate(date: string, checked: boolean) {
  const current = selectedDates.value;
  setAnswer(AVAILABLE_DATES_KEY, checked ? [...current, date] : current.filter((d) => d !== date));
}

function onMaxDatesInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  setAnswer(MAX_DATES_KEY, raw === '' ? null : Number(raw));
}

function errorFor(key: string): string {
  return props.errors[key] || '';
}
</script>

<template>
  <div class="essential-fields" :data-testid="`${prefix}-essential-fields`">
    <div v-if="email" class="essential-email" :data-testid="`${prefix}-essential-email`">
      <span class="essential-email-label">Email</span>
      <span class="essential-email-value">{{ email }}</span>
      <span class="essential-email-note">You signed in with it; every update goes there.</span>
    </div>

    <!-- Available dates -->
    <div
      v-if="options.dates.length"
      class="essential-field"
      :data-testid="`${prefix}-essential-available-dates`"
    >
      <span class="essential-label">
        {{ AVAILABLE_DATES_LABEL }}
        <span class="essential-required">*</span>
      </span>
      <p class="essential-help">Tick every market date you could attend.</p>
      <div class="essential-dates" :class="{ error: errorFor(AVAILABLE_DATES_KEY) }">
        <label
          v-for="date in options.dates"
          :key="date"
          class="essential-date-option"
          :class="{ checked: selectedDates.includes(date) }"
        >
          <input
            type="checkbox"
            :checked="selectedDates.includes(date)"
            :disabled="disabled"
            :data-testid="`${prefix}-essential-date-${date}`"
            @change="toggleDate(date, ($event.target as HTMLInputElement).checked)"
          />
          <span>{{ formattedEssentialDate(date) }}</span>
        </label>
      </div>
      <p
        v-if="errorFor(AVAILABLE_DATES_KEY)"
        class="essential-error"
        :data-testid="`${prefix}-essential-error-available-dates`"
      >
        {{ errorFor(AVAILABLE_DATES_KEY) }}
      </p>
    </div>

    <!-- Max dates -->
    <div
      v-if="options.dates.length"
      class="essential-field"
      :data-testid="`${prefix}-essential-max-dates`"
    >
      <label class="essential-label" :for="`${prefix}-essential-max-dates-input`">
        {{ MAX_DATES_LABEL }}
        <span class="essential-required">*</span>
      </label>
      <p class="essential-help">
        Being available doesn't commit you: you'll be assigned at most this many of the dates you
        ticked above.
      </p>
      <input
        :id="`${prefix}-essential-max-dates-input`"
        class="essential-max-input"
        :class="{ error: errorFor(MAX_DATES_KEY) }"
        type="number"
        min="1"
        :max="options.dates.length"
        inputmode="numeric"
        :value="(modelValue[MAX_DATES_KEY] as number | null) ?? ''"
        :disabled="disabled"
        :data-testid="`${prefix}-essential-max-dates-input`"
        @input="onMaxDatesInput"
      />
      <p
        v-if="errorFor(MAX_DATES_KEY)"
        class="essential-error"
        :data-testid="`${prefix}-essential-error-max-dates`"
      >
        {{ errorFor(MAX_DATES_KEY) }}
      </p>
    </div>

    <!-- Section preference -->
    <div
      v-if="options.sections.length"
      class="essential-field"
      :data-testid="`${prefix}-essential-section-ranking`"
    >
      <span class="essential-label">
        {{ SECTION_RANKING_LABEL }}
        <span class="essential-required">*</span>
      </span>
      <p class="essential-help">Use the arrows to order the sections, first choice on top.</p>
      <RankedChoiceInput
        :modelValue="sectionRanking"
        :testid="`${prefix}-essential-section-rank`"
        :disabled="disabled"
        @update:modelValue="(v: string[]) => setAnswer(SECTION_RANKING_KEY, v)"
      />
    </div>

    <!-- Table type preference -->
    <div
      v-if="options.tableTypes.length"
      class="essential-field"
      :data-testid="`${prefix}-essential-table-type-ranking`"
    >
      <span class="essential-label">
        {{ TABLE_TYPE_RANKING_LABEL }}
        <span class="essential-required">*</span>
      </span>
      <p class="essential-help">Use the arrows to order the table types, first choice on top.</p>
      <RankedChoiceInput
        :modelValue="tableTypeRanking"
        :testid="`${prefix}-essential-table-type-rank`"
        :disabled="disabled"
        @update:modelValue="(v: string[]) => setAnswer(TABLE_TYPE_RANKING_KEY, v)"
      />
    </div>
  </div>
</template>

<style scoped>
.essential-fields {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.essential-email {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border: 1px solid var(--mm-grey, #ddd);
  border-radius: 6px;
  background: #fafafa;
}

.essential-email-label {
  font-family: 'Outfit Regular';
  font-size: 14px;
  font-weight: bold;
  color: var(--mm-black);
}

.essential-email-value {
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-black);
}

.essential-email-note {
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: var(--mm-grey, #666);
}

.essential-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.essential-label {
  font-family: 'Outfit Regular';
  font-size: 14px;
  font-weight: bold;
  color: var(--mm-black);
}

.essential-required {
  color: var(--mm-red, #cc0000);
}

.essential-help {
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: var(--mm-grey, #666);
  margin: 0;
}

.essential-dates {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--mm-grey, #ddd);
  border-radius: 5px;
  background: white;
}

.essential-dates.error {
  border-color: var(--mm-red, #cc0000);
}

.essential-date-option {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 5px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-black);
  cursor: pointer;
}

.essential-date-option:hover {
  background: #f4f4f4;
}

.essential-date-option.checked {
  background: #eef7ef;
  border-color: #cfe3d4;
}

.essential-date-option input[type='checkbox'] {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  accent-color: var(--mm-green);
  cursor: pointer;
}

.essential-max-input {
  height: 36px;
  width: 120px;
  padding: 4px 10px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  border: 1px solid var(--mm-grey, #b0b0b0);
  border-radius: 5px;
  background: white;
}

.essential-max-input.error {
  border-color: var(--mm-red, #cc0000);
}

.essential-error {
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: var(--mm-red, #cc0000);
  margin: 2px 0 0;
}
</style>
