<script setup lang="ts">
/**
 * A card of the ledger of bars (E35/F03/S01): a title, and a row per answer with its count, its
 * share of the whole and a bar against the largest in the card (`utils/barLedger.ts`).
 *
 * The Assignments page's statistics drew these cards themselves; the Stats tab reads with them too
 * (E45/F01/S01), so the two say a count the same way. A row that leads somewhere is a link to it -
 * the tables filtered to its answer, the applications with its status - and one that leads nowhere
 * is only read.
 */
import { RouterLink } from 'vue-router';
import type { LedgerRow } from '@/utils/barLedger';

const props = defineProps<{
  title: string;
  rows: LedgerRow[];
  /** Each row's `data-testid`. */
  testid: string;
  /** What a share is of, in a screen reader's words: "placements", "applications". */
  whole: string;
  /** What choosing a row does, in a screen reader's words: "Show these tables". */
  action?: string;
}>();

/** What follows the share for a screen reader: what it is of, and what the row does. */
function tail(row: LedgerRow): string {
  return ` of ${props.whole}${row.to && props.action ? `. ${props.action}` : ''}`;
}
</script>

<template>
  <div class="bar-ledger">
    <h3>{{ title }}</h3>
    <p v-if="!rows.length" class="bar-ledger-none">None.</p>
    <ul v-else>
      <li v-for="row in rows" :key="row.value">
        <!-- Named by the words it shows, with the rest hidden between them: an `aria-label`
             replaced what a voice user sees with words they do not (WCAG 2.5.3). -->
        <component
          :is="row.to ? RouterLink : 'div'"
          :to="row.to"
          class="bar-ledger-row"
          :class="{ 'bar-ledger-row--link': row.to }"
          :data-testid="testid"
          :data-value="row.value"
        >
          <span class="bar-ledger-label"
            >{{ row.label }}<span class="visually-hidden">: </span></span
          >
          <span class="bar-ledger-count"
            ><span class="bar-ledger-number" :data-testid="`${testid}-count`">{{ row.count }}</span
            ><span class="visually-hidden">, </span
            ><span class="bar-ledger-share">{{ row.share }}%</span
            ><span class="visually-hidden">{{ tail(row) }}</span></span
          >
          <span class="bar-ledger-bar" aria-hidden="true">
            <span :style="{ width: `${row.bar}%` }" />
          </span>
        </component>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.bar-ledger {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
}

.bar-ledger h3 {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-text-muted);
}

.bar-ledger ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

/* The count, its share, and a bar under both: the whole row is the control, when it leads anywhere. */
.bar-ledger-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  font-size: var(--text-sm);
  color: var(--mm-black);
  text-decoration: none;
  /* A row shows its hover at once, as the button it was did, not with every link's fade. */
  transition: none;
}

.bar-ledger-row--link:hover {
  border-color: var(--mm-border);
  background: var(--mm-beige);
}

.bar-ledger-label {
  overflow-wrap: anywhere;
}

/* Weight does not inherit here (the design language), so the figure carries its own. */
.bar-ledger-number {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.bar-ledger-share {
  margin-left: var(--space-2);
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--mm-text-muted);
}

/* On the beige of a hovered row the muted ink is the beige one, which holds AA there. */
.bar-ledger-row--link:hover .bar-ledger-share {
  color: var(--mm-text-muted-on-beige);
}

.bar-ledger-bar {
  grid-column: 1 / -1;
  height: var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--mm-beige);
  overflow: hidden;
}

.bar-ledger-row--link:hover .bar-ledger-bar {
  background: var(--mm-border);
}

.bar-ledger-bar > span {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--mm-green);
}

.bar-ledger-none {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
