<script setup lang="ts">
import { computed } from 'vue';
import { type ApplicationForm, type EssentialFormOptions } from '@/assets/types/datatypes';
import EssentialApplicationFields from './EssentialApplicationFields.vue';

const props = defineProps<{
  applicationForm: ApplicationForm | null;
  essentialOptions?: EssentialFormOptions | null;
}>();

const sortedFields = computed(() => {
  if (!props.applicationForm?.fields) return [];
  return [...props.applicationForm.fields].sort((a, b) => a.order - b.order);
});

const hasFields = computed(() => sortedFields.value.length > 0);

/**
 * The preview renders the same essential component the applicant gets, disabled. Rankings are
 * seeded here (the disabled component never writes), so the preview shows the plan's order.
 */
const essentialPreviewData = computed<Record<string, unknown>>(() => ({
  essential_section_ranking: props.essentialOptions?.sections ?? [],
  essential_table_type_ranking: props.essentialOptions?.tableTypes ?? [],
}));
</script>

<template>
  <div class="form-preview" data-testid="form-preview">
    <div class="preview-banner">
      <span class="preview-badge">PREVIEW</span>
      Applicant view
    </div>

    <div v-if="essentialOptions" class="preview-essential" data-testid="form-preview-essential">
      <EssentialApplicationFields
        :options="essentialOptions"
        :modelValue="essentialPreviewData"
        prefix="form-preview"
        email="applicant@example.com"
        disabled
      />
      <div class="preview-custom-divider">Your questions</div>
    </div>

    <div v-if="!hasFields" class="preview-empty" data-testid="form-preview-empty">
      <p>Add fields to preview the application form.</p>
    </div>

    <form v-else class="preview-form" @submit.prevent>
      <div
        v-for="(field, fieldIdx) in sortedFields"
        :key="fieldIdx"
        class="preview-field"
        :data-testid="`form-preview-field-${field.key}`"
      >
        <label class="preview-label">
          {{ field.label }}
          <span v-if="field.required" class="preview-required">*</span>
        </label>

        <p v-if="field.helpText" class="preview-help">{{ field.helpText }}</p>

        <input
          v-if="field.type === 'text' || field.type === 'email'"
          class="preview-input"
          :type="field.type === 'email' ? 'email' : 'text'"
          :placeholder="`Enter ${field.label.toLowerCase()}`"
          disabled
        />

        <input
          v-else-if="field.type === 'number'"
          class="preview-input"
          type="number"
          :placeholder="`Enter ${field.label.toLowerCase()}`"
          disabled
        />

        <input v-else-if="field.type === 'date'" class="preview-input" type="date" disabled />

        <input
          v-else-if="field.type === 'checkbox'"
          class="preview-checkbox"
          type="checkbox"
          disabled
        />

        <select v-else-if="field.type === 'select'" class="preview-input" disabled>
          <option value="">-- Select --</option>
          <option v-for="(opt, optIdx) in field.options" :key="optIdx" :value="opt">
            {{ opt }}
          </option>
        </select>

        <div v-else-if="field.type === 'multi_select'" class="preview-multiselect">
          <label
            v-for="(opt, optIdx) in field.options"
            :key="optIdx"
            class="preview-checkbox-label"
          >
            <input type="checkbox" disabled />
            <span>{{ opt }}</span>
          </label>
        </div>

        <div v-else class="preview-unsupported">Unknown field type: {{ field.type }}</div>
      </div>
    </form>
  </div>
</template>

<style scoped>
.form-preview {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.preview-banner {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #fff3cd;
  border-radius: 4px;
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: #664d03;
}

.preview-badge {
  background: #ffc107;
  color: #000;
  border-radius: 3px;
  padding: 1px 6px;
  font-weight: bold;
  font-size: 10px;
}

.preview-essential {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.preview-custom-divider {
  font-family: 'Outfit Regular';
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--mm-grey, #999);
  border-bottom: 1px solid #e5e5e5;
  padding-bottom: 4px;
}

.preview-empty {
  text-align: center;
  padding: 40px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-grey, #999);
}

.preview-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.preview-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preview-label {
  font-family: 'Outfit Regular';
  font-size: 14px;
  font-weight: bold;
  color: var(--mm-black);
}

.preview-required {
  color: var(--mm-red, #cc0000);
}

.preview-help {
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: var(--mm-grey, #666);
  margin: 0;
}

.preview-input {
  height: 32px;
  padding: 4px 10px;
  font-family: 'Outfit Regular';
  font-size: 13px;
  border: 1px solid var(--mm-grey, #b0b0b0);
  border-radius: 5px;
  background: #f8f8f8;
}

.preview-checkbox {
  align-self: flex-start;
  width: 16px;
  height: 16px;
}

.preview-checkbox-label {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  font-family: 'Outfit Regular';
  font-size: 13px;
  color: var(--mm-black);
}

.preview-multiselect {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--mm-grey, #ddd);
  border-radius: 5px;
  background: #f8f8f8;
}

.preview-unsupported {
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: var(--mm-red, #cc0000);
  font-style: italic;
}
</style>
