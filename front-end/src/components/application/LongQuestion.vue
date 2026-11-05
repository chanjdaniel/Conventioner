<script lang="ts">
import type { FormField } from '@/assets/types/datatypes';
import { COMBOBOX_PAST } from '@/components/ChoiceField.vue';

/** Whether a question of choices is a field to type in, by the options it offers. */
export const isLongQuestion = (field: FormField) =>
  (field.type === 'select' || field.type === 'multi_select') &&
  field.options.length > COMBOBOX_PAST;
</script>

<script setup lang="ts">
/**
 * A question of more than 12 options on the application form (T223): a capped `SearchPicker`, one
 * choice or several as chips, so an applicant on a phone never scrolls 60 checkboxes. One component,
 * so the applicant's form and the organizer's preview of it, which draws its own markup for every
 * other type, cannot come to show different things.
 *
 * - The screen draws the question's words where every question has them and gives this no label of
 *   its own to show: it joins the screen's words, required mark and all, as the field's name, so a
 *   reader hears the same name a select has. The screen's words must then be hidden from a reader,
 *   and tied to no control, or the question is heard twice.
 * - Never `holdsChoice`: a form acts on Submit, so the first word lets the choice go, and words not
 *   chosen clear on leaving the field.
 * - An answer no option offers is a chip among several. On one choice the field is empty, as a
 *   select shows such an answer, and the form's own required check counts it as no answer
 *   (`formValidationErrors`).
 * - `previewing` shows it as an applicant will get it: nothing may be typed there, and it still reads
 *   as the field they will type in. Otherwise a disabled field has nothing to find, so it says so.
 */
import { computed } from 'vue';
import { COMBOBOX_CAP, labelHolds } from '@/components/ChoiceField.vue';
import SearchPicker, { type PickerGroup } from '@/components/SearchPicker.vue';

const props = defineProps<{
  field: FormField;
  /** The question's answer as stored. */
  modelValue: unknown;
  testid: string;
  fieldId: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  previewing?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string | string[]] }>();

const name = computed(() => (props.field.required ? `${props.field.label} *` : props.field.label));
const groups = computed<PickerGroup[]>(() => [
  { options: props.field.options.map((option) => ({ value: option, label: option })) },
]);
const several = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []));
const one = computed(() => (props.modelValue as string | null | undefined) ?? '');
const answered = computed(() =>
  props.field.type === 'multi_select' ? several.value.length > 0 : Boolean(one.value),
);
const placeholder = computed(() => {
  if (!props.disabled || props.previewing) return 'Find an answer';
  return answered.value ? undefined : 'No answer chosen';
});
/** All a question of one choice and one of several have alike. */
const common = computed(() => ({
  groups: groups.value,
  finds: labelHolds,
  cap: COMBOBOX_CAP,
  label: name.value,
  placeholder: placeholder.value,
  testid: props.testid,
  fieldId: props.fieldId,
  disabled: props.disabled,
  invalid: props.invalid,
  describedBy: props.describedBy,
  hideLabel: true,
  noneWord: 'Nothing',
}));
</script>

<template>
  <SearchPicker
    v-if="field.type === 'multi_select'"
    v-bind="common"
    multiple
    :model-value="several"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <SearchPicker
    v-else
    v-bind="common"
    :model-value="one"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
