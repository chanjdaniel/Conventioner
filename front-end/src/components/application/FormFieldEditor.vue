<script setup lang="ts">
import { computed } from 'vue';
import { type FormField } from '@/assets/types/datatypes';
import IconAddRound from '@/components/icons/IconAddRound.vue';
import IconCloseRound from '@/components/icons/IconCloseRound.vue';

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'multi_select', label: 'Multi-Select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'email', label: 'Email' },
];

const props = withDefaults(
  defineProps<{
    field: FormField;
    index: number;
    readonly?: boolean;
    /** True once the organizer has typed in the key input. The parent owns it so it
     * survives the component instance being reused for another field. */
    keyTouched?: boolean;
  }>(),
  { readonly: false, keyTouched: false },
);

const emit = defineEmits<{
  'update:field': [field: FormField];
  'update:keyTouched': [touched: boolean];
}>();

const local = computed(() => props.field);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function emitUpdate(patch: Partial<FormField>) {
  if (props.readonly) return;
  emit('update:field', { ...local.value, ...patch });
}

/** The key tracks the label until the organizer takes it over, so fixing a typo in the
 * label fixes the key too. */
function updateLabel(label: string) {
  emitUpdate(props.keyTouched ? { label } : { label, key: slugify(label) });
}

/** Clearing the key hands it back to the label, which is what its placeholder promises. */
function updateKey(key: string) {
  if (props.readonly) return;
  emit('update:keyTouched', Boolean(key));
  emitUpdate({ key });
}

/** Re-derive on the way out rather than on every keystroke, so a cleared key can be retyped
 * from empty without the derived one reappearing under the caret. */
function keyBlurred() {
  if (props.readonly || local.value.key) return;
  emitUpdate({ key: slugify(local.value.label) });
}

function addOption() {
  emitUpdate({ options: [...local.value.options, ''] });
}

function removeOption(idx: number) {
  const opts = [...local.value.options];
  opts.splice(idx, 1);
  emitUpdate({ options: opts });
}

function updateOption(idx: number, value: string) {
  const opts = [...local.value.options];
  opts[idx] = value;
  emitUpdate({ options: opts });
}
</script>

<template>
  <div class="field-editor">
    <div class="field-row">
      <label class="field-label">Label</label>
      <input
        class="field-input"
        :value="local.label"
        @input="updateLabel(($event.target as HTMLInputElement).value)"
        :disabled="readonly"
        placeholder="e.g. Business Name"
        data-testid="form-field-label-input"
      />
    </div>

    <div class="field-row">
      <label class="field-label">Key</label>
      <input
        class="field-input field-input-sm"
        :value="local.key"
        @input="updateKey(($event.target as HTMLInputElement).value)"
        @blur="keyBlurred()"
        :disabled="readonly"
        placeholder="auto-generated from label"
        data-testid="form-field-key-input"
      />
    </div>

    <div class="field-row">
      <label class="field-label">Type</label>
      <select
        class="field-input"
        :value="local.type"
        @change="emitUpdate({ type: ($event.target as HTMLSelectElement).value })"
        :disabled="readonly"
        data-testid="form-field-type-select"
      >
        <option v-for="ft in FIELD_TYPES" :key="ft.value" :value="ft.value">
          {{ ft.label }}
        </option>
      </select>
    </div>

    <div class="field-row field-row-checkbox">
      <label class="field-label">Required</label>
      <input
        type="checkbox"
        :checked="local.required"
        @change="emitUpdate({ required: ($event.target as HTMLInputElement).checked })"
        :disabled="readonly"
        data-testid="form-field-required-checkbox"
      />
    </div>

    <div class="field-row" v-if="local.type === 'select' || local.type === 'multi_select'">
      <label class="field-label">Options</label>
      <div class="options-list">
        <div v-for="(opt, optIdx) in local.options" :key="optIdx" class="option-row">
          <input
            class="field-input"
            :value="opt"
            @input="updateOption(optIdx, ($event.target as HTMLInputElement).value)"
            :disabled="readonly"
            :placeholder="`Option ${optIdx + 1}`"
            data-testid="form-field-option-input"
          />
          <button
            v-if="!readonly"
            class="icon-button icon-remove"
            @click="removeOption(optIdx)"
            data-testid="form-field-remove-option-button"
          >
            <IconCloseRound />
          </button>
        </div>
        <button
          v-if="!readonly"
          class="add-option-btn"
          @click="addOption"
          data-testid="form-field-add-option-button"
        >
          <IconAddRound /> Add option
        </button>
      </div>
    </div>

    <div class="field-row">
      <label class="field-label">Help Text</label>
      <input
        class="field-input"
        :value="local.helpText || ''"
        @input="emitUpdate({ helpText: ($event.target as HTMLInputElement).value || undefined })"
        :disabled="readonly"
        placeholder="Optional hint shown to applicants"
        data-testid="form-field-help-input"
      />
    </div>
  </div>
</template>

<style scoped>
.field-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--mm-grey, #ddd);
  border-radius: 6px;
  background: #fafafa;
}

.field-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.field-row-checkbox {
  gap: 4px;
}

.field-label {
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: var(--mm-black);
  width: 65px;
  flex-shrink: 0;
  text-align: right;
}

.field-input {
  flex: 1;
  height: 28px;
  padding: 2px 8px;
  font-family: 'Outfit Regular';
  font-size: 13px;
  border: 1px solid var(--mm-grey, #b0b0b0);
  border-radius: 4px;
}

.field-input:disabled,
.field-input[disabled] {
  background: #f0f0f0;
  color: var(--mm-grey, #666);
  cursor: not-allowed;
}

.field-input-sm {
  max-width: 200px;
  flex: 0 1 auto;
}

.options-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.option-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 4px;
}

.icon-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-remove {
  color: var(--mm-red, #cc0000);
}

.add-option-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px dashed var(--mm-grey, #b0b0b0);
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: var(--mm-black);
}
</style>
