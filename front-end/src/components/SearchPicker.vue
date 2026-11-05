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
 * - A group is never hidden by a search, only narrowed: one with a name and nothing matching says
 *   so, and one with no name has no heading to say it under. Given `hidesEmptiedGroups`, a group the
 *   words emptied is not drawn, and words that find nothing say so once. A group with no choices at
 *   all is not drawn, as an empty `optgroup` was not. A picker with no choices at all never opens its
 *   list; the note beside it says why there is nothing to choose.
 * - What the words find is the caller's (`finds`), so every use searches by its own terms.
 * - The list opens in the page's flow, under the field, rather than over what follows: inside a
 *   dialog a floating list is clipped by the dialog's own scroller. In a short scroller that list
 *   can lie past the foot, so opening it and typing bring the list and the field into view, the
 *   field first where both do not fit, and chips above them may lie past the top. Given `listOver`,
 *   it lies over what follows and moves nothing, as a filter beside others needs ("Assigned to", the
 *   history's "Who"), as wide as the picker unless the caller gives it a width; in a dialog, what
 *   passes the scroller's edge then takes a scroll.
 * - The field shows no focus ring, as no field does (E38/F01, `primitives.css`): its caret is its
 *   focus. The active choice is drawn as a tint, since it is never focused itself
 *   (`aria-activedescendant`).
 * - Given a `cap`, it draws at most that many of what the words find, counted across the groups in
 *   order, then a line saying how many more there are and to type to narrow them. The line is not
 *   a choice, so the keys never land on it; it stays in view as the list scrolls, since a list cut
 *   short says so where it is read. A group the cap alone leaves out is not drawn, as it has matches
 *   and so "None match" would be false. A choice made past the cap is not drawn either: the field
 *   names it, no row is active, and Enter keeps it rather than taking the first row.
 * - Given `multiple`, it holds several choices, `modelValue` is their values, and the field holds
 *   only words to search by. Each choice shows as a chip above the field with its own remove button,
 *   and Backspace in the empty field removes the last; a held Backspace takes none, so clearing the
 *   words stops at the field. A chosen option stays in the list, ticked, and choosing it again
 *   removes it, so the rows never move under the pointer. For the same reason the list stays open
 *   and the words stay after a choice, selected so that the next word replaces them. A pointer on a
 *   chip's button leaves the field its focus; the keyboard's focus goes on to the next chip. An
 *   option's `chip` is its chip's words when they differ from its label. A chip's button is never
 *   where a dialog opens (`data-dialog-not-first`): one stray Enter would take that choice away.
 * - An option's `address` says its label and chip hold an address, drawn by `EmailAddress`, so a row
 *   or chip narrower than the address breaks it only before its "@" or a dot.
 * - Given `multiple` and a `cap` that the matches pass, every chosen match is drawn first, in the
 *   option order, so every choice opens ticked at the top, and the rest fill what the cap has left.
 *   Who leads is settled as the list opens and as the words change, never by a choice made in the
 *   open list, so no row moves under the pointer. They are drawn even when they pass the cap
 *   themselves, since each has its chip already.
 * - Given `acceptsTyped`, words that are no option's label, capitals aside, are offered as a choice
 *   of their own: `Use "<words>"` leads the list, ahead of what they find and outside the cap, so the
 *   keys reach it first, and choosing it makes the trimmed words the value. The field then shows
 *   them, or a chip does; reopened on them, as on a choice past the cap, no row is active and Enter
 *   keeps them. Words that differ from an option only in capitals take that option, the one spelt
 *   exactly so if two differ only in capitals, so "stickers" never stands beside "Stickers": it is
 *   the active row ahead of others they find, drawn first if the cap would leave it out. Among
 *   several, words a typed chip holds in other capitals are that chip, so they make no second one.
 *   The list opens for words even with no options at all.
 * - Words left in the field when it is left, or when Enter goes on to the form: with `acceptsTyped`
 *   they are kept, as the option they name or as typed (a chip, among several). `wordsAreValue` has
 *   written them already as typed, so only an option they name in other capitals is written then.
 *   Without `acceptsTyped` they go, since nothing was chosen by them.
 * - A main button's press past an open list leaves the field only as the press ends: the list sits
 *   in the page's flow, so closing it as the focus goes would move what lies below it from under the
 *   pointer, and the click would be lost, a dialog's Save among them. Words a free-text field keeps
 *   are written before that click, which may read them.
 * - Reached with a choice in it, by any path, the field has that choice selected, so what is typed
 *   next searches by itself rather than running on from the label: a dialog opens on such a field
 *   with no click, and a script's focus leaves the caret at its end.
 * - Given `holdsChoice`, one choice holds until another is taken, as a filter or a card that writes
 *   on a choice needs: typing emits nothing, and on leaving the field or on Escape the field names
 *   the choice again. Without it, the first word lets the choice go, as a dialog that acts on Save
 *   needs, so it never acts on a choice its field does not show.
 * - Given `wordsAreValue` with `acceptsTyped` on one choice, as a screen that writes as it is typed
 *   needs: every keystroke emits the trimmed words as the value, so no choice is let go first and no
 *   empty value comes between a filled one and the words replacing it. The field keeps the words as
 *   typed, a space in the middle of typing with them, until it is left, when it names the value: an
 *   option's label, or the trimmed words. Escape closes the list and keeps the words, since a plain
 *   input has no undo, and reopened on words still being typed it does not select them, so a click
 *   can place the caret. A row or `Use "<words>"` is taken as with `acceptsTyped` alone.
 * - An option whose value is `''` is a real row under `holdsChoice`: chosen while `modelValue` is
 *   `''`, named by the field and ticked as any other, as "Ignore this column" needs.
 * - Given `hideLabel`, its label is `.visually-hidden`: the screen's row says it, and the label stays
 *   for a reader.
 * - Given `invalid`, its field is `aria-invalid="true"` and ringed in red, as a field is on Pricing;
 *   the words saying why are the caller's, through `describedBy`.
 * - An option that is `disabled` may not be taken, as a target another column holds: drawn muted with
 *   `aria-disabled="true"`, its `detail` saying why. The keys and the first active row pass it by, and
 *   neither a click nor Enter nor words naming it take it. Words still find it and the cap still
 *   counts it, so nobody wonders where it went. Held as the choice, the field names it and no row is
 *   active, so Enter keeps it.
 * - Given `clearsOnChoice`, on one choice, each choice is added elsewhere, as a ranked list's next
 *   answer: after emitting, the field empties, the list closes and the focus stays, ready for the next
 *   word, and the value stays `''`.
 * - Given `fieldId`, its field has that id, for a link elsewhere on the screen to name.
 * - `show()`, exposed, takes the focus and opens the list, for a link elsewhere on the screen, and
 *   answers whether the list is open. A disabled field takes neither; with no rows to list, the
 *   field has the focus and no list.
 * - `showChoice()`, exposed, has the field name the choice that holds again, for a screen whose
 *   server refused the one just taken, which `modelValue` never became. Words being typed stay.
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import IconCheck from '@/components/icons/IconCheck.vue';
import IconCloseRound from '@/components/icons/IconCloseRound.vue';
import EmailAddress from '@/components/EmailAddress.vue';

export interface PickerOption {
  value: string;
  /** What the choice is called, in the list and in the field once it is chosen. */
  label: string;
  /** A second line of words beside the label, such as where a vendor sits. */
  detail?: string;
  /** The words on its chip, among several, where they differ from the label. */
  chip?: string;
  /** Its label and chip hold an address, so a line breaks it only before its "@" or a dot. */
  address?: boolean;
  /** It may not be taken; its `detail` says why. Words still find it. */
  disabled?: boolean;
}

export interface PickerGroup {
  /** The group's heading; a picker with one unnamed group draws none. */
  label?: string;
  testid?: string;
  options: PickerOption[];
}

const props = defineProps<
  {
    groups: PickerGroup[];
    /** Whether the words typed find this choice. */
    finds: (option: PickerOption, words: string) => boolean;
    label: string;
    placeholder?: string;
    testid: string;
    /** At most this many matching choices are drawn; without it, all of them are. */
    cap?: number;
    /** Words that are exactly no option can be chosen as they are, as the value. */
    acceptsTyped?: boolean;
    /** Who or what finds no match, as the list says it: "Nothing", where the choices are not people. */
    noneWord?: string;
    /** With one choice: words only search, and the choice holds until another is taken. */
    holdsChoice?: boolean;
    /** The field, its chips and its list take nothing, as while what they chose is being saved. */
    disabled?: boolean;
    /** The id of words beside the picker that describe its field, such as a hint. */
    describedBy?: string;
    /** The list lies over what follows the picker, rather than pushing it down. */
    listOver?: boolean;
    /** With `acceptsTyped` on one choice: every keystroke writes the words as the value. */
    wordsAreValue?: boolean;
    /** The screen's row says what this is: the label stays for a reader, out of view. */
    hideLabel?: boolean;
    /** Its field reads as wrong, and says so to a reader. */
    invalid?: boolean;
    /** On one choice: each is added elsewhere, so the field empties, ready for the next word. */
    clearsOnChoice?: boolean;
    /** Its field's id, for a link elsewhere on the screen to name. */
    fieldId?: string;
    /** A group the words emptied is not drawn: its heading says nothing of what they did find. */
    hidesEmptiedGroups?: boolean;
  } & (
    | { multiple?: false; modelValue: string }
    /** Several choices, shown as chips above the field. */
    | { multiple: true; modelValue: string[] }
  )
>();

const emit = defineEmits<{ 'update:modelValue': [value: string | string[]] }>();

const id = useId();
const inputId = computed(() => props.fieldId ?? `${id}-input`);
const listId = `${id}-list`;
const optionId = (index: number) => `${id}-option-${index}`;
const moreId = `${id}-more`;

const allOptions = computed(() => props.groups.flatMap((group) => group.options));
/** Whether the picker has any option at all. */
const hasChoices = computed(() => allOptions.value.length > 0);
/** The one choice made; several are `chosenValues`. */
const chosenOption = computed(() =>
  props.multiple ? undefined : allOptions.value.find((option) => option.value === props.modelValue),
);
/** The one choice made when no option offers it: the words it was typed as. */
const keptWords = computed(() =>
  props.acceptsTyped && !props.multiple && !chosenOption.value ? props.modelValue : '',
);
/** Every choice made, in the order they were made, when the picker holds several. */
const chosenValues = computed(() => (props.multiple ? props.modelValue : []));
const isChosen = (option: PickerOption) =>
  props.multiple ? props.modelValue.includes(option.value) : option.value === props.modelValue;
/** A chosen value no option offers shows as its own words. */
const chips = computed(() => {
  const options = new Map(allOptions.value.map((option) => [option.value, option]));
  return chosenValues.value.map((value) => {
    const option = options.get(value);
    const label = option?.label ?? value;
    return { value, label, words: option?.chip ?? label, address: option?.address };
  });
});

/** What the field holds: the words typed, or the chosen choice's label. */
const text = ref('');
/** Whether the field holds words to search by, rather than the choice made. */
const searching = ref(false);
const open = ref(false);
const active = ref(-1);

/** Whether what is typed is the value, rather than words to choose by. */
const writesWords = computed(() => props.wordsAreValue && props.acceptsTyped && !props.multiple);

watch(
  () => props.modelValue,
  () => {
    if (props.multiple) return;
    // The value the words being typed emitted, or the choice they let go, leaves them as typed.
    const fromTheWords = writesWords.value
      ? props.modelValue === text.value.trim()
      : !props.modelValue;
    if (searching.value && fromTheWords) return;
    text.value = chosenOption.value?.label ?? keptWords.value;
    searching.value = false;
  },
  { immediate: true },
);

const words = computed(() => (searching.value ? text.value.trim() : ''));

const holds = computed(() => props.holdsChoice && !props.multiple);
/** A list cannot stay open on a field that takes nothing. */
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) open.value = false;
  },
);
/** The field gives up its words and names the choice that held under them. */
function nameTheChoice(): void {
  text.value = chosenOption.value?.label ?? keptWords.value;
  searching.value = false;
}

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
const matchCount = computed(() =>
  matchedGroups.value.reduce((count, group) => count + group.matched.length, 0),
);
/** The option the words name: spelt exactly so, or else capitals aside. */
const namedOption = computed(() => {
  if (!props.acceptsTyped || !words.value) return undefined;
  const folded = words.value.toLowerCase();
  return (
    allOptions.value.find((option) => option.label === words.value) ??
    allOptions.value.find((option) => option.label.toLowerCase() === folded)
  );
});
/** The choices that lead a capped list, as they stood when it opened or the words last changed. */
const pinned = ref<ReadonlySet<string>>(new Set());
function pinTheChosen(): void {
  pinned.value = new Set(chosenValues.value);
}
/** What a list past its cap draws first: the choices made, and the option the words name. */
const leadRows = computed(() => {
  if (props.cap === undefined || matchCount.value <= props.cap) return [];
  return matchedGroups.value
    .flatMap((group) => group.matched)
    .filter((option) => pinned.value.has(option.value) || option === namedOption.value);
});
/** The matched groups the cap keeps: it fills them in order, and one it leaves out is not drawn. */
const cappedGroups = computed(() => {
  const led = new Set(leadRows.value);
  let room = Math.max((props.cap ?? Infinity) - led.size, 0);
  return matchedGroups.value.flatMap((group) => {
    const shown = group.matched.filter((option) => !led.has(option)).slice(0, room);
    room -= shown.length;
    const emptied = group.matched.length === 0 && props.hidesEmptiedGroups;
    return (group.matched.length > 0 && shown.length === 0) || emptied ? [] : [{ ...group, shown }];
  });
});
/** The words as a choice of their own, while they name no option. */
const typedOption = computed<PickerOption | undefined>(() => {
  if (!props.acceptsTyped || !words.value || namedOption.value) return undefined;
  // Among several, words a typed chip already holds in other capitals are that chip.
  const folded = words.value.toLowerCase();
  const value = chosenValues.value.find((chosen) => chosen.toLowerCase() === folded) ?? words.value;
  return { value, label: `Use "${value}"` };
});
type ShownGroup = (typeof cappedGroups.value)[number];
const leadGroup = (options: PickerOption[], testid?: string): ShownGroup => ({
  testid,
  options,
  matched: options,
  shown: options,
});
/** Everything drawn, in order: the words as a choice, outside the cap, then the rows that lead. */
const shownGroups = computed(() => {
  const option = typedOption.value;
  return [
    ...(option ? [leadGroup([option], `${props.testid}-typed`)] : []),
    ...(leadRows.value.length ? [leadGroup(leadRows.value)] : []),
    ...cappedGroups.value,
  ];
});
const shownOptions = computed(() => shownGroups.value.flatMap((group) => group.shown));
/** How many matches the cap leaves undrawn. */
const moreCount = computed(
  () =>
    matchCount.value -
    leadRows.value.length -
    cappedGroups.value.reduce((count, group) => count + group.shown.length, 0),
);
/** The next row past `from` in the direction of `step` that can be taken, or `from` if none is. */
function rowFrom(from: number, step: 1 | -1): number {
  const rows = shownOptions.value;
  for (let at = from + step; at >= 0 && at < rows.length; at += step) {
    if (!rows[at]!.disabled) return at;
  }
  return from;
}
/** With nothing chosen, the row the keys start on; words that name an option lead to it. */
const firstRow = computed(() => {
  const named = namedOption.value?.disabled ? undefined : namedOption.value;
  const at = named ? shownOptions.value.indexOf(named) : -1;
  return at >= 0 ? at : rowFrom(-1, 1);
});
/** Whether there is anything to list: an option, or words to use. */
const hasRows = computed(() => hasChoices.value || Boolean(typedOption.value));
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

