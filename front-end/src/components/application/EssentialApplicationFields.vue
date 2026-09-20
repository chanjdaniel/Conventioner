<script setup lang="ts">
/**
 * The essential questions every applicant answers: their name, available dates, how many dates
 * they want, which tiers they accept, and ranked section and table type preferences. Most are
 * what the assignment solver reads, so the shape is fixed - the market plan only decides what
 * they offer. The name is the exception: it is asked whatever the plan offers, because identity
 * does not depend on it, and the solver never reads it (E13/F01/S01).
 *
 * Tier and section are asked differently on purpose. Tier is a hard filter - it sets what the
 * applicant pays for a table, and they are never placed at one they did not accept - so it is a
 * multi-select. Section is a preference they may not get, so it is a total ranking.
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
  FULL_NAME_KEY,
  FULL_NAME_LABEL,
  MAX_DATES_KEY,
  MAX_DATES_LABEL,
  SECTION_RANKING_KEY,
  SECTION_RANKING_LABEL,
  TABLE_TYPE_RANKING_KEY,
  TABLE_TYPE_RANKING_LABEL,
  TABLE_CHOICES,
  TABLE_CHOICE_KEY,
  TABLE_CHOICE_LABEL,
  TABLE_SHARE_EMAIL_KEY,
  TABLE_SHARE_EMAIL_LABEL,
  TIER_PREFERENCE_KEY,
  TIER_PREFERENCE_LABEL,
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
/**
 * Tier is answered per date (E01/F05), because a tier is a hard filter and it sets the price: one
 * set for the whole application would let someone be placed at a tier they offered on one day, and
 * charged for it, on another. So this is a grid - one row per date the applicant ticked.
 */
const tiersByDate = computed(
  () => (props.modelValue[TIER_PREFERENCE_KEY] as Record<string, string[]>) ?? {},
);

function tiersOn(date: string): string[] {
  return tiersByDate.value[date] ?? [];
}

const sectionRanking = computed(
  () => (props.modelValue[SECTION_RANKING_KEY] as string[]) ?? props.options.sections,
);
const tableTypeRanking = computed(
  () => (props.modelValue[TABLE_TYPE_RANKING_KEY] as string[]) ?? props.options.tableTypes,
);

/**
 * A ranking is total, so it always holds every offered option - seed it from the plan's order
 * the moment the offering is known, and the applicant only ever reorders. Fewer than two options
 * is not a question, so nothing is seeded and nothing is asked.
 */
