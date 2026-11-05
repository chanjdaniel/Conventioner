<script lang="ts">
import { LIST_FIND_FROM } from '@/components/ListFrame.vue';
import type { PickerOption } from '@/components/SearchPicker.vue';

/**
 * A set of choices is a field to type in once it is longer than this, and a list has its find field
 * from the same length: one number, so the app grows one way. A place that draws its own small form
 * compares against this too.
 */
export const COMBOBOX_PAST = LIST_FIND_FROM;

/** What a field draws at most of what the words find; a form of its own past 12 draws the same. */
export const COMBOBOX_CAP = 50;

/** The find of a choice with no terms of its own: the label holds the words, capitals aside. */
export const labelHolds = (option: PickerOption, words: string) =>
  option.label.toLowerCase().includes(words.toLowerCase());
</script>

<script setup lang="ts">
/**
 * One choice from a set that can grow (T223): a native select at 12 choices or fewer, a capped
 * `SearchPicker` past that, the same to its screen either way, so no screen writes the threshold,
 * the cap, the default find or the two markups.
 *
 * - It counts the whole set, `wholeCount` where a screen gives it, else the options drawn, so a
 *   set that shrinks as it is used never turns into the other control under the caret.
 * - At 12 or fewer the select itself carries `testid` and `name`, every group with a label is an
 *   `optgroup`, and `placeholder` is its empty row, with no empty row without one.
 * - Past 12 the field's root carries `testid`, it draws 50 of what the words find, its list lies over
 *   what follows and moves no row, at least 22rem wide with its right edge on the field's, so a long
 *   answer reads on a line or two in a narrow column; a group the words empty is not drawn, so what
 *   they find leads the list, and words that find nothing say "Nothing" once.
 * - An option that is `disabled` may not be taken either way, its `detail` saying why: a row of the
 *   list muted, words still finding it, or an `option` that is `disabled`, its detail on its line.
 * - It never takes typed words: words not chosen clear on leaving the field. A free-text field is
 *   `SearchPicker` itself, as a screen with a need this does not name uses it directly.
 * - `writes` says the choice is acted on as it is taken, `SearchPicker`'s `holdsChoice`: typing
 *   writes nothing, and only another choice replaces this one. Without it, as on a form that acts on
 *   Save, the first word lets the choice go.
 * - `noneRow` is a choice that may go back to none: past 12, while one holds, these words are the
 *   list's first row, whose value is `''`, as the select's empty row is at 12 or fewer. It counts
 *   toward neither the threshold nor `wholeCount`.
 * - `listInFlow` draws a field's list in the page's flow instead of over what follows, for a host
 *   that scrolls or clips, where a list lying over would be cut off.
 * - `adds` says each choice is added elsewhere, as a ranked list's next answer: the value stays `''`,
 *   the select goes back to its empty row, and the field empties with the focus still in it, ready
 *   for the next. Such a set shrinks as it is used, so the screen gives `wholeCount`.
 * - `fieldId` is the control's id, the select's or the field's, so a link elsewhere on the screen
 *   names it whichever it is.
 * - `open()` opens the list from a link elsewhere on the screen, and answers false where nothing
 *   opened: a select on a browser with no `showPicker` (Safari), or one that refused it, has only
 *   its focus, so the screen can respond.
 * - `showHeld()` shows what `modelValue` holds again, for a screen whose server refused the choice
 *   just taken, which `modelValue` never became.
 */
import { computed, ref, useId } from 'vue';
import SearchPicker, { type PickerGroup } from '@/components/SearchPicker.vue';