/** The caller's words, and the line a capped list adds while it shows. */
const fieldDescribedBy = computed(
  () =>
    [props.describedBy, open.value && moreCount.value > 0 ? moreId : undefined]
      .filter(Boolean)
      .join(' ') || undefined,
);

const list = ref<HTMLElement | null>(null);
watch(active, async (index) => {
  await nextTick();
  const option = list.value?.querySelector<HTMLElement>(`#${CSS.escape(optionId(index))}`);
  option?.scrollIntoView?.({ block: 'nearest' });
});

const field = ref<HTMLInputElement | null>(null);
// Each moved alone, since a picker holding many chips can stand past both edges of its scroller,
// and `nearest` then moves nothing. The field goes last, so it shows where both do not fit.
watch([open, text], async ([isOpen]) => {
  if (!isOpen || props.listOver) return;
  await nextTick();
  list.value?.scrollIntoView?.({ block: 'nearest' });
  field.value?.scrollIntoView?.({ block: 'nearest' });
});

const chipList = ref<HTMLElement | null>(null);

function openList(): void {
  if (open.value || !hasRows.value || props.disabled) return;
  pinTheChosen();
  open.value = true;
  const chosenAt = shownOptions.value.findIndex(
    (option) => option.value === props.modelValue && !option.disabled,
  );
  const heldUndrawn = chosenOption.value || keptWords.value;
  // A choice the cap leaves undrawn, or that no option offers, makes no row active, so Enter keeps
  // it.
  active.value = chosenAt >= 0 ? chosenAt : heldUndrawn ? -1 : firstRow.value;
  // Reopened on a choice, its label is selected, so what is typed next replaces it and searches
  // by itself, rather than running on from the label; left untouched, the choice stays.
  // Words still being typed are not a choice to replace: a click places the caret in them.
  if (heldUndrawn && !(writesWords.value && searching.value)) field.value?.select();
}

