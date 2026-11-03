<script setup lang="ts" generic="T">
/**
 * A list that can grow with a market (T200): the screen's rows behind a find field, the screen's own
 * filters, a count line, the first page and "Show N more", and what it says while there is nothing
 * to show. Every row is already read, so all of this happens here, with no new request.
 *
 * - `items` come already narrowed by the screen's filters; the frame narrows them further by the
 *   words in its find field, through the screen's `finds`, which gets the words trimmed.
 * - The field shows once `items` passes `findFrom`. It also stays while it holds words, which would
 *   otherwise narrow the rows with no way to clear them, and while it has the focus, so clearing it
 *   never drops the caret.
 * - With `findKey` the words live in the route's query, written with `router.replace`, so a refresh,
 *   a link and coming Back keep them, and Back itself leaves the page rather than stepping through
 *   each word. Without it they last as long as the frame.
 * - The shown count goes back to one page when the words or the items change. A read again that
 *   brings the same rows, by `itemKey`, is no change, so a refresh never folds what was unfolded.
 * - "Show N more" hands the focus to the first new row, since the button goes with the last page.
 * - `state` says what the screen's read is doing: only `'ready'` draws rows. `'failed'` is
 *   `ReadFailed` unless the screen brings its own, and its Try again is the `retry` event. With no
 *   `items` the `empty` slot says why; the words alone finding nothing is the count line's to say.
 *
 * Inside a `scroll="body"` dialog it needs nothing of its own: it is the body's content, and the body
 * scrolls.
 */
import { computed, nextTick, ref, useId, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ReadFailed from '@/components/ReadFailed.vue';
import { withoutQueryKey } from '@/utils/routeQuery';

const props = withDefaults(
  defineProps<{
    /** Every row the screen's filters leave. */
    items: T[];
    /** Whether the words, trimmed, find this row. */
    finds: (item: T, words: string) => boolean;
    /** What tells a row from the others, across reads. */
    itemKey: (item: T) => string;
    /** What a row is, for the count line and what the frame says of the list. */
    noun: { one: string; many: string };
    pageSize?: number;
    /** The find field shows when `items` is longer than this. */
    findFrom?: number;
    /** The route query key that holds the words; without one they stay in the frame. */
    findKey?: string;
    findLabel: string;
    state?: 'ready' | 'loading' | 'failed';
    /** What a failed read says, `getApiErrorMessage`'s on a screen. */
    failedMessage?: string;
    /** Prefixes every test id, `ReadFailed`'s two included. */
    testid: string;
  }>(),
  { pageSize: 50, findFrom: 12, state: 'ready', findKey: undefined, failedMessage: undefined },
);

defineEmits<{ retry: [] }>();

defineSlots<{
  /** The screen's filters: each is its own item in the row beside the find field, and sizes itself. */
  filters?: () => unknown;
  row: (scope: { item: T; index: number }) => unknown;
  /** Why there are no `items`. */
  empty?: () => unknown;
  failed?: () => unknown;
}>();

const route = useRoute();
const router = useRouter();
const fieldId = `${useId()}-find`;

/** What the frame holds when no address does. */
const heldHere = ref('');

/** The field's text, spaces and all, so a space can be typed on the way to a second word. */
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

const fieldFocused = ref(false);
const showsField = computed(
  () => props.items.length > props.findFrom || typed.value !== '' || fieldFocused.value,
);

const found = computed(() => {
  const asked = words.value;
  return asked ? props.items.filter((item) => props.finds(item, asked)) : props.items;
});

const pages = ref(1);
const rowsShown = computed(() => found.value.slice(0, pages.value * props.pageSize));
const rowsLeft = computed(() => found.value.length - rowsShown.value.length);
const nextPage = computed(() => Math.min(props.pageSize, rowsLeft.value));

const itemKeys = computed(() => props.items.map(props.itemKey).join('\n'));
watch([words, itemKeys], () => {
  pages.value = 1;
});

const countLine = computed(() => {
  const total = props.items.length;
  const matching = found.value.length;
  if (words.value) {
    if (!matching) return `Nothing matches "${words.value}"`;
    return `${matching} of ${total} ${matching === 1 ? 'matches' : 'match'} "${words.value}"`;
  }
  if (rowsLeft.value) return `Showing ${rowsShown.value.length} of ${total}`;
  return `${total} ${total === 1 ? props.noun.one : props.noun.many}`;
});

const list = ref<HTMLUListElement>();

async function showMore(): Promise<void> {
  const firstNew = rowsShown.value.length;
  pages.value += 1;
  await nextTick();
  (list.value?.children[firstNew] as HTMLElement | undefined)?.focus();
}
</script>

<template>
  <div class="list-frame" :data-testid="testid">
    <div
      v-if="showsField || $slots.filters"
      class="list-frame__tools"
      :data-testid="`${testid}-tools`"
    >
      <div v-if="showsField" class="list-frame__find">
        <label class="field-label" :for="fieldId">{{ findLabel }}</label>
        <input
          :id="fieldId"
          :value="typed"
          type="search"
          autocomplete="off"
          class="field"
          :name="`${testid}-find`"
          :data-testid="`${testid}-find`"
          @input="setTyped(($event.target as HTMLInputElement).value)"
          @focus="fieldFocused = true"
          @blur="fieldFocused = false"
        />
      </div>
      <div v-if="$slots.filters" class="list-frame__filters"><slot name="filters" /></div>
    </div>

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
      <p class="list-frame__words" role="status" :data-testid="`${testid}-count`">
        {{ countLine }}
      </p>
      <ul v-if="found.length" ref="list" class="list-frame__rows" :data-testid="`${testid}-rows`">
        <li
          v-for="(item, index) in rowsShown"
          :key="itemKey(item)"
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
        Show {{ nextPage }} more
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
