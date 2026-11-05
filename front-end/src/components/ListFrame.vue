<script lang="ts">
/** A list has a find field once it is longer than this, unless a screen gives its own `findFrom`. */
export const LIST_FIND_FROM = 12;
</script>

<script setup lang="ts" generic="T">
/**
 * A list that can grow with a market (T200): the screen's rows behind a find field, the screen's own
 * filters, a count line, the first page and "Show N more", and what it says while there is nothing
 * to show. Every row is already read, so all of this happens here, with no new request.
 *
 * - `items` come already narrowed by the screen's filters; the frame narrows them further by the
 *   words in its find field, through the screen's `finds`, which gets the words trimmed.
 * - A screen whose own field stands elsewhere, pinned with the frame, gives no `finds`: the frame
 *   draws no field and `items` are final, so `filterKey` must carry the screen's words as well as its
 *   filters. The count line shows only while the cap leaves rows off, since the screen's own line
 *   counts the rest, and `empty` speaks for what the screen's words found nothing for.
 * - The field shows once the whole list passes `findFrom`: `wholeCount` on a screen with filters, so
 *   a narrow filter never takes the field away, and `items` without one. It also stays while it
 *   holds words, which would otherwise narrow the rows with no way to clear them. Once focused it
 *   stays until the rows next change with the focus elsewhere: leaving as the focus left would move
 *   what follows it under the press that took the focus, and lose it, and leaving as it was cleared
 *   would drop the caret.
 * - On a page, `findKey` puts the words in the route's query, written with `router.replace`, so a
 *   refresh, a link and coming Back keep them, and Back itself leaves the page rather than stepping
 *   through each word. A dialog gives no `findKey`, since they would outlive it. Without one they
 *   last as long as the frame, or the screen holds them with `v-model:words` to set them itself, as
 *   Manage market does to show who was just added. With one, the route is what holds them.
 * - The shown count goes back to one page only when the words or `filterKey` change, the choice of
 *   rows being someone's. A read again or a verdict that changes the rows holds the place.
 * - "Show N more" hands the focus to the first new row, since the button goes with the last page.
 * - A screen whose rows are its own (a `ul` or `table` with its own classes, or groups between the
 *   rows) gives the `rows` slot rather than `row`, each row carrying `data-list-row` and
 *   `tabindex="-1"`, which is how the focus finds it.
 * - `aboveRows` stands between the tools and the count line, in every state, for what acts on the
 *   rows; `drawn` says which rows are on screen at mount and whenever they change, none while `state`
 *   draws none, with how many the cap leaves off, for a screen that acts on exactly those.
 * - With `wholeCount` and the filters leaving fewer than that, the count line says so:
 *   "Showing 50 of 110 (359 in all)", or "110 of 359 applications" with every row drawn.
 * - Enter in the field does nothing, since the rows narrow as it is typed in: in a dialog's form it
 *   would otherwise submit the form, and save what the person was only looking through.
 * - `state` says what the screen's read is doing: only `'ready'` draws rows. `'failed'` is
 *   `ReadFailed` unless the screen brings its own, and its Try again is the `retry` event. With no
 *   `items` the `empty` slot says why, or "No <many>." without one; the words alone finding nothing
 *   is the count line's to say.
 */
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ReadFailed from '@/components/ReadFailed.vue';
import { withoutQueryKey } from '@/utils/routeQuery';