/** Opens the list from elsewhere on the screen, so the focus comes here first. */
function show(): boolean {
  if (props.disabled) return false;
  field.value?.focus();
  openList();
  return open.value;
}

/** Back to naming the choice that holds, as after one that did not stand; words being typed stay. */
function showChoice(): void {
  if (!searching.value) nameTheChoice();
}

defineExpose({ show, showChoice });

function choose(option: PickerOption): void {
  if (option.disabled) return;
  if (props.multiple) {
    emit(
      'update:modelValue',
      isChosen(option)
        ? props.modelValue.filter((value) => value !== option.value)
        : [...props.modelValue, option.value],
    );
    if (text.value) field.value?.select();
    return;
  }
  // The field shows the words themselves, not the row that offered them.
  if (props.clearsOnChoice) text.value = '';
  else text.value = option === typedOption.value ? option.value : option.label;
  searching.value = false;
  open.value = false;
  active.value = -1;
  emit('update:modelValue', option.value);
}

function typed(): void {
  pinTheChosen();
  searching.value = true;
  open.value = hasRows.value;
  active.value = firstRow.value;
  if (writesWords.value) {
    emit('update:modelValue', text.value.trim());
    return;
  }
  // Words that no longer name the choice let it go, so a dialog never acts on a choice its field
  // does not show.
  if (!props.multiple && !holds.value && props.modelValue) emit('update:modelValue', '');
}

