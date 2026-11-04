<script setup lang="ts">
import { computed } from 'vue';
import { type ExampleColumn, type FormField } from '@/assets/types/datatypes';
import IconAddRound from '@/components/icons/IconAddRound.vue';
import IconCloseRound from '@/components/icons/IconCloseRound.vue';
import SearchPicker, { type PickerGroup, type PickerOption } from '@/components/SearchPicker.vue';
import { FIELD_TYPES } from '@/utils/applicationForm';
import {
  answersToOffer,
  fileAnswers,
  fileOptions,
  optionsForType,
  sameOptions,
} from '@/utils/exampleColumns';

const props = withDefaults(
  defineProps<{
    field: FormField;
    index: number;
    readonly?: boolean;
    /** True once the organizer has typed in the key input. The parent owns it so it
     * survives the component instance being reused for another field. */
    keyTouched?: boolean;
    /**
     * False on a Google Form market (E33/F01/S02): nobody fills its form in, so a hint shown to
     * applicants would be shown to no one, and the editor offers none.
     */
    forApplicants?: boolean;
    /** The column of the example file this question was made from, on a market started from one
     *  (E38/F02/S02): a Select or Multi-Select takes its options from it. */
    column?: ExampleColumn | null;
  }>(),
  { readonly: false, keyTouched: false, forApplicants: true, column: null },
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

/** A new type fills a choice's options from the file, unless the organizer edited them. */
function changeType(type: string) {
  emitUpdate({ type, options: optionsForType(local.value, type, props.column) });
}

/** The file's reading for this question's type, when it came from a column that has one. */
const optionsFromFile = computed(() =>
  props.column ? fileOptions(props.column, local.value.type) : [],
);
const filledFromFile = computed(
  () => optionsFromFile.value.length > 0 && sameOptions(local.value.options, optionsFromFile.value),
);

function useFileOptions() {
  emitUpdate({ options: [...optionsFromFile.value] });
}

/**
 * Whether an option is a field with the file's answers under it. Asked of the file and not of what
 * remains to offer, so a field never changes control under the caret when the last answer is taken.
 */
const optionsOfferAnswers = computed(
  () => !props.readonly && !!props.column && fileAnswers(props.column, local.value.type).length > 0,
);

/** The one unnamed group an option's list holds: the answers no other option has. */
function answersGroups(at: number): PickerGroup[] {
  if (!props.column) return [];
  const answers = answersToOffer(props.column, local.value.type, local.value.options, at);
  return [{ options: answers.map((answer) => ({ value: answer, label: answer })) }];
}

function answerMatches(option: PickerOption, words: string): boolean {
  return option.label.toLowerCase().includes(words.toLowerCase());
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
    <!-- Each label names its control (bug 44): they were labels for nothing, so every field of
         every question was announced unnamed. `index` keeps the ids apart between questions. -->
    <div class="field-row">
      <label class="field-label" :for="`question-${index}-label`">Label</label>
      <input
        :id="`question-${index}-label`"
        class="field field-input"
        :value="local.label"
        @input="updateLabel(($event.target as HTMLInputElement).value)"
        :disabled="readonly"
        placeholder="e.g. Business Name"
        data-testid="form-field-label-input"
      />
    </div>

    <div class="field-row">
      <label class="field-label" :for="`question-${index}-key`">Key</label>
      <input
        :id="`question-${index}-key`"
        class="field field-input field-input-sm"
        :value="local.key"
        @input="updateKey(($event.target as HTMLInputElement).value)"
        @blur="keyBlurred()"
        :disabled="readonly"
        placeholder="auto-generated from label"
        data-testid="form-field-key-input"
      />
    </div>

    <div class="field-row">
      <label class="field-label" :for="`question-${index}-type`">Type</label>
      <select
        :id="`question-${index}-type`"
        class="field field--select field-input"
        :value="local.type"
        @change="changeType(($event.target as HTMLSelectElement).value)"
        :disabled="readonly"
        data-testid="form-field-type-select"
      >
        <option v-for="ft in FIELD_TYPES" :key="ft.value" :value="ft.value">
          {{ ft.label }}
        </option>
      </select>
    </div>

    <div class="field-row field-row-checkbox">
      <label class="field-label" :for="`question-${index}-required`">Required</label>
      <input
        :id="`question-${index}-required`"
        type="checkbox"
        :checked="local.required"
        @change="emitUpdate({ required: ($event.target as HTMLInputElement).checked })"
        :disabled="readonly"
        data-testid="form-field-required-checkbox"
      />
    </div>

    <div class="field-row" v-if="local.type === 'select' || local.type === 'multi_select'">
      <span :id="`question-${index}-options`" class="field-label">Options</span>
      <div class="options-list" role="group" :aria-labelledby="`question-${index}-options`">
        <div v-for="(opt, optIdx) in local.options" :key="optIdx" class="option-row">
          <SearchPicker
            v-if="optionsOfferAnswers"
            class="option-picker"
            :model-value="opt"
            :groups="answersGroups(optIdx)"
            :finds="answerMatches"
            :label="`Option ${optIdx + 1}`"
            :placeholder="`Option ${optIdx + 1}`"
            testid="form-field-option"
            none-word="Nothing"
            accepts-typed
            words-are-value
            @update:model-value="updateOption(optIdx, $event as string)"
          />
          <input
            v-else
            class="field field-input"
            :value="opt"
            @input="updateOption(optIdx, ($event.target as HTMLInputElement).value)"
            :disabled="readonly"
            :placeholder="`Option ${optIdx + 1}`"
            :aria-label="`Option ${optIdx + 1}`"
            data-testid="form-field-option-input"
          />
          <button
            v-if="!readonly"
            type="button"
            class="icon-button icon-remove"
            :aria-label="`Remove option ${optIdx + 1}`"
            @click="removeOption(optIdx)"
            data-testid="form-field-remove-option-button"
          >
            <IconCloseRound />
          </button>
        </div>
        <button
          v-if="!readonly"
          type="button"
          class="add-option-btn"
          @click="addOption"
          data-testid="form-field-add-option-button"
        >
          <IconAddRound /> Add option
        </button>
        <template v-if="!readonly">
          <p
            v-if="filledFromFile"
            class="options-from-file"
            data-testid="form-field-options-from-file"
          >
            Filled from the answers in your file.
          </p>
          <button
            v-else-if="optionsFromFile.length"
            type="button"
            class="btn btn--secondary btn--compact use-file-options"
            @click="useFileOptions"
            data-testid="form-field-use-file-options-button"
          >
            Use the answers in your file
          </button>
        </template>
      </div>
    </div>

    <div v-if="forApplicants" class="field-row">
      <label class="field-label" :for="`question-${index}-help`">Help text</label>
      <input
        :id="`question-${index}-help`"
        class="field field-input"
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
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: var(--mm-beige);
}

.field-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
}

