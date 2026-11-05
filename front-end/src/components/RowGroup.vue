<script setup lang="ts" generic="T">
/**
 * A group of rows under a heading that folds past a size (T200), for a long list a screen keeps
 * grouped, so that the groups can be scanned: "North Wing" with its first 20 tables and "Show all 31
 * in North Wing", which unfolds the rest in place and becomes "Show fewer" (`utils/useFold.ts`). At
 * `fold` rows or fewer it shows them all and draws no button.
 *
 * What a row is belongs to the screen, in the `row` slot; the heading says the group's name in the
 * level the page's outline needs. The `heading` slot draws more beside the name, such as a section's
 * location and tier, and the `heading` prop still names the group on the button. A plain block, not a
 * named region: a page repeats the same groups date after date, and a landmark's name must be its
 * own.
 *
 * With `v-model:unfolded` the page holds the fold (`utils/useGroupFolds.ts`), so that it outlives the
 * group and one "Show all" can speak for every group on the page.
 */
import { useFold } from '@/utils/useFold';

const props = withDefaults(
  defineProps<{
    heading: string;
    items: readonly T[];
    /** Keeps a row's own state with it when the items change. */
    itemKey: (item: T) => string;
    /** How many rows to show before folding the rest. */
    fold?: number;
    /** The heading's level in the page's outline. */
    level?: 2 | 3 | 4 | 5 | 6;
    testid: string;
  }>(),
  { fold: 20, level: 3 },
);

const unfolded = defineModel<boolean>('unfolded', { default: false });

defineSlots<{ heading?(): unknown; row(scope: { item: T; index: number }): unknown }>();

const { button, list, rest, rowTabindex, shown, toggle } = useFold(
  () => props.items,
  () => props.fold,
  unfolded,
);
</script>

<template>
  <div class="row-group" :data-testid="testid">
    <component :is="`h${level}`" class="row-group__heading" :data-testid="`${testid}-heading`">
      <slot name="heading">{{ heading }}</slot>
    </component>
    <ul ref="list" class="row-group__rows">
      <li
        v-for="(item, index) in shown"
        :key="itemKey(item)"
        :tabindex="rowTabindex(index)"
        :data-testid="`${testid}-row`"
      >
        <slot name="row" :item="item" :index="index" />
      </li>
    </ul>
    <button
      v-if="rest"
      ref="button"
      type="button"
      class="btn btn--secondary row-group__fold"
      :data-testid="`${testid}-fold`"
      @click="toggle"
    >
      <!-- A page has one of these each section, so a reader hears which. -->
      <template v-if="unfolded"
        >Show fewer<span class="visually-hidden"> in {{ heading }}</span></template
      >
      <template v-else>Show all {{ items.length }} in {{ heading }}</template>
    </button>
  </div>
</template>

<style scoped>
.row-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.row-group__heading {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-md);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.row-group__rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* The button names the heading, however long that is: it wraps inside itself, not off the page. */
.row-group__fold {
  align-self: flex-start;
  height: auto;
  min-height: var(--control-height);
  max-width: 100%;
  padding-block: var(--space-1);
  overflow-wrap: anywhere;
  white-space: normal;
}
</style>