/**
 * A free-text field keeps the words not chosen: as the option they name, or as typed. Words that
 * are the value were written as typed already, so only an option they name has more to write.
 */
function keepTheWords(): void {
  if (!props.acceptsTyped || holds.value) return;
  const option = namedOption.value ?? (writesWords.value ? undefined : typedOption.value);
  if (!option || option.disabled || (writesWords.value && option.value === props.modelValue))
    return;
  if (!props.multiple) choose(option);
  else if (!isChosen(option)) emit('update:modelValue', [...props.modelValue, option.value]);
}

/** Takes a chip away. The keyboard's focus was on its button, which is gone, so it goes on. */
async function removeChip(at: number): Promise<void> {
  const focusWasOnChip = chipList.value?.contains(document.activeElement);
  emit(
    'update:modelValue',
    chosenValues.value.filter((_, index) => index !== at),
  );
  if (!focusWasOnChip) return;
  await nextTick();
  const buttons = chipList.value?.querySelectorAll('button');
  (buttons?.[at] ?? buttons?.[at - 1] ?? field.value)?.focus();
}

function onKeydown(event: KeyboardEvent): void {
  // A press still under way when a key comes never got its end, as a scrollbar's may not.
  pressing = false;
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      if (!open.value) openList();
      else active.value = rowFrom(active.value, 1);
      return;
    case 'ArrowUp':
      event.preventDefault();
      if (!open.value) openList();
      else active.value = active.value < 0 ? rowFrom(-1, 1) : rowFrom(active.value, -1);
      return;
    case 'Enter': {
      // With the list closed the key goes on to the form, which reads the words as kept.
      if (!open.value) return keepTheWords();
      // The list is open, so Enter is the list's: it chooses, and never submits the dialog.
      event.preventDefault();
      const option = shownOptions.value[active.value];
      if (option) choose(option);
      else open.value = false;
      return;
    }
    case 'Escape':
      // The dialog around the picker takes Escape on `window`, so the key is stopped at the field
      // while the list is open, or while words cover a choice that holds, and goes on to the dialog
      // after that.
      if (!open.value && !(holds.value && searching.value)) return;
      event.preventDefault();
      event.stopPropagation();
      open.value = false;
      if (holds.value) nameTheChoice();
      return;
    case 'Backspace':
      // Only a fresh press: one held to clear the words stops when they are gone.
      if (!props.multiple || text.value || event.repeat || !chosenValues.value.length) return;
      emit('update:modelValue', chosenValues.value.slice(0, -1));
      return;
  }
}