.field-row-checkbox {
  gap: var(--space-1);
}

/*
 * The Options caption names a STACK, not one control, so it aligns to the first row rather than to
 * the stack's midpoint - which is where `align-items: center` would put it once a field has three
 * options.
 */
.field-row:has(.options-list) {
  align-items: flex-start;
}

/*
 * The caption sits on its control's centre line (E17/F03/S01).
 *
 * `.field-row` already declares `align-items: center`, so the label BOX and the control BOX were
 * already centred against each other - adding that again fixes nothing. The misalignment was
 * INSIDE the boxes: the caption had no line-height while the control has an explicit height and
 * padding, so two centred boxes still put their text on different lines.
 *
 * Giving the caption the control's own height and centring its text within it makes the two line
 * boxes the same, which is what actually aligns the glyphs - and it holds for the `<select>`, whose
 * internal centring follows its own rules rather than a text input's.
 *
 * `margin-bottom: 0` because this shares a class name with the primitive layer's `.field-label`,
 * which is a label sitting ABOVE its field and carries 4px beneath it. Here the caption sits BESIDE
 * the control, so that margin made the row 32px tall and centred the two against different boxes -
 * which is the whole of the 2px this rule exists to remove.
 */
.field-label {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 28px;
  margin-bottom: 0;

  font-size: var(--text-xs);
  line-height: normal;
  color: var(--mm-black);
  width: 65px;
  flex-shrink: 0;
  text-align: right;
}

/* The primitive, smaller: the editor's rows are a compact column, one 12px text inset down it. */
.field-input {
  flex: 1;
  height: 28px;
  font-size: var(--text-xs);
}

.field-input-sm {
  max-width: 200px;
  flex: 0 1 auto;
}

.options-list {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

/* A row's list opens in the page's flow under its field, so the row aligns to its top. */
.option-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: var(--space-1);
}

/* The row's field in the compact height and text of `.field-input`, which cannot reach a child.
   Its name is for a screen reader, as the plain input's is: `.visually-hidden` copied whole, since
   the picker draws its own label. */
.option-picker {
  flex: 1;
  min-width: 0;
}

.option-picker :deep(.field-label) {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.option-picker :deep(.field) {
  height: 28px;
  font-size: var(--text-xs);
}

.icon-button {
  background: none;
  border: none;
  cursor: pointer;
  padding: var(--space-hairline);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* As tall as the field, so its mark sits on the field's line with the row aligned to its top. */
.icon-remove {
  height: 28px;
  color: var(--mm-red);
}

/* The note says where the options came from, quietly: it is not a control. The editor is beige,
   where `--mm-text-muted` falls below AA. */
.options-from-file {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted-on-beige);
}

/* A button in a column of rows: as wide as its words, not the column. */
.use-file-options {
  align-self: flex-start;
}

.add-option-btn {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  background: none;
  border: 1px dashed var(--mm-border);
  border-radius: var(--radius-control);
  padding: var(--space-1) var(--space-2);
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--mm-black);
}
</style>
