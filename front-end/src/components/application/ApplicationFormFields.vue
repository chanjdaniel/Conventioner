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
 */
import { computed } from 'vue'
import type { FormField } from '@/assets/types/datatypes'
import { sortedFormFields } from '@/utils/applicationForm'

const props = withDefaults(
  defineProps<{
    fields: FormField[]
    modelValue: Record<string, unknown>
    errors?: Record<string, string>
    prefix?: string
  }>(),
  { errors: () => ({}), prefix: 'apply' },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, unknown>): void
  (e: 'field-change', field: FormField): void
}>()

const fields = computed(() => sortedFormFields(props.fields))

function errorFor(field: FormField): string {
  return props.errors[field.key] || ''
}

function onFieldChange(field: FormField, value: unknown) {
  emit('update:modelValue', { ...props.modelValue, [field.key]: value })
  emit('field-change', field)
}

function toggleOption(field: FormField, option: string, checked: boolean) {
  const current = [...((props.modelValue[field.key] as string[]) || [])]
  onFieldChange(field, checked ? [...current, option] : current.filter((v: string) => v !== option))
}
</script>

<template>
  <div
    v-for="field in fields"
    :key="field.key"
    class="form-field"
    :data-testid="`${prefix}-field-${field.key}`"
  >
    <label class="form-label" :for="`${prefix}-${field.key}`">
      {{ field.label }}
      <span v-if="field.required" class="form-required">*</span>
    </label>

    <p v-if="field.helpText" class="form-help">{{ field.helpText }}</p>

    <!-- text / email -->
    <input
      v-if="field.type === 'text' || field.type === 'email'"
      :id="`${prefix}-${field.key}`"
      class="form-input"
      :class="{ error: errorFor(field) }"
      :type="field.type === 'email' ? 'email' : 'text'"
      :value="(modelValue[field.key] as string) ?? ''"
      @input="onFieldChange(field, ($event.target as HTMLInputElement).value)"
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
      :data-testid="`${prefix}-input-${field.key}`"
    />

    <!-- checkbox -->
    <label v-else-if="field.type === 'checkbox'" class="form-checkbox-label">
      <input
        type="checkbox"
        :checked="!!modelValue[field.key]"
        @change="onFieldChange(field, ($event.target as HTMLInputElement).checked)"
        :data-testid="`${prefix}-input-${field.key}`"
      />
      <span>Yes</span>
    </label>

    <!-- select -->
    <select
      v-else-if="field.type === 'select'"
      :id="`${prefix}-${field.key}`"
      class="form-input"
      :class="{ error: errorFor(field) }"
      :value="(modelValue[field.key] as string) ?? ''"
      @change="onFieldChange(field, ($event.target as HTMLSelectElement).value)"
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
    >
      <label v-for="opt in field.options" :key="opt" class="form-checkbox-label">
        <input
          type="checkbox"
          :checked="((modelValue[field.key] as string[]) || []).includes(opt)"
          @change="toggleOption(field, opt, ($event.target as HTMLInputElement).checked)"
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
  gap: 4px;
}

.form-label {
  font-family: 'Outfit Regular';
  font-size: 14px;
  font-weight: bold;
  color: var(--mm-black);
}

.form-required {
  color: var(--mm-red, #cc0000);
}

.form-help {
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: var(--mm-grey, #666);
  margin: 0;
}

.form-input {
  height: 36px;
  padding: 4px 10px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  border: 1px solid var(--mm-grey, #b0b0b0);
  border-radius: 5px;
  background: white;
}

.form-input.error {
  border-color: var(--mm-red, #cc0000);
}

.form-checkbox-label {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-black);
  cursor: pointer;
}

.form-multiselect {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--mm-grey, #ddd);
  border-radius: 5px;
  background: white;
}

.form-multiselect.error {
  border-color: var(--mm-red, #cc0000);
}

.form-field-error {
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: var(--mm-red, #cc0000);
  margin: 2px 0 0;
}

.form-unsupported {
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: var(--mm-red, #cc0000);
  font-style: italic;
}
</style>