/** The field is left: its list goes, and it says what it holds. */
function leave(): void {
  open.value = false;
  keepTheWords();
  if (props.multiple) {
    text.value = '';
    searching.value = false;
  } else if (searching.value) {
    nameTheChoice();
  }
}

/** Whether a press is under way, while the list is open. */
let pressing = false;
function pressStarted(event: MouseEvent): void {
  // Only the main button: a context menu can take the end of any other's press.
  if (event.button === 0) pressing = true;
}
function pressEnded(): void {
  pressing = false;
  const leftTheField = () => open.value && document.activeElement !== field.value;
  // Ahead of the click this press makes, whose target is settled by now and which may read them.
  if (leftTheField()) keepTheWords();
  // After that click, which lands before a timer does.
  setTimeout(() => {
    if (leftTheField()) leave();
  });
}
function listenForPresses(listening: boolean): void {
  const listen = listening ? window.addEventListener : window.removeEventListener;
  listen('mousedown', pressStarted, true);
  listen('mouseup', pressEnded, true);
}
watch(open, (isOpen) => {
  listenForPresses(isOpen);
  if (!isOpen) pressing = false;
});
onBeforeUnmount(() => listenForPresses(false));

function onBlur(): void {
  if (!pressing) leave();
}

function onFocus(): void {
  if (!searching.value && text.value) field.value?.select();
}
</script>