const props = defineProps<{
  modelValue: string;
  /** `SearchPicker`'s; a group with a label is an `optgroup` in the select. */
  groups: PickerGroup[];
  label: string;
  /** The select's own, or the picker's root. */
  testid: string;
  /** The native select's `name`. */
  name?: string;
  /** The screen's row says it: the label stays for a reader. */
  hideLabel?: boolean;
  /** The select's empty row, the field's placeholder. */
  placeholder?: string;
  /** Past 12 counts this, else the options drawn. */
  wholeCount?: number;
  /** Whether the words find this choice; by default the label holds them, capitals aside. */
  finds?: (option: PickerOption, words: string) => boolean;
  /** The choice is acted on as it is taken. */
  writes?: boolean;
  /** Each choice is added elsewhere: the control empties after it. */
  adds?: boolean;
  disabled?: boolean;
  describedBy?: string;
  /** The control's id, the select's or the field's, for a link elsewhere on the screen to name. */
  fieldId?: string;
  /** Past 12, while a choice holds, the words of a first row that lets it go. */
  noneRow?: string;
  /** Past 12, the list pushes what follows down rather than lying over it. */
  listInFlow?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const isField = computed(
  () =>
    (props.wholeCount ?? props.groups.reduce((count, group) => count + group.options.length, 0)) >
    COMBOBOX_PAST,
);

/** The field's rows: the way back to none first, so the cap never hides it. */
const fieldGroups = computed<PickerGroup[]>(() =>
  props.noneRow && props.modelValue
    ? [{ options: [{ value: '', label: props.noneRow }] }, ...props.groups]
    : props.groups,
);

/** A select's row has one line, so its detail stands on it. */
const rowWords = (option: PickerOption) =>
  option.detail ? `${option.label} - ${option.detail}` : option.label;

const generatedId = useId();
const selectId = computed(() => props.fieldId ?? generatedId);
const select = ref<HTMLSelectElement | null>(null);

function selected(event: Event): void {
  const element = event.target as HTMLSelectElement;
  emit('update:modelValue', element.value);
  if (props.adds) element.value = '';
}
const picker = ref<InstanceType<typeof SearchPicker> | null>(null);

function open(): boolean {
  if (picker.value) return picker.value.show();
  const element = select.value;
  element?.focus();
  try {
    if (!element?.showPicker) return false;
    element.showPicker();
    return true;
  } catch {
    // Refused somewhere: the list stays shut, as where the method is missing.
    return false;
  }
}

function showHeld(): void {
  picker.value?.showChoice();
  if (select.value) select.value.value = props.modelValue;
}

defineExpose({ open, showHeld });
</script>

<template>
  <SearchPicker
    v-if="isField"
    ref="picker"
    class="choice-field-picker"
    :model-value="modelValue"
    :groups="fieldGroups"
    :finds="finds ?? labelHolds"
    :label="label"
    :placeholder="placeholder"
    :testid="testid"
    :cap="COMBOBOX_CAP"
    :hide-label="hideLabel"
    :holds-choice="writes"
    :clears-on-choice="adds"
    :disabled="disabled"
    :described-by="describedBy"
    :field-id="fieldId"
    :list-over="!listInFlow"
    none-word="Nothing"
    hides-emptied-groups
    @update:model-value="emit('update:modelValue', $event as string)"
  />
  <div v-else>
    <label :for="selectId" :class="hideLabel ? 'visually-hidden' : 'field-label'">{{
      label
    }}</label>
    <select
      :id="selectId"
      ref="select"
      class="field field--select"
      :value="modelValue"
      :name="name"
      :disabled="disabled"
      :aria-describedby="describedBy"
      :data-testid="testid"
      @change="selected"
    >
      <option v-if="placeholder !== undefined" value="">{{ placeholder }}</option>
      <template v-for="(group, at) in groups" :key="group.label ?? at">
        <optgroup v-if="group.label && group.options.length" :label="group.label">
          <option
            v-for="option in group.options"
            :key="option.value"
            :value="option.value"
            :disabled="option.disabled"
          >
            {{ rowWords(option) }}
          </option>
        </optgroup>
        <template v-else-if="!group.label">
          <option
            v-for="option in group.options"
            :key="option.value"
            :value="option.value"
            :disabled="option.disabled"
          >
            {{ rowWords(option) }}
          </option>
        </template>
      </template>
    </select>
  </div>
</template>

<style scoped>
/*
 * A narrow column still reads a long answer on a line or two: the list runs left from the field's
 * right edge. On a window too narrow for that it stops short of the window's far side. Two classes on
 * the root, so it out-ranks the picker's own `left: 0` whichever stylesheet loads first.
 */
.choice-field-picker.search-picker--list-over :deep(.search-picker-list) {
  left: auto;
  width: max(100%, min(22rem, calc(100vw - var(--space-8) - var(--space-8))));
}
</style>
