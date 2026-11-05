<script setup lang="ts">
/**
 * The applicant's editable rendering of a market's application form: every field type the builder
 * can produce, with no per-field special-casing.
 *
 * It is one component because both applicant surfaces - the public application page and the edit
 * mode of the applicant dashboard - render the same form, and two copies of a type switch drift:
 * a field type only one copy knows renders there as an input and here as a bare label, and if it
 * is required the applicant is blocked from saving by an error they have no control to clear. A
 * field type added to the builder must reach the applicant everywhere at once, so it is added
 * here, once.
 *
 * Updating a vendor's info asks the same questions (E43/F01/S03): `locked` shows the answers this
 * person may not update, read-only.
 *
 * A question of more than 12 options is a field to type in rather than a select or a wall of
 * checkboxes (`LongQuestion`). Its words stand here, as every question's do, and it takes those words
 * as its field's name, so the words here reach no control and are hidden from a reader, who would
 * hear the question twice; a press on them still puts the caret in the field, as a label's does.
 */
import { computed } from 'vue';
import type { FormField } from '@/assets/types/datatypes';
import LongQuestion, { isLongQuestion } from '@/components/application/LongQuestion.vue';
import { sortedFormFields } from '@/utils/applicationForm';

const props = withDefaults(
  defineProps<{
    fields: FormField[];
    modelValue: Record<string, unknown>;
    errors?: Record<string, string>;
    prefix?: string;
    locked?: readonly string[];
  }>(),
  { errors: () => ({}), prefix: 'apply', locked: () => [] },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, unknown>): void;
  (e: 'field-change', field: FormField): void;
}>();

const fields = computed(() => sortedFormFields(props.fields));

function isLocked(field: FormField): boolean {
  return props.locked.includes(field.key);
}

function errorFor(field: FormField): string {
  return props.errors[field.key] || '';
}

function controlId(field: FormField): string {
  return `${props.prefix}-${field.key}`;
}

function errorId(field: FormField): string {
  return `${props.prefix}-error-${field.key}`;
}

/** Only a long question's words are no label, so only they need this. */
function pressedWords(field: FormField) {
  if (isLongQuestion(field)) document.getElementById(controlId(field))?.focus();
}

function onFieldChange(field: FormField, value: unknown) {
  emit('update:modelValue', { ...props.modelValue, [field.key]: value });
  emit('field-change', field);
}

function toggleOption(field: FormField, option: string, checked: boolean) {
  const current = [...((props.modelValue[field.key] as string[]) || [])];
  onFieldChange(
    field,
    checked ? [...current, option] : current.filter((v: string) => v !== option),
  );
}
</script>

