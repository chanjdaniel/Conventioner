<script setup lang="ts">
/**
 * The counts behind the Result page's strip, in an inline panel under it (E22/F04/S05).
 *
 * Per date, section, tier and table choice - what the old results page laid out as cards. A panel
 * and not a dialog: `AppDialog` is one small job (AGENTS.md, Dialogs), and this is reading, with
 * the grid it describes still in view beneath it. A count that names a date, a section, a tier or a
 * table choice filters that grid to it, in the address, so Back undoes it.
 */
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { AssignmentStatistics } from '@/assets/types/datatypes';
import { getShortDate } from '@/utils/utils';

const props = defineProps<{ statistics: AssignmentStatistics }>();
const route = useRoute();
const router = useRouter();

type Filter = 'date' | 'section' | 'tier' | 'choice';

interface Count {
  label: string;
  value: string;
  count: number;
}

/**
 * Half tables are one table choice to the organizer, whichever side they sit on, so the sides the
 * statistics count separately are added together - and the grid's filter knows them as `half`.
 */
const tableChoices = computed((): Count[] => {
  const merged = new Map<string, Count>();
  for (const [choice, count] of Object.entries(props.statistics.assignmentsPerTableChoice ?? {})) {
    const half = choice.toLowerCase().includes('half');
    const key = half ? 'half' : 'full';
    const entry = merged.get(key) ?? { label: half ? 'Half Table' : choice, value: key, count: 0 };
    entry.count += count;
    merged.set(key, entry);
  }
  return [...merged.values()];
});

const groups = computed((): Array<{ title: string; filter: Filter; counts: Count[] }> => [
  {
    title: 'Per Date',
    filter: 'date',
    counts: Object.entries(props.statistics.assignmentsPerDate ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ label: getShortDate(date), value: date, count })),
  },
  {
    title: 'Per Section',
    filter: 'section',
    counts: Object.entries(props.statistics.assignmentsPerSection ?? {}).map(([name, count]) => ({
      label: name,
      value: name,
      count,
    })),
  },
  {
    title: 'Per Tier',
    filter: 'tier',
    counts: Object.entries(props.statistics.assignmentsPerTier ?? {}).map(([name, count]) => ({
      label: name,
      value: name,
      count,
    })),
  },
  { title: 'Per Table Choice', filter: 'choice', counts: tableChoices.value },
]);

function filterTo(filter: Filter, value: string): void {
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
    <div v-for="group in groups" :key="group.filter" class="result-statistics-group">
      <h3>{{ group.title }}</h3>
      <p v-if="!group.counts.length" class="result-statistics-none">None.</p>
      <ul v-else>
        <li v-for="entry in group.counts" :key="entry.value">
          <button
            type="button"
            class="result-statistics-item"
            :data-testid="`result-statistics-${group.filter}`"
            :data-value="entry.value"
            @click="filterTo(group.filter, entry.value)"
          >
            <span>{{ entry.label }}</span>
            <span class="result-statistics-count">{{ entry.count }}</span>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.result-statistics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
}

.result-statistics-total {
  grid-column: 1 / -1;
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.result-statistics-group h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
}

.result-statistics-group ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.result-statistics-item {
  width: 100%;
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-control);
  background: none;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--mm-black);
  text-align: left;
  cursor: pointer;
}

.result-statistics-item:hover {
  background: var(--mm-beige);
}

.result-statistics-count {
  font-weight: 600;
}

.result-statistics-none {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