watch(
  () => props.options,
  (options) => {
    if (props.disabled) return;
    const seeded: Record<string, unknown> = {};
    if (options.sections.length > 1 && !props.modelValue[SECTION_RANKING_KEY]) {
      seeded[SECTION_RANKING_KEY] = [...options.sections];
    }
    if (options.tableTypes.length > 1 && !props.modelValue[TABLE_TYPE_RANKING_KEY]) {
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

function toggleTier(date: string, tier: string, checked: boolean) {
  const current = tiersOn(date);
  const next = checked ? [...current, tier] : current.filter((t) => t !== tier);
  const all = { ...tiersByDate.value };
  if (next.length) all[date] = next;
  else delete all[date];
  setAnswer(TIER_PREFERENCE_KEY, all);
}

const fullName = computed(() => (props.modelValue[FULL_NAME_KEY] as string) ?? '');

function onFullNameInput(event: Event) {
  setAnswer(FULL_NAME_KEY, (event.target as HTMLInputElement).value);
}

const tableChoice = computed(() => (props.modelValue[TABLE_CHOICE_KEY] as string) ?? '');
const tableShareEmail = computed(() => (props.modelValue[TABLE_SHARE_EMAIL_KEY] as string) ?? '');

function onShareEmailInput(event: Event) {
  setAnswer(TABLE_SHARE_EMAIL_KEY, (event.target as HTMLInputElement).value);
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

    <!-- Full name. No `v-if`: unlike every other question here it is not gated on the plan
         offering anything, because who you are does not depend on the plan. -->
    <div class="essential-field" :data-testid="`${prefix}-essential-full-name`">
      <label class="essential-label" :for="`${prefix}-essential-full-name-input`">
        {{ FULL_NAME_LABEL }}
        <span class="essential-required">*</span>
      </label>
      <p class="essential-help">
        Your name as you would like it read out. One field: write it however you write it.
      </p>
      <input
        :id="`${prefix}-essential-full-name-input`"
        class="essential-text-input"
        :class="{ error: errorFor(FULL_NAME_KEY) }"
        type="text"
        autocomplete="name"
        :value="fullName"
        :disabled="disabled"
        :data-testid="`${prefix}-essential-full-name-input`"
        @input="onFullNameInput"
      />
      <p
        v-if="errorFor(FULL_NAME_KEY)"
        class="essential-error"
        :data-testid="`${prefix}-essential-error-full-name`"
      >
        {{ errorFor(FULL_NAME_KEY) }}
      </p>
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
      <div class="essential-choice-list" :class="{ error: errorFor(AVAILABLE_DATES_KEY) }">
        <label
          v-for="date in options.dates"
          :key="date"
          class="essential-choice"
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

    <!-- Tier preference: a hard filter, so a multi-select rather than a ranking -->
    <div
      v-if="options.tiers.length"
      class="essential-field"
      :data-testid="`${prefix}-essential-tier-preference`"
    >
      <span class="essential-label">
        {{ TIER_PREFERENCE_LABEL }}
        <span class="essential-required">*</span>
      </span>
      <p class="essential-help">
        For each date you can attend, tick every tier you would accept that day. You will never be
        placed in one you leave unticked, even if it means going unplaced.
      </p>
      <p
        v-if="!selectedDates.length"
        class="essential-help"
        :data-testid="`${prefix}-tier-no-dates`"
      >
        Pick your available dates above first.
      </p>
      <!-- One row per date the applicant ticked above, so the two answers cannot disagree: the
           back end refuses an available date with no tiers, and tiers for a date not ticked. -->
      <div
        v-for="date in selectedDates"
        :key="date"
        class="essential-tier-day"
        :data-testid="`${prefix}-essential-tier-day-${date}`"
      >
        <span class="essential-tier-day-label">{{ formattedEssentialDate(date) }}</span>
        <div class="essential-choice-list" :class="{ error: errorFor(TIER_PREFERENCE_KEY) }">
          <label
            v-for="tier in options.tiers"
            :key="tier"
            class="essential-choice"
            :class="{ checked: tiersOn(date).includes(tier) }"
          >
            <input
              type="checkbox"
              :checked="tiersOn(date).includes(tier)"
              :disabled="disabled"
              :data-testid="`${prefix}-essential-tier-${date}-${tier}`"
              @change="toggleTier(date, tier, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ tier }}</span>
          </label>
        </div>
      </div>
      <p
        v-if="errorFor(TIER_PREFERENCE_KEY)"
        class="essential-error"
        :data-testid="`${prefix}-essential-error-tier-preference`"
      >
        {{ errorFor(TIER_PREFERENCE_KEY) }}
      </p>
    </div>

    <!-- Table choice: fixed options, not plan-derived -->
    <div
      v-if="options.dates.length"
      class="essential-field"
      :data-testid="`${prefix}-essential-table-choice`"
    >
      <span class="essential-label">
        {{ TABLE_CHOICE_LABEL }}
        <span class="essential-required">*</span>
      </span>
      <p class="essential-help">
        A table seats two vendors side by side. Say whether you want one to yourself.
      </p>
      <div class="essential-choice-list" :class="{ error: errorFor(TABLE_CHOICE_KEY) }">
        <label
          v-for="choice in TABLE_CHOICES"
          :key="choice.value"
          class="essential-choice"
          :class="{ checked: tableChoice === choice.value }"
        >
          <input
            type="radio"
            :name="`${prefix}-table-choice`"
            :value="choice.value"
            :checked="tableChoice === choice.value"
            :disabled="disabled"
            :data-testid="`${prefix}-essential-table-choice-${choice.value}`"
            @change="setAnswer(TABLE_CHOICE_KEY, choice.value)"
          />
          <span>{{ choice.label }}</span>
        </label>
      </div>
      <p
        v-if="errorFor(TABLE_CHOICE_KEY)"
        class="essential-error"
        :data-testid="`${prefix}-essential-error-table-choice`"
      >
        {{ errorFor(TABLE_CHOICE_KEY) }}
      </p>
    </div>

    <!-- Table-share partner: optional, and usually blank -->
    <div
      v-if="options.dates.length"
      class="essential-field"
      :data-testid="`${prefix}-essential-table-share-email`"
    >
      <label class="essential-label" :for="`${prefix}-essential-table-share-email-input`">
        {{ TABLE_SHARE_EMAIL_LABEL }}
      </label>
      <p class="essential-help">
        Optional. If someone specific is sharing with you, put their email here and we'll try to
        seat you together. Leave it blank and you may be paired with another vendor.
      </p>
      <input
        :id="`${prefix}-essential-table-share-email-input`"
        class="essential-text-input"
        type="email"
        autocomplete="off"
        placeholder="their@email.com"
        :value="tableShareEmail"
        :disabled="disabled"
        :data-testid="`${prefix}-essential-table-share-email-input`"
        @input="onShareEmailInput"
      />
    </div>

    <!-- Section preference -->
    <div
      v-if="options.sections.length > 1"
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
      v-if="options.tableTypes.length > 1"
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
  border: 1px solid var(--mm-border);
  border-radius: 6px;
  background: #fafafa;
}

.essential-email-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--mm-black);
}

.essential-email-value {
  font-size: 14px;
  color: var(--mm-black);
}

.essential-email-note {
  font-size: 12px;
  color: var(--mm-text-muted);
}

.essential-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.essential-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--mm-black);
}

.essential-required {
  color: var(--mm-red);
}

.essential-help {
  font-size: 12px;
  color: var(--mm-text-muted);
  margin: 0;
}

.essential-choice-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border: 1px solid var(--mm-border);
  border-radius: 5px;
  background: white;
}

.essential-choice-list.error {
  border-color: var(--mm-red);
}

.essential-choice {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 5px;
  font-size: 14px;
  color: var(--mm-black);
  cursor: pointer;
}

.essential-choice:hover {
  background: #f4f4f4;
}

.essential-choice.checked {
  background: #eef7ef;
  border-color: #cfe3d4;
}

.essential-choice input[type='checkbox'],
.essential-choice input[type='radio'] {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  accent-color: var(--mm-green);
  cursor: pointer;
}

.essential-text-input {
  height: 36px;
  padding: 4px 10px;
  font-size: 14px;
  border: 1px solid var(--mm-border);
  border-radius: 5px;
  background: white;
}

.essential-text-input.error {
  border-color: var(--mm-red);
}

.essential-max-input {
  height: 36px;
  width: 120px;
  padding: 4px 10px;
  font-size: 14px;
  border: 1px solid var(--mm-border);
  border-radius: 5px;
  background: white;
}

.essential-max-input.error {
  border-color: var(--mm-red);
}

.essential-error {
  font-size: 12px;
  color: var(--mm-red);
  margin: 2px 0 0;
}
.essential-tier-day {
  margin-bottom: 10px;
}

.essential-tier-day-label {
  display: block;
  font-size: 13px;
  margin-bottom: 4px;
  color: var(--mm-black);
}
</style>
