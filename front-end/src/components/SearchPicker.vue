<script setup lang="ts">
/**
 * A choice among many, found by typing (E38/F08/S03): a field that narrows a grouped list as it
 * is typed in, a combobox in the WAI-ARIA sense.
 *
 * The placement dialog's vendor pickers were native selects of every vendor seated that day, about
 * sixty on a real market, scrolled through for the one wanted. ADR 0015 sends a combobox to a
 * headless library first, and records why this one stays the app's own: no dependency and no growth
 * of the first paint's JavaScript for a control this small, groups that a search narrows and never
 * hides, and a list in the dialog's flow that its scroller cannot clip.
 *
 * - Named by its own label, and worked from the keyboard alone: the arrow keys move through the
 *   list, Enter takes the active choice, Escape closes the list. While the list is closed, Enter
 *   and Escape belong to the dialog around it, so Enter still submits and Escape still closes.
 * - A group is never hidden by a search, only narrowed: one with nothing matching says so. A group
 *   with no choices at all is not drawn, as an empty `optgroup` was not. A picker with no choices
 *   at all never opens its list; the note beside it says why there is nothing to choose.
 * - What the words find is the caller's (`finds`), so every use searches by its own terms.
 * - The list opens in the page's flow, under the field, rather than over what follows: inside a
 *   dialog a floating list is clipped by the dialog's own scroller.
 * - The field shows no focus ring, as no field does (E38/F01, `primitives.css`): its caret is its
 *   focus. The active choice is drawn as a tint, since it is never focused itself
 *   (`aria-activedescendant`).
 * - Given a `cap`, it draws at most that many of what the words find, counted across the groups in
 *   order, then a line saying how many more there are and to type to narrow them. The line is not
 *   a choice, so the keys never land on it; it stays in view as the list scrolls, since a list cut
 *   short says so where it is read. A group the cap alone leaves out is not drawn, as it has matches
 *   and so "None match" would be false. A choice made past the cap is not drawn either: the field
 *   names it, no row is active, and Enter keeps it rather than taking the first row.
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
  /** At most this many matching choices are drawn; without it, all of them are. */
  cap?: number;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const id = useId();
const inputId = `${id}-input`;
const listId = `${id}-list`;
const optionId = (index: number) => `${id}-option-${index}`;
const moreId = `${id}-more`;

const allOptions = computed(() => props.groups.flatMap((group) => group.options));
/** Whether the picker has any choice at all; with none, the list never opens. */
const hasChoices = computed(() => allOptions.value.length > 0);
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
const matchedGroups = computed(() =>
  props.groups
    .filter((group) => group.options.length > 0)
    .map((group) => ({
      ...group,
      matched: words.value
        ? group.options.filter((option) => props.finds(option, words.value))
        : group.options,
    })),
);
/** The matched groups as drawn: the cap fills them in order, and one it leaves out is not drawn. */
const shownGroups = computed(() => {
  let room = props.cap ?? Infinity;
  return matchedGroups.value.flatMap((group) => {
    const shown = group.matched.slice(0, room);
    room -= shown.length;
    return group.matched.length > 0 && shown.length === 0 ? [] : [{ ...group, shown }];
  });
});
const shownOptions = computed(() => shownGroups.value.flatMap((group) => group.shown));
/** How many matches the cap leaves undrawn. */
const moreCount = computed(
  () =>
    matchedGroups.value.reduce((count, group) => count + group.matched.length, 0) -
    shownOptions.value.length,
);
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

const field = ref<HTMLInputElement | null>(null);

function show(): void {
  if (open.value || !hasChoices.value) return;
  open.value = true;
  const chosenAt = shownOptions.value.findIndex((option) => option.value === props.modelValue);
  // A choice the cap leaves undrawn makes no row active, so Enter keeps it.
  active.value =
    chosenAt >= 0 ? chosenAt : !chosenOption.value && shownOptions.value.length ? 0 : -1;
  // Reopened on a choice, its label is selected, so what is typed next replaces it and searches
  // by itself, rather than running on from the label; left untouched, the choice stays.
  if (chosenOption.value) field.value?.select();
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
  open.value = hasChoices.value;
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
      ref="field"
      v-model="text"
      type="text"
      role="combobox"
      class="field"
      autocomplete="off"
      spellcheck="false"
      aria-autocomplete="list"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="listId"
      :aria-activedescendant="activeId"
      :aria-describedby="open && moreCount > 0 ? moreId : undefined"
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
      :class="{ 'search-picker-list--capped': moreCount > 0 }"
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
      <p
        v-if="moreCount > 0"
        :id="moreId"
        role="presentation"
        class="search-picker-more"
        :data-testid="`${testid}-more`"
      >
        {{ moreCount }} more, type to narrow
      </p>
    </div>
  </div>
</template>

<style scoped>
.search-picker {
  display: flex;
  flex-direction: column;
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

/* The keys bring the active choice into view clear of the line pinned over the list's foot. */
.search-picker-list--capped {
  padding-bottom: 0;
  scroll-padding-bottom: var(--space-8);
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
.search-picker-more {
  position: sticky;
  bottom: 0;
  display: flex;
  flex: none;
  align-items: center;
  min-height: var(--space-8);
  margin: 0;
  padding: 0 var(--space-3);
  border-top: 1px solid var(--mm-border);
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  background: white;
}
</style>
