<script setup lang="ts">
/**
 * A choice among many, found by typing (E38/F08/S03): a field that narrows a grouped list as it
 * is typed in, a combobox in the WAI-ARIA sense.
 *
 * The placement dialog's vendor pickers were native selects of every vendor seated that day, about
 * sixty on a real market, scrolled through for the one wanted. The app owns its components
 * (ADR 0015), and had no searchable picker, so this is one primitive rather than a select per use.
 *
 * - Named by its own label, and worked from the keyboard alone: the arrow keys move through the
 *   list, Enter takes the active choice, Escape closes the list. While the list is closed, Enter
 *   and Escape belong to the dialog around it, so Enter still submits and Escape still closes.
 * - A group is never hidden by a search, only narrowed: one with nothing matching says so. A group
 *   with no choices at all is not drawn, as an empty `optgroup` was not.
 * - What the words find is the caller's (`finds`), so every use searches by its own terms.
 * - The list opens in the page's flow, under the field, rather than over what follows: inside a
 *   dialog a floating list is clipped by the dialog's own scroller.
 * - The field shows no focus ring (E38/F01): its caret is its focus. The active choice is drawn
 *   as a tint, since it is never focused itself (`aria-activedescendant`).
 */
import { computed, nextTick, ref, useId, watch } from 'vue';

export interface PickerOption {
  value: string;
  /** What the choice is called, in the list and in the field once it is chosen. */
  label: string;
  /** A second line of words beside the label, such as where a vendor sits. */
  detail?: string;
}

export interface PickerGroup {
  /** The group's heading; a picker with one unnamed group draws none. */
  label?: string;
  testid?: string;
  options: PickerOption[];
}

const props = defineProps<{
  modelValue: string;
  groups: PickerGroup[];
  /** Whether the words typed find this choice. */
  finds: (option: PickerOption, words: string) => boolean;
  label: string;
  placeholder?: string;
  testid: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const id = useId();
const inputId = `${id}-input`;
const listId = `${id}-list`;
const optionId = (index: number) => `${id}-option-${index}`;

const allOptions = computed(() => props.groups.flatMap((group) => group.options));
const chosenOption = computed(() =>
  allOptions.value.find((option) => option.value === props.modelValue),
);

/** What the field holds: the words typed, or the chosen choice's label. */
const text = ref('');
/** Whether the field holds words to search by, rather than the choice made. */
const searching = ref(false);
const open = ref(false);
const active = ref(-1);

watch(
  () => props.modelValue,
  () => {
    if (searching.value && !props.modelValue) return;
    text.value = chosenOption.value?.label ?? '';
    searching.value = false;
  },
  { immediate: true },
);

const words = computed(() => (searching.value ? text.value.trim() : ''));

/** Every group that has choices, each narrowed to what the words find. */
const shownGroups = computed(() =>
  props.groups
    .filter((group) => group.options.length > 0)
    .map((group) => ({
      ...group,
      shown: words.value
        ? group.options.filter((option) => props.finds(option, words.value))
        : group.options,
    })),
);
const shownOptions = computed(() => shownGroups.value.flatMap((group) => group.shown));
/** Where each group's choices start in the one list the keys move through. */
const groupStarts = computed(() => {
  let at = 0;
  return shownGroups.value.map((group) => {
    const start = at;
    at += group.shown.length;
    return start;
  });
});

const activeId = computed(() =>
  open.value && active.value >= 0 ? optionId(active.value) : undefined,
);

const list = ref<HTMLElement | null>(null);
watch(active, async (index) => {
  await nextTick();
  const option = list.value?.querySelector<HTMLElement>(`#${CSS.escape(optionId(index))}`);
  option?.scrollIntoView?.({ block: 'nearest' });
});

function show(): void {
  if (open.value) return;
  open.value = true;
  const chosenAt = shownOptions.value.findIndex((option) => option.value === props.modelValue);
  active.value = chosenAt >= 0 ? chosenAt : shownOptions.value.length ? 0 : -1;
}

function choose(option: PickerOption): void {
  searching.value = false;
  text.value = option.label;
  open.value = false;
  active.value = -1;
  emit('update:modelValue', option.value);
}

function typed(): void {
  searching.value = true;
  open.value = true;
  active.value = shownOptions.value.length ? 0 : -1;
  // Words that no longer name the choice let it go, so a dialog never acts on a choice its field
  // does not show.
  if (props.modelValue) emit('update:modelValue', '');
}

function onKeydown(event: KeyboardEvent): void {
  const last = shownOptions.value.length - 1;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      if (!open.value) show();
      else active.value = Math.min(active.value + 1, last);
      return;
    case 'ArrowUp':
      event.preventDefault();
      if (!open.value) show();
      else active.value = Math.max(active.value - 1, Math.min(0, last));
      return;
    case 'Enter': {
      if (!open.value) return;
      // The list is open, so Enter is the list's: it chooses, and never submits the dialog.
      event.preventDefault();
      const option = shownOptions.value[active.value];
      if (option) choose(option);
      else open.value = false;
      return;
    }
    case 'Escape':
      // The dialog around the picker takes Escape on `window`, so the key is stopped at the field
      // while the list is open, and goes on to the dialog once it is closed.
      if (!open.value) return;
      event.preventDefault();
      event.stopPropagation();
      open.value = false;
      return;
  }
}