<template>
  <div
    class="search-picker"
    :class="{ 'search-picker--list-over': listOver }"
    :data-testid="testid"
  >
    <label :class="hideLabel ? 'visually-hidden' : 'field-label'" :for="inputId">{{ label }}</label>
    <!-- `mousedown.prevent` keeps the field's focus, its words and its open list while a pointer
         removes a chip. -->
    <ul
      v-if="chips.length"
      ref="chipList"
      class="search-picker-chips"
      :aria-label="`${label}, chosen`"
      :data-testid="`${testid}-chips`"
      @mousedown.prevent
    >
      <li
        v-for="(chip, at) in chips"
        :key="chip.value"
        class="chip chip--neutral search-picker-chip"
        :data-testid="`${testid}-chip`"
      >
        <span class="search-picker-chip-label"
          ><EmailAddress v-if="chip.address" :words="chip.words" /><template v-else>{{
            chip.words
          }}</template></span
        >
        <button
          type="button"
          class="search-picker-chip-remove"
          data-dialog-not-first
          :disabled="disabled"
          :data-testid="`${testid}-chip-remove`"
          @click="removeChip(at)"
        >
          <IconCloseRound aria-hidden="true" />
          <span class="visually-hidden">Remove {{ chip.label }}</span>
        </button>
      </li>
    </ul>
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
      :aria-describedby="fieldDescribedBy"
      :aria-invalid="invalid ? 'true' : undefined"
      :disabled="disabled"
      :placeholder="placeholder"
      :data-testid="`${testid}-input`"
      @input="typed"
      @click="openList"
      @keydown="onKeydown"
      @focus="onFocus"
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
      :aria-multiselectable="multiple ? 'true' : undefined"
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
          :class="{
            'search-picker-option--active': active === groupStarts[g]! + o,
            'search-picker-option--several': multiple,
            'search-picker-option--disabled': option.disabled,
          }"
          :aria-selected="isChosen(option) ? 'true' : 'false'"
          :aria-disabled="option.disabled ? 'true' : undefined"
          :data-value="option.value"
          :data-testid="`${testid}-option`"
          @click="choose(option)"
          @mousemove="option.disabled || (active = groupStarts[g]! + o)"
        >
          <IconCheck
            v-if="multiple && isChosen(option)"
            class="search-picker-option-tick"
            :data-testid="`${testid}-option-tick`"
          />
          <span class="search-picker-option-label"
            ><EmailAddress v-if="option.address" :words="option.label" /><template v-else>{{
              option.label
            }}</template></span
          >
          <span v-if="option.detail" class="search-picker-option-detail">{{ option.detail }}</span>
        </div>
        <p
          v-if="group.label && !group.shown.length && cappedGroups.length > 1"
          class="search-picker-none"
        >
          None match "{{ words }}".
        </p>
      </div>
      <p
        v-if="!shownOptions.length && cappedGroups.length <= 1"
        class="search-picker-none"
        :data-testid="`${testid}-none`"
      >
        {{ noneWord ?? 'Nobody' }} matches "{{ words }}".
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