const props = withDefaults(
  defineProps<{
    /** Every row the screen's filters leave. */
    items: T[];
    /** How many rows the whole list has before the filters; `items`'s length without any. */
    wholeCount?: number;
    /** The screen's filters as one string: a change goes back to one page. */
    filterKey?: string;
    /** Whether the words, trimmed, find this row; without it the frame has no field. */
    finds?: (item: T, words: string) => boolean;
    /** What tells a row from the others, across reads. */
    itemKey: (item: T) => string;
    /** What a row is, for the count line and what the frame says of the list. */
    noun: { one: string; many: string };
    pageSize?: number;
    /** The find field shows when the whole list is longer than this. */
    findFrom?: number;
    /** The route query key that holds the words; without one they stay in the frame. */
    findKey?: string;
    /** The field's label, with `finds`. */
    findLabel?: string;
    state?: 'ready' | 'loading' | 'failed';
    /** What a failed read says, `getApiErrorMessage`'s on a screen. */
    failedMessage?: string;
    /** Prefixes every test id, `ReadFailed`'s two included. */
    testid: string;
  }>(),
  {
    wholeCount: undefined,
    filterKey: undefined,
    finds: undefined,
    findLabel: undefined,
    pageSize: 50,
    findFrom: LIST_FIND_FROM,
    state: 'ready',
    findKey: undefined,
    failedMessage: undefined,
  },
);

const emit = defineEmits<{
  retry: [];
  /** The rows on screen, and how many more `Show N more` would reach. */
  drawn: [rows: T[], left: number];
}>();

defineSlots<{
  /** The screen's filters: each is its own item in the row beside the find field, and sizes itself. */
  filters?: () => unknown;
  /** What acts on the rows: over the count line, in every state, so it says for itself when it shows. */
  aboveRows?: () => unknown;
  /** One row, in the frame's own list. */
  row?: (scope: { item: T; index: number }) => unknown;
  /** The rows on screen, drawn by the screen; each row carries `data-list-row` and `tabindex="-1"`. */
  rows?: (scope: { rows: T[] }) => unknown;
  /** Why there are no `items`. */
  empty?: () => unknown;
  failed?: () => unknown;
}>();

const route = useRoute();
const router = useRouter();
const fieldId = `${useId()}-find`;

/** The words when no address holds them: the screen's with `v-model:words`, else the frame's own. */
const heldHere = defineModel<string>('words', { default: '' });

/**
 * The field's text as typed, so a space can be typed on the way to a second word; with `findKey`,
 * spaces alone drop the key and read as none.
 */
const typed = computed(() => {
  if (!props.findKey) return heldHere.value;
  const asked = route.query[props.findKey];
  return typeof asked === 'string' ? asked : '';
});
const words = computed(() => typed.value.trim());

function setTyped(value: string): void {
  const key = props.findKey;
  if (!key) {
    heldHere.value = value;
    return;
  }
  void router.replace({
    query: value.trim() ? { ...route.query, [key]: value } : withoutQueryKey(route.query, key),
  });
}

const field = ref<HTMLInputElement>();
const fieldKept = ref(false);
const showsField = computed(
  () =>
    Boolean(props.finds) &&
    ((props.wholeCount ?? props.items.length) > props.findFrom ||
      typed.value !== '' ||
      fieldKept.value),
);

const found = computed(() => {
  const { finds } = props;
  return finds && words.value
    ? props.items.filter((item) => finds(item, words.value))
    : props.items;
});

const pages = ref(1);
const rowsShown = computed(() => found.value.slice(0, pages.value * props.pageSize));
const rowsLeft = computed(() => found.value.length - rowsShown.value.length);
const nextPageRows = computed(() => Math.min(props.pageSize, rowsLeft.value));

watch([words, () => props.filterKey], () => {
  pages.value = 1;
});
const onScreen = computed(() => (props.state === 'ready' ? rowsShown.value : []));
watch(onScreen, (drawn) => emit('drawn', drawn, drawn.length ? rowsLeft.value : 0), {
  immediate: true,
});
const itemKeys = computed(() => props.items.map(props.itemKey).join('\n'));
watch(itemKeys, () => {
  fieldKept.value = document.activeElement === field.value;
});

