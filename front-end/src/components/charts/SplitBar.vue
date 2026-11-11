<script setup lang="ts">
/**
 * A split bar (T201): one bar of a whole, cut into its parts in a fixed order, each sized by its
 * count and filled in its own colour (`utils/splitBar.ts`). The Stats tab draws the review's state
 * with it: Open, Needs follow-up, Approved and Rejected.
 *
 * A 2px white gap parts each fill from the next, so neighbouring fills need no
 * contrast with each other, only the 3:1 each holds on white (`contrast.test.ts`). A part with
 * nothing in it takes no room in the bar.
 *
 * The bar is hidden from assistive technology; the legend under it is the text, a line per part, a
 * zero included: its swatch, its label, its count and its share of the whole. A line is a link to
 * the part's list where it has one and something to list; a zero is told but not linked, so no link
 * opens an empty list.
 */
import { computed } from 'vue';
import type { SplitPart } from '@/utils/splitBar';

const props = defineProps<{
  title: string;
  parts: SplitPart[];
  /** What a share is of, in a screen reader's words: "applications". */
  whole: string;
  /** The legend lines' `data-testid`, and the stem of the rest. */
  testid: string;
}>();

const total = computed(() => props.parts.reduce((sum, part) => sum + part.count, 0));
const drawn = computed(() => props.parts.filter((part) => part.count > 0));

function share(part: SplitPart): number {
  return total.value ? Math.round((part.count / total.value) * 100) : 0;
}
</script>

<template>
  <div class="split-bar">
    <h3>{{ title }}</h3>
    <div
      class="split-bar-bar"
      :class="{ 'split-bar-bar--empty': !drawn.length }"
      aria-hidden="true"
      :data-testid="`${testid}-bar`"
    >
      <span
        v-for="part in drawn"
        :key="part.value"
        class="split-bar-part"
        :style="{ flexGrow: part.count, background: `var(${part.fill})` }"
        :data-value="part.value"
        :data-testid="`${testid}-bar-part`"
      />
    </div>
    <ul class="split-bar-legend">
      <li v-for="part in parts" :key="part.value">
        <!-- Named by the words it shows, as a ledger's row is. -->
        <component
          :is="part.to && part.count ? 'RouterLink' : 'div'"
          :to="part.to && part.count ? part.to : undefined"
          class="split-bar-line"
          :class="{ 'split-bar-line--link': part.to && part.count }"
          :data-testid="testid"
          :data-value="part.value"
        >
          <span
            class="split-bar-swatch"
            aria-hidden="true"
            :style="{ background: `var(${part.fill})` }"
            :data-testid="`${testid}-swatch`"
          /><span class="split-bar-label"
            >{{ part.label }}<span class="visually-hidden">: </span></span
          ><span class="split-bar-count" :data-testid="`${testid}-count`">{{ part.count }}</span
          ><span class="visually-hidden">, </span
          ><span class="split-bar-share">{{ share(part) }}%</span
          ><span class="visually-hidden"> of {{ whole }}</span>
        </component>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.split-bar {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
}

.split-bar h3 {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-text-muted);
}

/* The parts share the bar by count; the gap between them is white. A bar with nothing in it is a
   beige track, so it still shows where the parts would stand. */
.split-bar-bar {
  display: flex;
  gap: var(--space-hairline);
  height: var(--space-4);
  border-radius: var(--radius-pill);
  background: white;
  overflow: hidden;
}

.split-bar-bar--empty {
  background: var(--mm-beige);
}

/* Sized by `flex-grow` from nothing, so the gaps come out of the parts and the shares hold; a part
   with anything in it stays at least 2px, so one application of hundreds still shows. */
.split-bar-part {
  flex: 0 1 0;
  min-width: 2px;
}

.split-bar-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.split-bar-line {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--target-min);
  padding: 0 var(--space-1);
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  font-size: var(--text-sm);
  color: var(--mm-black);
  text-decoration: none;
  /* A line shows its hover at once, as a ledger's row does. */
  transition: none;
}

.split-bar-line--link .split-bar-label {
  color: var(--mm-text-link);
  text-decoration: underline;
  text-underline-offset: var(--space-hairline);
}

.split-bar-line--link:hover {
  border-color: var(--mm-border);
  background: var(--mm-beige);
}

.split-bar-swatch {
  flex: none;
  width: var(--space-3);
  height: var(--space-3);
  border-radius: var(--radius-pill);
}

/* Weight does not inherit here (the design language), so the figure carries its own. */
.split-bar-count {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.split-bar-share {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  font-variant-numeric: tabular-nums;
}

.split-bar-line--link:hover .split-bar-share {
  color: var(--mm-text-muted-on-beige);
}
</style>
