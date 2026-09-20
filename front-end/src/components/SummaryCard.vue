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
  /** A whole-row click target. Without it the card is a plain container. */
  selectable?: boolean;
  selectLabel?: string;
}>();

defineEmits<{ select: [] }>();
</script>

<template>
  <div
    class="summary-card"
    :class="{ 'summary-card--selectable': selectable }"
    :role="selectable ? 'button' : undefined"
    :tabindex="selectable ? 0 : undefined"
    :aria-label="selectable ? selectLabel : undefined"
    @click="selectable && $emit('select')"
    @keydown.enter.prevent="selectable && $emit('select')"
    @keydown.space.prevent="selectable && $emit('select')"
  >
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
</template>

<style scoped>
.summary-card {
  width: 100%;
  padding: 16px 24px;
  border: 1.5px solid var(--mm-border);
  border-radius: 10px;
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);

  display: grid;
  grid-template-columns: minmax(200px, 20rem) minmax(0, 1fr) auto;
  align-items: center;
  gap: 24px;
}

.summary-card--selectable {
  cursor: pointer;
  transition:
    border-color 0.15s ease-in-out,
    box-shadow 0.15s ease-in-out,
    transform 0.15s ease-in-out;
}

.summary-card--selectable:hover,
.summary-card--selectable:focus-visible {
  border-color: var(--mm-green);
  box-shadow: 0 4px 12px rgba(73, 176, 150, 0.15);
  transform: translateY(-2px);
  outline: none;
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

.summary-card-name :slotted(h3) {
  margin: 0;
  color: var(--mm-black);
  font-size: 18px;
  font-weight: 600;
  overflow-wrap: anywhere;
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
  font-size: 13px;
}

.summary-card-facts dd {
  /* Figures in a column need fixed-width digits (E15/F01/S03). Outfit's 0, 1 and 2 are different
     widths, so a right-aligned group shifts by a pixel or two per row and the column reads ragged
     down the list. */
  font-variant-numeric: tabular-nums;
  margin: 0;
  color: var(--mm-black);
  font-size: 14px;
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
