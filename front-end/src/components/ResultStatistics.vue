<script setup lang="ts">
/**
 * The counts behind the Result page's strip, in an inline panel under it (E22/F04/S05).
 *
 * A ledger of bars (E35/F03/S01): a card per question - date, section, tier, table size - and in
 * each a row per answer with its count, its share of all placements, and a bar against the largest
 * in its card (`BarLedger`). It was a plain list of numbers, right but read one at a time. A panel
 * and not a dialog: `AppDialog` is one small job, and this is reading, with the grid it describes
 * still in view beneath it. A row filters that grid to its answer, in the address, so Back undoes
 * it.
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import type { AssignmentStatistics } from '@/assets/types/datatypes';
import { statisticsLedger } from '@/utils/resultStatistics';
import BarLedger from '@/components/BarLedger.vue';

const props = defineProps<{ statistics: AssignmentStatistics }>();
const route = useRoute();

/** Each row leads to the grid filtered to its answer, the page's other filters kept. */
const groups = computed(() =>
  statisticsLedger(props.statistics).map((group) => ({
    ...group,
    rows: group.rows.map((row) => ({
      ...row,
      to: { query: { ...route.query, [group.filter]: row.value } },
    })),
  })),
);
</script>

<template>
  <section class="result-statistics" data-testid="result-statistics" aria-label="Statistics">
    <p class="result-statistics-total" data-testid="result-statistics-total">
      <strong>{{ statistics.totalAssignments }}</strong>
      {{ statistics.totalAssignments === 1 ? 'placement' : 'placements' }} in all, one per vendor
      per date
    </p>
    <div class="result-statistics-groups">
      <BarLedger
        v-for="group in groups"
        :key="group.filter"
        :title="group.title"
        :rows="group.rows"
        :testid="`result-statistics-${group.filter}`"
        whole="placements"
        action="Show these tables"
      />
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
</style>
