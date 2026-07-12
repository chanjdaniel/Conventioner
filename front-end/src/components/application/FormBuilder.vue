<script setup lang="ts">
import { computed } from 'vue';
import draggable from 'vuedraggable';
import { type FormField, type ApplicationForm } from '@/assets/types/datatypes';
import FormFieldEditor from './FormFieldEditor.vue';
import IconAddRound from '@/components/icons/IconAddRound.vue';
import IconClickDrag from '@/components/icons/IconClickDrag.vue';

const props = withDefaults(
  defineProps<{
    applicationForm: ApplicationForm | null;
    /**
     * Whether the organizer has taken over each field's key, positionally aligned with the
     * form's fields. The parent owns it for the same reason it owns the form: this component
     * is torn down whenever the organizer switches tabs, and the flag cannot be rebuilt from
     * the field itself - an auto-derived key and a hand-typed one look identical once written.
     */
    keyTouched?: boolean[];
    readonly?: boolean;
  }>(),
  { readonly: false, keyTouched: () => [] },
);

const emit = defineEmits<{
  'update:applicationForm': [form: ApplicationForm];
  'update:keyTouched': [touched: boolean[]];
}>();

/**
 * The parent owns the form; this component holds no copy of it. `order` is normalised to
 * the array index on every write so it stays a stable, unique list key regardless of how
 * fields were added, removed, or dragged.
 */
const fields = computed<FormField[]>({
  get: () => props.applicationForm?.fields ?? [],
  set: (newFields) => {
    if (props.readonly) return;
    emit('update:applicationForm', {
      fields: newFields.map((f, i) => ({ ...f, order: i })),
      publishedAt: props.applicationForm?.publishedAt,
    });
  },
});

function addField() {
  if (props.readonly) return;
  const newField: FormField = {
    key: '',
    label: '',
    type: 'text',
    required: false,
    options: [],
    helpText: undefined,
    order: fields.value.length,
  };
  emit('update:keyTouched', [...props.keyTouched, false]);
  fields.value = [...fields.value, newField];
}

function removeField(index: number) {
  if (props.readonly) return;
  emit(
    'update:keyTouched',
    props.keyTouched.filter((_, i) => i !== index),
  );
  fields.value = fields.value.filter((_, i) => i !== index);
}

function updateField(index: number, field: FormField) {
  fields.value = fields.value.map((f, i) => (i === index ? field : f));
}

function updateKeyTouched(index: number, touched: boolean) {
  if (props.readonly) return;
  emit(
    'update:keyTouched',
    fields.value.map((_, i) => (i === index ? touched : (props.keyTouched[i] ?? false))),
  );
}

function onDragChange(event: { moved?: { oldIndex: number; newIndex: number } }) {
  if (!event.moved) return;
  const next = [...props.keyTouched];
  const [moved] = next.splice(event.moved.oldIndex, 1);
  next.splice(event.moved.newIndex, 0, moved ?? false);
  emit('update:keyTouched', next);
}

const fieldCount = computed(() => fields.value.length);
</script>

<template>
  <div class="form-builder" data-testid="form-builder">
    <div class="builder-header">
      <span class="field-count">
        {{ fieldCount }} field{{ fieldCount !== 1 ? 's' : '' }}
      </span>
      <button
        v-if="!readonly"
        class="add-field-btn"
        @click="addField"
        data-testid="form-builder-add-field-button"
      >
        <IconAddRound /> Add Field
      </button>
    </div>

    <div v-if="fields.length === 0" class="empty-state" data-testid="form-builder-empty">
      <p v-if="readonly">This market has no application form.</p>
      <p v-else>No fields yet. Click "Add Field" to start building your application form.</p>
    </div>

    <draggable
      v-else
      v-model="fields"
      item-key="order"
      handle=".drag-handle"
      ghost-class="drag-ghost"
      :disabled="readonly"
      @change="onDragChange"
      data-testid="form-builder-field-list"
    >
      <template #item="{ element, index }">
        <div class="field-item">
          <div v-if="!readonly" class="drag-handle" data-testid="form-builder-drag-handle">
            <IconClickDrag />
          </div>
          <div class="field-card">
            <div class="field-card-header">
              <span class="field-ordinal">{{ index + 1 }}.</span>
              <span class="field-label-preview">{{ element.label || '(untitled)' }}</span>
              <span class="field-type-badge">{{ element.type }}</span>
              <span v-if="element.required" class="required-badge">required</span>
              <button
                v-if="!readonly"
                class="remove-btn"
                @click="removeField(index)"
                data-testid="form-builder-remove-field-button"
              >
                Remove
              </button>
            </div>
            <FormFieldEditor
              :field="element"
              :index="index"
              :readonly="readonly"
              :keyTouched="keyTouched[index] ?? false"
              @update:field="(f: FormField) => updateField(index, f)"
              @update:keyTouched="(touched: boolean) => updateKeyTouched(index, touched)"
            />
          </div>
        </div>
      </template>
    </draggable>
  </div>
</template>

<style scoped>
.form-builder {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.builder-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

.field-count {
  font-family: 'Outfit Regular';
  font-size: 13px;
  color: var(--mm-grey, #666);
}

.add-field-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: 5px;
  padding: 6px 14px;
  cursor: pointer;
  font-family: 'Merge One';
  font-size: 14px;
}

.empty-state {
  text-align: center;
  padding: 40px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-grey, #999);
}

.field-item {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 8px;
}

.drag-handle {
  cursor: grab;
  padding: 10px 4px;
  color: var(--mm-grey, #999);
  display: flex;
  align-items: center;
}

.drag-handle:active {
  cursor: grabbing;
}

.field-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-card-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.field-ordinal {
  font-family: 'Outfit Regular';
  font-size: 13px;
  font-weight: bold;
  color: var(--mm-black);
}

.field-label-preview {
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-black);
  flex: 1;
}

.field-type-badge {
  font-family: 'Outfit Regular';
  font-size: 11px;
  background: #e8e8e8;
  color: #555;
  border-radius: 3px;
  padding: 1px 6px;
}

.required-badge {
  font-family: 'Outfit Regular';
  font-size: 11px;
  background: var(--mm-red, #cc0000);
  color: white;
  border-radius: 3px;
  padding: 1px 6px;
}

.remove-btn {
  background: none;
  border: 1px solid var(--mm-red, #cc0000);
  color: var(--mm-red, #cc0000);
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  font-family: 'Outfit Regular';
  font-size: 12px;
}

.remove-btn:hover {
  background: var(--mm-red, #cc0000);
  color: white;
}

.drag-ghost {
  opacity: 0.4;
}
</style>
