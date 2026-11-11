<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import draggable from 'vuedraggable';
import { type ApplicationForm, type ExampleColumn, type FormField } from '@/assets/types/datatypes';
import { applicationFormRefusal } from '@/utils/applicationForm';
import { columnOf, columnsToAdd, questionFrom } from '@/utils/exampleColumns';
import ChoiceField from '@/components/ChoiceField.vue';
import type { PickerGroup } from '@/components/SearchPicker.vue';
import { asksForDiscord, discordUsernameQuestion } from '@/utils/discordQuestion';
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
    /** False on a Google Form market, whose form nobody fills in (E33/F01/S02). */
    forApplicants?: boolean;
    /** What the market's start from a Google Form's responses kept of its file (E38/F02/S02). */
    exampleColumns?: ExampleColumn[];
  }>(),
  { readonly: false, keyTouched: () => [], forApplicants: true, exampleColumns: () => [] },
);

const emit = defineEmits<{
  'update:applicationForm': [form: ApplicationForm];
  'update:keyTouched': [touched: boolean[]];
}>();

/**
 * The parent owns the form; this component holds no copy of it. `order` is normalised to the
 * array index on every write, so the saved form numbers its questions as they stand.
 */
const fields = computed<FormField[]>({
  get: () => props.applicationForm?.fields ?? [],
  set: (newFields) => {
    if (props.readonly) return;
    // The rest of the form rides along untouched. Rebuilding it from the fields alone dropped
    // `unaskedEssentials`, so the next save asked a switched-off Section preference again
    // (E26/F03/S01, bug 29).
    emit('update:applicationForm', {
      ...props.applicationForm,
      fields: newFields.map((f, i) => ({ ...f, order: i })),
    });
  },
});

/**
 * Each question's list key: an id of this component's own, held beside the questions in their
 * order and never written to the form. Keyed by `order`, a question's editor, and the fold of its
 * options with it, stayed at its place when a question above it was removed or dragged, and so
 * passed to its neighbour.
 *
 * Adding, removing and dragging a question move the ids with the questions. A form whose count
 * changes any other way, read again from the server, takes new ones. A save hands back the same
 * questions in the same order, so it keeps them, and every fold with them.
 */
let lastId = 0;
const ids = ref<number[]>([]);
const newId = () => ++lastId;
watch(
  () => fields.value.length,
  (count) => {
    if (ids.value.length !== count) ids.value = Array.from({ length: count }, newId);
  },
  { immediate: true },
);
function questionId(field: FormField): number | string {
  const at = fields.value.indexOf(field);
  return ids.value[at] ?? `at-${at}`;
}

/**
 * What Save refuses, when it is a blank option: that question's options unfold, or the row it
 * means could stand behind the fold, where nobody sees it.
 */
const blankOption = computed(() =>
  props.readonly ? null : (applicationFormRefusal(props.applicationForm)?.blankOption ?? null),
);

function blankOptionOf(index: number): number | null {
  return blankOption.value?.field === index ? blankOption.value.option : null;
}

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
  ids.value = [...ids.value, newId()];
  fields.value = [...fields.value, newField];
}

/**
 * A ready-made question for each vendor's Discord username (E46/F01/S02): optional, since not every
 * market uses Discord, and labelled so the Discord card picks it up on connecting, as it does any
 * text question labelled for Discord. Not offered once the form has one.
 */
const discordOffered = computed(() => !fields.value.some(asksForDiscord));

function addDiscordUsername() {
  if (props.readonly || !discordOffered.value) return;
  emit('update:keyTouched', [...props.keyTouched, false]);
  ids.value = [...ids.value, newId()];
  fields.value = [...fields.value, discordUsernameQuestion(fields.value)];
}

/** The columns of the file no question is made from yet, for "Add from your file". */
const columnsOffered = computed(() => columnsToAdd(props.exampleColumns, fields.value));
const columnGroups = computed<PickerGroup[]>(() => [
  { options: columnsOffered.value.map((column) => ({ value: column.key, label: column.label })) },
]);

/**
 * A question made from a column of the file, its key held as the organizer's own: it is the key
 * the saved import mapping names the column under, so relabelling the question must not move it.
 */
function addFromFile(key: string) {
  const column = columnsOffered.value.find((c) => c.key === key);
  if (props.readonly || !column) return;
  emit('update:keyTouched', [...props.keyTouched, true]);
  ids.value = [...ids.value, newId()];
  fields.value = [...fields.value, questionFrom(column, fields.value.length)];
}

function removeField(index: number) {
  if (props.readonly) return;
  emit(
    'update:keyTouched',
    props.keyTouched.filter((_, i) => i !== index),
  );
  ids.value = ids.value.filter((_, i) => i !== index);
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
  const { oldIndex, newIndex } = event.moved;
  const next = [...props.keyTouched];
  const [moved] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, moved ?? false);
  emit('update:keyTouched', next);
  const nextIds = [...ids.value];
  const [movedId] = nextIds.splice(oldIndex, 1);
  nextIds.splice(newIndex, 0, movedId ?? newId());
  ids.value = nextIds;
}