.search-picker .field[aria-invalid='true'] {
  border-color: var(--mm-red);
}

.search-picker-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  min-width: 0;
  margin: 0 0 var(--space-2);
  padding: 0;
  list-style: none;
}

/* A long name or address wraps inside its chip, which never grows past the picker. */
.search-picker-chip {
  max-width: 100%;
  padding-block: 0;
  padding-right: 0;
  white-space: normal;
}

.search-picker-chip-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* The target is `--target-min` either way, so a chip stands as tall as a thumb's on a phone. */
.search-picker-chip-remove {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: var(--target-min);
  min-height: var(--target-min);
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill);
  background: none;
  color: inherit;
  cursor: pointer;
}

.search-picker-chip-remove:hover:not(:disabled) {
  background: var(--mm-border);
}

.search-picker-chip-remove:disabled {
  color: var(--mm-text-muted-on-beige);
  cursor: not-allowed;
}

.search-picker-chip-remove svg {
  width: var(--space-3);
  height: var(--space-3);
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

.search-picker--list-over {
  position: relative;
}

.search-picker--list-over .search-picker-list {
  position: absolute;
  top: 100%;
  right: 0;
  left: 0;
  z-index: 1;
  box-shadow: var(--shadow-card);
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

/* The space over and under a row: one line stands in the middle of the target, on a phone's too,
   and more lines grow the row down from there, so the tick can stand on the first line. */
.search-picker-option {
  --row-inset: max(var(--space-1), calc((var(--target-min) - 1lh) / 2));
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0 var(--space-3);
  min-height: var(--target-min);
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- the row's inset, which centres one line in a --target-min target: a length from that token, not a spacing step */
  padding: var(--row-inset) var(--space-3);
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
}

.search-picker-option--active {
  background: var(--mm-beige);
}

/* The tick's room is kept on every row, so the labels line up and none moves when it is chosen. */
.search-picker-option--several {
  position: relative;
  padding-left: calc(var(--space-3) + var(--space-6));
}

.search-picker-option-tick {
  position: absolute;
  top: calc(var(--row-inset) + (1lh - var(--space-4)) / 2);
  left: var(--space-3);
  width: var(--space-4);
  height: var(--space-4);
}

.search-picker-option[aria-selected='true'] .search-picker-option-label {
  font-weight: 600;
}

.search-picker-option--disabled {
  color: var(--mm-text-muted);
  cursor: not-allowed;
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
