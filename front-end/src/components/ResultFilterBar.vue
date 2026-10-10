<script setup lang="ts">
/**
 * The Result pages' filter bar: date, section, tier and table size, with a chip for each filter
 * that is set (E28/F02/S02).
 *
 * One bar for the tables and the vendors, under the same address keys, so the two pages filter
 * alike and a filter set on one is still set on the other. Every filter lives in the address,
 * which is why this writes the route rather than emitting: a filtered view is a link. What the
 * filters MEAN on each page is `utils/resultFilters.ts`'s.
 */
import { useRoute, useRouter } from 'vue-router';
import { getFormattedDate } from '@/utils/utils';
import type { ResultFilterName, ResultFilters } from '@/utils/resultFilters';

const props = defineProps<{
  filters: ResultFilters;
  options: { dates: string[]; sections: string[]; tiers: string[] };
  /** The page's testid prefix: `tables` or `vendors`. */
  testid: string;
}>();

const route = useRoute();
const router = useRouter();

const FILTER_NAMES: ResultFilterName[] = ['date', 'section', 'tier', 'choice', 'status'];

function formatDate(date: string): string {
  return getFormattedDate(date) ?? date;
}

const CHOICE_LABELS = { full: 'Full Tables', half: 'Half Tables' } as const;

function setFilter(name: ResultFilterName, value: string): void {
  const next = { ...route.query };
  if (value) next[name] = value;
  else delete next[name];
  void router.replace({ query: next });
}

/** Lets go of every filter, and of nothing else the address holds (an open vendor, say). */
function clearAll(): void {
  const next = { ...route.query };
  for (const name of FILTER_NAMES) delete next[name];
  void router.replace({ query: next });
}

const anySet = () => FILTER_NAMES.some((name) => props.filters[name]);
</script>

<template>
  <div class="filter-bar" :data-testid="`${testid}-filter-bar`">
    <div class="filter-pickers">
      <label class="filter-picker">
        <span class="filter-picker-label">Date</span>
        <select
          :value="filters.date"
          :data-testid="`${testid}-filter-date`"
          @change="setFilter('date', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">All dates</option>
          <option v-for="option in options.dates" :key="option" :value="option">
            {{ formatDate(option) }}
          </option>
        </select>
      </label>
      <label class="filter-picker">
        <span class="filter-picker-label">Section</span>
        <select
          :value="filters.section"
          :data-testid="`${testid}-filter-section`"
          @change="setFilter('section', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">All sections</option>
          <option v-for="option in options.sections" :key="option" :value="option">
            {{ option }}
          </option>
        </select>
      </label>
      <!-- A market planned without tiers has nothing to filter by tier (bug 23). -->
      <label v-if="options.tiers.length" class="filter-picker">
        <span class="filter-picker-label">Tier</span>
        <select
          :value="filters.tier"
          :data-testid="`${testid}-filter-tier`"
          @change="setFilter('tier', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">All tiers</option>
          <option v-for="option in options.tiers" :key="option" :value="option">
            {{ option }}
          </option>
        </select>
      </label>
      <label class="filter-picker">
        <span class="filter-picker-label">Table</span>
        <select
          :value="filters.choice"
          :data-testid="`${testid}-filter-choice`"
          @change="setFilter('choice', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">Any size</option>
          <option value="full">Full Tables</option>
          <option value="half">Half Tables</option>
        </select>
      </label>
    </div>

    <div v-if="anySet()" class="filter-chips">
      <span class="filter-chips-label">Filters:</span>
      <button
        v-if="filters.date"
        type="button"
        class="filter-chip"
        :data-testid="`${testid}-filter-chip-date`"
        @click="setFilter('date', '')"
      >
        Date: {{ formatDate(filters.date) }}
        <span class="filter-chip-close" aria-hidden="true">×</span>
        <span class="visually-hidden">Remove date filter</span>
      </button>
      <button
        v-if="filters.section"
        type="button"
        class="filter-chip"
        :data-testid="`${testid}-filter-chip-section`"
        @click="setFilter('section', '')"
      >
        Section: {{ filters.section }}
        <span class="filter-chip-close" aria-hidden="true">×</span>
        <span class="visually-hidden">Remove section filter</span>
      </button>
      <button
        v-if="filters.tier"
        type="button"
        class="filter-chip"
        :data-testid="`${testid}-filter-chip-tier`"
        @click="setFilter('tier', '')"
      >
        Tier: {{ filters.tier }}
        <span class="filter-chip-close" aria-hidden="true">×</span>
        <span class="visually-hidden">Remove tier filter</span>
      </button>
      <button
        v-if="filters.choice"
        type="button"
        class="filter-chip"
        :data-testid="`${testid}-filter-chip-choice`"
        @click="setFilter('choice', '')"
      >
        {{ CHOICE_LABELS[filters.choice] }}
        <span class="filter-chip-close" aria-hidden="true">×</span>
        <span class="visually-hidden">Remove choice filter</span>
      </button>
      <button
        v-if="filters.status"
        type="button"
        class="filter-chip"
        :data-testid="`${testid}-filter-chip-status`"
        @click="setFilter('status', '')"
      >
        Status: {{ filters.status }}
        <span class="filter-chip-close" aria-hidden="true">×</span>
        <span class="visually-hidden">Remove status filter</span>
      </button>
      <button
        type="button"
        class="filter-chip filter-chip--clear-all"
        :data-testid="`${testid}-filter-chip-clear-all`"
        @click="clearAll"
      >
        Clear all
      </button>
    </div>

    <slot />
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.filter-pickers {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.filter-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.filter-picker-label {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.filter-picker select {
  padding: 6px 8px;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
  font-size: var(--text-xs);
  color: var(--mm-black);
  max-width: 100%;
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.filter-chips-label {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background-color: var(--mm-beige);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  color: var(--mm-black);
  cursor: pointer;
  transition:
    background-color 0.12s ease-in-out,
    border-color 0.12s ease-in-out;
}

.filter-chip:hover {
  background-color: white;
  border-color: var(--mm-green);
}

.filter-chip:focus-visible {
  outline: 2px solid var(--mm-green);
  outline-offset: 2px;
}

.filter-chip-close {
  font-size: var(--text-md);
  line-height: 1;
  color: var(--mm-black);
  font-weight: 600;
}

.filter-chip--clear-all {
  background-color: white;
  border-style: dashed;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