const countLine = computed(() => {
  const total = props.items.length;
  const matching = found.value.length;
  if (words.value) {
    if (!matching) return `Nothing matches "${words.value}"`;
    return `${matching} of ${total} ${matching === 1 ? 'matches' : 'match'} "${words.value}"`;
  }
  const whole = props.wholeCount ?? total;
  const narrowed = total < whole;
  if (rowsLeft.value) {
    const showing = `Showing ${rowsShown.value.length} of ${total}`;
    return narrowed ? `${showing} (${whole} in all)` : showing;
  }
  if (narrowed) return `${total} of ${whole} ${props.noun.many}`;
  return `${total} ${total === 1 ? props.noun.one : props.noun.many}`;
});

const frame = ref<HTMLElement>();

async function showMore(): Promise<void> {
  const firstNew = rowsShown.value.length;
  pages.value += 1;
  await nextTick();
  frame.value?.querySelectorAll<HTMLElement>('[data-list-row]')[firstNew]?.focus();
}
</script>

<template>
  <div ref="frame" class="list-frame" :data-testid="testid">
    <div
      v-if="showsField || $slots.filters"
      class="list-frame__tools"
      :data-testid="`${testid}-tools`"
    >
      <div v-if="showsField" class="list-frame__find">
        <label class="field-label" :for="fieldId">{{ findLabel }}</label>
        <input
          :id="fieldId"
          ref="field"
          :value="typed"
          type="search"
          autocomplete="off"
          class="field"
          :name="`${testid}-find`"
          :data-testid="`${testid}-find`"
          @input="setTyped(($event.target as HTMLInputElement).value)"
          @focus="fieldKept = true"
          @keydown.enter.prevent
        />
      </div>
      <div v-if="$slots.filters" class="list-frame__filters"><slot name="filters" /></div>
    </div>

    <slot name="aboveRows" />

    <p
      v-if="state === 'loading'"
      class="list-frame__words"
      role="status"
      :data-testid="`${testid}-loading`"
    >
      Loading {{ noun.many }}…
    </p>
    <slot v-else-if="state === 'failed'" name="failed">
      <ReadFailed
        :name="testid"
        :message="failedMessage ?? `The ${noun.many} could not be loaded.`"
        @retry="$emit('retry')"
      />
    </slot>
    <div v-else-if="!items.length" class="list-frame__words" :data-testid="`${testid}-empty`">
      <slot name="empty">
        <p>No {{ noun.many }}.</p>
      </slot>
    </div>
    <template v-else>
      <!-- Announced: a reader stays in the field while the rows change under it. -->
      <p
        v-if="finds || rowsLeft"
        class="list-frame__words"
        role="status"
        :data-testid="`${testid}-count`"
      >
        {{ countLine }}
      </p>
      <slot v-if="found.length && $slots.rows" name="rows" :rows="rowsShown" />
      <ul v-else-if="found.length" class="list-frame__rows" :data-testid="`${testid}-rows`">
        <li
          v-for="(item, index) in rowsShown"
          :key="itemKey(item)"
          data-list-row
          tabindex="-1"
          class="list-frame__row"
          :data-testid="`${testid}-row`"
        >
          <slot name="row" :item="item" :index="index" />
        </li>
      </ul>
      <button
        v-if="rowsLeft"
        type="button"
        class="btn btn--secondary list-frame__more"
        :data-testid="`${testid}-more`"
        @click="showMore"
      >
        Show {{ nextPageRows }} more
      </button>
    </template>
  </div>
</template>

<style scoped>
.list-frame {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
}

/* The field, then each of the screen's filters beside it, wrapping under it once it would not fit. */
.list-frame__tools {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-3);
}

.list-frame__find {
  flex: 1 1 18rem;
  min-width: 0;
  max-width: 28rem;
}

.list-frame__filters {
  display: contents;
}

.list-frame__words,
.list-frame__words :deep(p) {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.list-frame__rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.list-frame__row {
  min-width: 0;
}

.list-frame__more {
  align-self: flex-start;
}

@media (width <= 640px) {
  .list-frame__find {
    flex-basis: 100%;
    max-width: none;
  }
}
</style>