<template>
  <div
    v-for="field in fields"
    :key="field.key"
    class="form-field"
    :data-testid="`${prefix}-field-${field.key}`"
  >
    <!-- A long question's words name no control: its field takes them as its name (`LongQuestion`). -->
    <component
      :is="isLongQuestion(field) ? 'span' : 'label'"
      :id="`${prefix}-${field.key}-label`"
      class="form-label"
      :for="field.type === 'multi_select' || isLongQuestion(field) ? undefined : controlId(field)"
      :aria-hidden="isLongQuestion(field) ? 'true' : undefined"
      @click="pressedWords(field)"
    >
      {{ field.label }}
      <span v-if="field.required" class="form-required">*</span>
    </component>

    <p v-if="field.helpText" class="form-help">{{ field.helpText }}</p>

    <!-- a question of more than 12 options -->
    <LongQuestion
      v-if="isLongQuestion(field)"
      :field="field"
      :model-value="modelValue[field.key]"
      :testid="`${prefix}-input-${field.key}`"
      :field-id="controlId(field)"
      :disabled="isLocked(field)"
      :invalid="!!errorFor(field)"
      :described-by="errorFor(field) ? errorId(field) : undefined"
      @update:model-value="onFieldChange(field, $event)"
    />

    <!-- text / email -->
    <input
      v-else-if="field.type === 'text' || field.type === 'email'"
      :id="`${prefix}-${field.key}`"
      class="form-input"
      :class="{ error: errorFor(field) }"
      :type="field.type === 'email' ? 'email' : 'text'"
      :value="(modelValue[field.key] as string) ?? ''"
      @input="onFieldChange(field, ($event.target as HTMLInputElement).value)"
      :disabled="isLocked(field)"
      :data-testid="`${prefix}-input-${field.key}`"
    />

    <!-- number -->
    <input
      v-else-if="field.type === 'number'"
      :id="`${prefix}-${field.key}`"
      class="form-input"
      :class="{ error: errorFor(field) }"
      type="number"
      :value="(modelValue[field.key] as number | string) ?? ''"
      @input="onFieldChange(field, ($event.target as HTMLInputElement).value)"
      :disabled="isLocked(field)"
      :data-testid="`${prefix}-input-${field.key}`"
    />

    <!-- date -->
    <input
      v-else-if="field.type === 'date'"
      :id="`${prefix}-${field.key}`"
      class="form-input"
      :class="{ error: errorFor(field) }"
      type="date"
      :value="(modelValue[field.key] as string) ?? ''"
      @input="onFieldChange(field, ($event.target as HTMLInputElement).value)"
      :disabled="isLocked(field)"
      :data-testid="`${prefix}-input-${field.key}`"
    />

    <!-- checkbox -->
    <!-- The id ties the question's own label to it too: on its own the box was named only "Yes"
         (bug 44). -->
    <label v-else-if="field.type === 'checkbox'" class="form-checkbox-label">
      <input
        :id="`${prefix}-${field.key}`"
        type="checkbox"
        :checked="!!modelValue[field.key]"
        @change="onFieldChange(field, ($event.target as HTMLInputElement).checked)"
        :disabled="isLocked(field)"
        :data-testid="`${prefix}-input-${field.key}`"
      />
      <span>Yes</span>
    </label>

    <!-- select -->
    <select
      v-else-if="field.type === 'select'"
      :id="`${prefix}-${field.key}`"
      class="field field--select"
      :class="{ error: errorFor(field) }"
      :value="(modelValue[field.key] as string) ?? ''"
      @change="onFieldChange(field, ($event.target as HTMLSelectElement).value)"
      :disabled="isLocked(field)"
      :data-testid="`${prefix}-input-${field.key}`"
    >
      <option value="">-- Select --</option>
      <option v-for="opt in field.options" :key="opt" :value="opt">
        {{ opt }}
      </option>
    </select>

    <!-- multi_select -->
    <div
      v-else-if="field.type === 'multi_select'"
      class="form-multiselect"
      :class="{ error: errorFor(field) }"
      role="group"
      :aria-labelledby="`${prefix}-${field.key}-label`"
    >
      <label v-for="opt in field.options" :key="opt" class="form-checkbox-label">
        <input
          type="checkbox"
          :checked="((modelValue[field.key] as string[]) || []).includes(opt)"
          @change="toggleOption(field, opt, ($event.target as HTMLInputElement).checked)"
          :disabled="isLocked(field)"
          :data-testid="`${prefix}-input-${field.key}-${opt}`"
        />
        <span>{{ opt }}</span>
      </label>
    </div>

    <div v-else class="form-unsupported" :data-testid="`${prefix}-unsupported-${field.key}`">
      Unknown field type: {{ field.type }}
    </div>

    <p
      v-if="errorFor(field)"
      :id="isLongQuestion(field) ? errorId(field) : undefined"
      class="form-field-error"
      :data-testid="`${prefix}-error-${field.key}`"
    >
      {{ errorFor(field) }}
    </p>
  </div>
</template>

<style scoped>
.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.form-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
}

.form-required {
  color: var(--mm-red);
}

.form-help {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  margin: 0;
}

.form-input {
  height: var(--control-height);
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
}

.form-input.error,
.field--select.error {
  border-color: var(--mm-red);
}

/* A locked answer reads as the `.field` primitive's one disabled state: beige, muted, not taken. */
.form-input:disabled,
.form-multiselect:has(input:disabled) {
  background: var(--mm-beige);
  color: var(--mm-text-muted-on-beige);
  cursor: not-allowed;
}

.form-multiselect:has(input:disabled) .form-checkbox-label,
.form-checkbox-label:has(input:disabled),
.form-checkbox-label input:disabled {
  color: var(--mm-text-muted-on-beige);
  cursor: not-allowed;
}

.form-checkbox-label {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--target-min);
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
}

.form-multiselect {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
}

.form-multiselect.error {
  border-color: var(--mm-red);
}

.form-field-error {
  font-size: var(--text-xs);
  color: var(--mm-red);
  margin: var(--space-hairline) 0 0;
}

.form-unsupported {
  font-size: var(--text-xs);
  color: var(--mm-red);
  font-style: italic;
}
</style>