function onBlur(): void {
  open.value = false;
}
</script>

<template>
  <div class="search-picker" :data-testid="testid">
    <label class="field-label" :for="inputId">{{ label }}</label>
    <input
      :id="inputId"
      v-model="text"
      type="text"
      role="combobox"
      class="field search-picker-field"
      autocomplete="off"
      spellcheck="false"
      aria-autocomplete="list"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="listId"
      :aria-activedescendant="activeId"
      :placeholder="placeholder"
      :data-testid="`${testid}-input`"
      @input="typed"
      @click="show"
      @keydown="onKeydown"
      @blur="onBlur"
    />
    <!-- `mousedown.prevent` keeps the field focused while a choice is clicked, so the list is
         not closed by the field's blur before the click lands. -->
    <div
      v-if="open"
      :id="listId"
      ref="list"
      role="listbox"
      class="search-picker-list"
      :aria-label="label"
      :data-testid="`${testid}-list`"
      @mousedown.prevent
    >
      <div
        v-for="(group, g) in shownGroups"
        :key="group.label ?? g"
        role="group"
        :aria-labelledby="group.label ? `${id}-group-${g}` : undefined"
        class="search-picker-group"
        :data-testid="group.testid"
      >
        <div v-if="group.label" :id="`${id}-group-${g}`" class="search-picker-group-label">
          {{ group.label }}
        </div>
        <div
          v-for="(option, o) in group.shown"
          :id="optionId(groupStarts[g]! + o)"
          :key="option.value"
          role="option"
          class="search-picker-option"
          :class="{ 'search-picker-option--active': active === groupStarts[g]! + o }"
          :aria-selected="option.value === modelValue ? 'true' : 'false'"
          :data-value="option.value"
          :data-testid="`${testid}-option`"
          @click="choose(option)"
          @mousemove="active = groupStarts[g]! + o"
        >
          <span class="search-picker-option-label">{{ option.label }}</span>
          <span v-if="option.detail" class="search-picker-option-detail">{{ option.detail }}</span>
        </div>
        <p v-if="!group.shown.length && shownGroups.length > 1" class="search-picker-none">
          None match "{{ words }}".
        </p>
      </div>
      <p
        v-if="!shownOptions.length && shownGroups.length <= 1"
        class="search-picker-none"
        :data-testid="`${testid}-none`"
      >
        Nobody matches "{{ words }}".
      </p>
    </div>
  </div>
</template>

<style scoped>
.search-picker {
  display: flex;
  flex-direction: column;
}

/* Its caret is its focus (E38/F01): no ring, glow, or border change, by click or by Tab. */
.search-picker-field:focus,
.search-picker-field:focus-visible {
  outline: none;
}

.search-picker-list {
  display: flex;
  flex-direction: column;
  max-height: 240px;
  margin-top: var(--space-1);
  padding: var(--space-1) 0;
  overflow-y: auto;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
}

.search-picker-group-label {
  padding: var(--space-2) var(--space-3) var(--space-1);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-text-muted);
}

.search-picker-option {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0 var(--space-3);
  min-height: var(--target-min);
  padding: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
}

.search-picker-option--active {
  background: var(--mm-beige);
}

.search-picker-option[aria-selected='true'] .search-picker-option-label {
  font-weight: 600;
}

.search-picker-option-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.search-picker-option-detail {
  font-size: var(--text-xs);
  /* Read on the active choice's beige too, where the plain muted ink falls below AA. */
  color: var(--mm-text-muted-on-beige);
}

.search-picker-none {
  margin: 0;
  padding: var(--space-1) var(--space-3) var(--space-2);
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
