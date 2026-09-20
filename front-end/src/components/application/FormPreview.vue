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
  background: rgba(228, 166, 41, 0.18);
  border-radius: var(--radius-control);
  font-size: var(--text-xs);
  color: var(--mm-text-yellow);
}

.preview-badge {
  background: var(--mm-yellow);
  color: black;
  border-radius: var(--radius-control);
  padding: 1px 6px;
  font-weight: 600;
  font-size: var(--text-xs);
}

.preview-essential {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.preview-custom-divider {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--mm-text-muted);
  border-bottom: 1px solid var(--mm-border);
  padding-bottom: 4px;
}

.preview-empty {
  text-align: center;
  padding: 40px;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
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
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
}

.preview-required {
  color: var(--mm-red);
}

.preview-help {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  margin: 0;
}

.preview-input {
  height: 32px;
  padding: 4px 10px;
  font-size: var(--text-xs);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: var(--mm-beige);
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
  font-size: var(--text-xs);
  color: var(--mm-black);
}

.preview-multiselect {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: var(--mm-beige);
}

.preview-unsupported {
  font-size: var(--text-xs);
  color: var(--mm-red);
  font-style: italic;
}
</style>
