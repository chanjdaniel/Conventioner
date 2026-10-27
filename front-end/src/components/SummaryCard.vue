<script setup lang="ts">
/**
 * One row in a list of things: a name, a fixed column of facts about it, and its actions.
 *
 * The same markup was copied into the markets list, the organizations list, the dashboard card
 * and the market chooser, with the facts laid out *after* the name rather than in a column of
 * their own - so the left edge of "Created:" followed the length of the market's name. Measured
 * down one list it landed at x = 289, 339, 345, 393, 336, 327, 327 and 323.
 *
 * The grid is the whole point: the name column has a fixed share, so every label in a list shares
 * one left edge however long the names are.
 */
import type { SummaryFact } from '@/utils/summary';

defineProps<{
  facts: SummaryFact[];
  /**
   * A whole-row click target. Without it the card is a plain container.
   *
   * The row is a click target for the pointer only. The keyboard and assistive technology reach
   * it through a real button in the name slot, classed `summary-card-open`, whose click bubbles up
   * to the row's: a row that was itself a `role="button"` nested its actions inside a button, and
   * named itself with words that were not the ones on it (WCAG 4.1.2, 2.5.3).
   */
  selectable?: boolean;
}>();

defineEmits<{ select: [] }>();
</script>

<template>
  <div
    class="summary-card"
    :class="{ 'summary-card--selectable': selectable }"
    @click="selectable && $emit('select')"
  >
    <!-- The card is the container its own layout is measured against, so the body is a child of
         it: a container query cannot style the element it measures. -->
    <div class="summary-card-body">
      <div class="summary-card-name">
        <slot name="name" />
        <slot name="badge" />
      </div>

      <dl class="summary-card-facts">
        <template v-for="fact in facts" :key="fact.label">
          <dt>{{ fact.label }}</dt>
          <dd :class="{ 'fact-missing': fact.missing }">{{ fact.value }}</dd>
        </template>
      </dl>

      <!-- Actions stop the row's own click, so pressing one never also opens the row. -->
      <div class="summary-card-actions" @click.stop>
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.summary-card {
  width: 100%;
  padding: 16px 24px;
  border: 1.5px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
  box-shadow: var(--shadow-card);
  container-type: inline-size;
}

/* The name's column is as wide as the facts can spare, and the same on every row so the facts
   line up down the list (bug 14). At 20rem an ordinary name wrapped while the facts beside it sat
   in half their room.

   "Can spare" is the facts' own measure: a 7.5rem label, its gap, and room for the longest date a
   row says ("Dec 30, 2026 - Jan 2, 2027 (4 days)") - 22rem. The name took its whole 28rem
   whatever the card's width, and on the dashboard, where the card is the width of the two buttons
   below it, that left the facts a sliver: every date broke after two or three characters. */
.summary-card-body {
  display: grid;
  grid-template-columns: minmax(200px, 28rem) minmax(22rem, 1fr) auto;
  align-items: center;
  gap: 24px;
}

/* Too narrow for the name and the facts side by side (the market chooser dialog): the facts go
   under the name rather than into a column too thin to read. 37.5rem is the two minimums and the
   gaps between the three columns. */
@container (width < 37.5rem) {
  .summary-card-body {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .summary-card-actions:empty {
    display: none;
  }
}

.summary-card--selectable {
  cursor: pointer;
  transition:
    border-color 0.15s ease-in-out,
    box-shadow 0.15s ease-in-out,
    transform 0.15s ease-in-out;
}

.summary-card--selectable:hover,
.summary-card--selectable:has(.summary-card-name :focus-visible) {
  border-color: var(--mm-green);
  box-shadow: var(--shadow-card);
  transform: translateY(-2px);
}

/* The badge sits at the column's right edge rather than after the name, so badges share an edge
   down the list however long the names are - the same reason the facts are a grid. */
.summary-card-name {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

/* One line, so every card in a list is one height; a name longer than its column is shortened,
   and the slot gives it its whole name as hover text (bug 14). */
.summary-card-name :slotted(h3) {
  margin: 0;
  min-width: 0;
  color: var(--mm-black);
  font-size: var(--text-lg);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The name's own button looks like the name: the card's lift is its focus ring, as it was the
   row's. */
.summary-card-name :slotted(.summary-card-open) {
  display: block;
  max-width: 100%;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  outline: none;
}

/* A fixed label column, so the labels line up across every row of the list and not merely
   within one card. */
.summary-card-facts {
  margin: 0;
  display: grid;
  grid-template-columns: 7.5rem minmax(0, 1fr);
  gap: 8px 12px;
  align-items: baseline;
}

.summary-card-facts dt {
  font-weight: 400;
  color: var(--mm-text-muted);
  font-size: var(--text-xs);
}

.summary-card-facts dd {
  /* Figures in a column need fixed-width digits (E15/F01/S03). Outfit's 0, 1 and 2 are different
     widths, so a right-aligned group shifts by a pixel or two per row and the column reads ragged
     down the list. */
  font-variant-numeric: tabular-nums;
  margin: 0;
  color: var(--mm-black);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.fact-missing {
  color: var(--mm-text-yellow);
}

.summary-card-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
</style>
