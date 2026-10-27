<script setup lang="ts">
/**
 * The counts behind the Result page's strip, in an inline panel under it (E22/F04/S05).
 *
 * A ledger of bars (E35/F03/S01): a card per question - date, section, tier, table size - and in
 * each a row per answer with its count, its share of all placements, and a bar against the largest
 * in its card. It was a plain list of numbers, right but read one at a time. A panel and not a
 * dialog: `AppDialog` is one small job, and this is reading, with the grid it describes still in
 * view beneath it. A row filters that grid to its answer, in the address, so Back undoes it.
 */
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { AssignmentStatistics } from '@/assets/types/datatypes';
import { statisticsLedger, type LedgerFilter } from '@/utils/resultStatistics';

const props = defineProps<{ statistics: AssignmentStatistics }>();
const route = useRoute();
const router = useRouter();

const groups = computed(() => statisticsLedger(props.statistics));

function filterTo(filter: LedgerFilter, value: string): void {
  void router.push({ query: { ...route.query, [filter]: value } });
}
</script>

<template>
  <section class="result-statistics" data-testid="result-statistics" aria-label="Statistics">
    <p class="result-statistics-total" data-testid="result-statistics-total">
      <strong>{{ statistics.totalAssignments }}</strong>
      {{ statistics.totalAssignments === 1 ? 'placement' : 'placements' }} in all, one per vendor
      per date
    </p>
    <div class="result-statistics-groups">
      <div v-for="group in groups" :key="group.filter" class="result-statistics-group">
        <h3>{{ group.title }}</h3>
        <p v-if="!group.rows.length" class="result-statistics-none">None.</p>
        <ul v-else>
          <li v-for="row in group.rows" :key="row.value">
            <!-- Named by the words it shows, with the rest hidden between them: an
                 `aria-label` replaced what a voice user sees with words they do not
                 (WCAG 2.5.3). -->
            <button
              type="button"
              class="result-statistics-item"
              :data-testid="`result-statistics-${group.filter}`"
              :data-value="row.value"
              @click="filterTo(group.filter, row.value)"
            >
              <span class="result-statistics-label"
                >{{ row.label }}<span class="visually-hidden">: </span></span
              >
              <span class="result-statistics-count"
                >{{ row.count }}<span class="visually-hidden">, </span
                ><span class="result-statistics-share">{{ row.share }}%</span
                ><span class="visually-hidden"> of placements. Show these tables</span></span
              >
              <span class="result-statistics-bar" aria-hidden="true">
                <span :style="{ width: `${row.bar}%` }" />
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<style scoped>
.result-statistics {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.result-statistics-total {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.result-statistics-total strong {
  font-size: var(--text-lg);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.result-statistics-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--space-4);
}

.result-statistics-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
}

.result-statistics-group h3 {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-text-muted);
}

.result-statistics-group ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

/* The count, its share, and a bar under both: the whole row is the control that filters. */
.result-statistics-item {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: none;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--mm-black);
  text-align: left;
  cursor: pointer;
}

.result-statistics-item:hover {
  border-color: var(--mm-border);
  background: var(--mm-beige);
}

.result-statistics-item:focus-visible {
  outline: 2px solid var(--mm-black);
  outline-offset: 1px;
}

.result-statistics-label {
  overflow-wrap: anywhere;
}

.result-statistics-count {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.result-statistics-share {
  margin-left: var(--space-2);
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--mm-text-muted);
}

/* On the beige of a hovered row the muted ink is the beige one, which holds AA there. */
.result-statistics-item:hover .result-statistics-share {
  color: var(--mm-text-muted-on-beige);
}

.result-statistics-bar {
  grid-column: 1 / -1;
  height: var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--mm-beige);
  overflow: hidden;
}

.result-statistics-item:hover .result-statistics-bar {
  background: var(--mm-border);
}

.result-statistics-bar > span {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--mm-green);
}

.result-statistics-none {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