const fieldCount = computed(() => fields.value.length);
</script>

<template>
  <div class="form-builder" data-testid="form-builder">
    <div class="builder-header">
      <span class="field-count"> {{ fieldCount }} field{{ fieldCount !== 1 ? 's' : '' }} </span>
      <div v-if="!readonly" class="builder-actions">
        <div v-if="columnsOffered.length" class="add-from-file">
          <span class="add-from-file__label" aria-hidden="true">Add from your file</span>
          <!-- Counts every column the file offered, so it stays one control as they are added. -->
          <ChoiceField
            class="add-from-file__choice"
            model-value=""
            :groups="columnGroups"
            label="Add from your file"
            hide-label
            placeholder="Choose a column"
            testid="form-builder-add-from-file"
            :whole-count="exampleColumns?.length"
            adds
            @update:model-value="addFromFile"
          />
        </div>
        <button
          v-if="discordOffered"
          type="button"
          class="btn btn--secondary"
          data-testid="form-builder-add-discord-button"
          @click="addDiscordUsername"
        >
          Add Discord username
        </button>
        <button class="add-field-btn" @click="addField" data-testid="form-builder-add-field-button">
          <IconAddRound /> Add field
        </button>
      </div>
    </div>

    <div v-if="fields.length === 0" class="empty-state" data-testid="form-builder-empty">
      <p v-if="readonly">This market has no questions of its own.</p>
      <p v-else>No questions of your own yet. Add field adds one.</p>
    </div>

    <draggable
      v-else
      v-model="fields"
      :item-key="questionId"
      handle=".drag-handle"
      ghost-class="drag-ghost"
      :disabled="readonly"
      @change="onDragChange"
      data-testid="form-builder-field-list"
    >
      <template #item="{ element, index }">
        <div class="field-item">
          <div v-if="!readonly" class="drag-handle" data-testid="form-builder-drag-handle">
            <IconClickDrag class="drag-handle__icon" />
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
              :forApplicants="forApplicants"
              :keyTouched="keyTouched[index] ?? false"
              :column="columnOf(element, exampleColumns)"
              :blankOption="blankOptionOf(index)"
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
  gap: var(--space-3);
}

.builder-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
}

/* Wraps rather than squeezing the select to nothing when the row runs short of room. */
.builder-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}

.add-from-file {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.add-from-file__label {
  font-size: var(--text-sm);
  color: var(--mm-black);
  white-space: nowrap;
}

.add-from-file__choice {
  width: 16rem;
}

.field-count {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

/* The control height, so it stands level with the "Add from your file" select beside it. */
.add-field-btn {
  --focus-border: var(--focus-border-on-fill);
  display: flex;
  align-items: center;
  min-height: var(--control-height);
  gap: var(--space-1);
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: var(--radius-control);
  padding: var(--space-1) var(--space-4);
  cursor: pointer;
  font-family: 'Merge One';
  font-size: var(--text-sm);
}

.empty-state {
  text-align: center;
  padding: var(--space-12);
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

/*
 * Space between two fields must clearly exceed space within one (E17/F03/S01).
 *
 * It was 8px between and 6px inside, so a row of one field and the start of the next were the same
 * distance apart and proximity gave the eye nothing to group on.
 */
.field-item {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: var(--space-2);
  margin-bottom: var(--space-6);
}

/* Appearance, colour, hover and hit area come from `.drag-handle` in primitives.css. Only the
   stretch to the field's height is this list's own. */
.drag-handle {
  align-self: stretch;
}

/*
 * A bounded card, which is what the essential-questions panel beside it already does for each of
 * its questions. This declared no border, background, padding or radius - so the two halves of one
 * screen disagreed about whether a form field is a card.
 */
.field-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);

  padding: var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
}

.field-card-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
}

.field-ordinal {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-black);
}

.field-label-preview {
  font-size: var(--text-sm);
  color: var(--mm-black);
  flex: 1;
}

/*
 * `--mm-border` is exempt from the token contrast test because it "never carries text" - and here
 * it carried text, at 3.73:1. The neutral chip tone is the product's answer for a quiet label.
 */
.field-type-badge {
  font-size: var(--text-xs);
  background: var(--mm-beige);
  color: var(--mm-black);
  border-radius: var(--radius-control);
  padding: var(--space-hairline) var(--space-2);
}

.required-badge {
  font-size: var(--text-xs);
  background: var(--mm-red);
  color: white;
  border-radius: var(--radius-control);
  padding: var(--space-hairline) var(--space-2);
}

.remove-btn {
  background: none;
  border: 1px solid var(--mm-red);
  color: var(--mm-red);
  border-radius: var(--radius-control);
  padding: var(--space-hairline) var(--space-2);
  cursor: pointer;
  font-size: var(--text-xs);
}

.remove-btn:hover {
  background: var(--mm-red);
  color: white;
}

.drag-ghost {
  opacity: 0.4;
}
</style>
