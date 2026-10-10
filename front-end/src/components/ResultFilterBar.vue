<script setup lang="ts">
/**
 * The Result pages' filter bar: date, section, tier and table size, with a chip for each filter
 * that is set (E28/F02/S02).
 *
 * One bar for the tables and the vendors, under the same address keys, so the two pages filter
 * alike and a filter set on one is still set on the other. Each page says which filters it offers
 * (`filtersBeside`): a filter it does not offer draws neither a picker nor a chip, so nothing on
 * screen claims to narrow a list it does not. What the filters MEAN is `utils/resultFilters.ts`'s.
 */
import { computed } from 'vue';
import { getFormattedDate } from '@/utils/utils';
import { useResultFilters } from '@/utils/useResultFilters';
import type { FilterOptions, ResultFilterName } from '@/utils/resultFilters';

const props = defineProps<{
  options: FilterOptions;
  offered: ResultFilterName[];
  /** The page's testid prefix: `tables` or `vendors`. */
  testid: string;
}>();

const { filters, setFilter, clearFilters } = useResultFilters();

const offers = (name: ResultFilterName) => props.offered.includes(name);

const formatDate = (date: string) => getFormattedDate(date) ?? date;

const CHOICE_LABELS: Record<string, string> = { full: 'Full Tables', half: 'Half Tables' };

/** One chip per filter that is set and offered, each saying what it narrows to. */
const chips = computed(() => {
  const f = filters.value;
  const all: Array<{ name: ResultFilterName; text: string; what: string }> = [
    { name: 'date', text: `Date: ${formatDate(f.date)}`, what: 'date' },
    { name: 'section', text: `Section: ${f.section}`, what: 'section' },
    { name: 'tier', text: `Tier: ${f.tier}`, what: 'tier' },
    { name: 'choice', text: CHOICE_LABELS[f.choice] ?? '', what: 'table size' },
    { name: 'status', text: `Status: ${f.status}`, what: 'status' },
  ];
  return all.filter((chip) => f[chip.name] && offers(chip.name));
});
</script>

<template>
  <div class="filter-bar" :data-testid="`${testid}-filter-bar`">
    <div class="filter-pickers">
      <label v-if="offers('date')" class="filter-picker">
        <span class="field-label">Date</span>
        <select
          class="field field--select"
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
      <label v-if="offers('section')" class="filter-picker">
        <span class="field-label">Section</span>
        <select
          class="field field--select"
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
      <label v-if="offers('tier') && options.tiers.length" class="filter-picker">
        <span class="field-label">Tier</span>
        <select
          class="field field--select"
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
      <label v-if="offers('choice')" class="filter-picker">
        <span class="field-label">Table</span>
        <select
          class="field field--select"
          :value="filters.choice"
          :data-testid="`${testid}-filter-choice`"
          @change="setFilter('choice', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">Any size</option>
          <option value="full">{{ CHOICE_LABELS.full }}</option>
          <option value="half">{{ CHOICE_LABELS.half }}</option>
        </select>
      </label>
    </div>

    <div v-if="chips.length" class="filter-chips">
      <span class="filter-chips-label">Filters:</span>
      <button
        v-for="chip in chips"
        :key="chip.name"
        type="button"
        class="filter-chip"
        :data-testid="`${testid}-filter-chip-${chip.name}`"
        @click="setFilter(chip.name, '')"
      >
        {{ chip.text }}
        <span class="filter-chip-close" aria-hidden="true">×</span>
        <span class="visually-hidden">Remove {{ chip.what }} filter</span>
      </button>
      <button
        type="button"
        class="filter-chip filter-chip--clear-all"
        :data-testid="`${testid}-filter-chip-clear-all`"
        @click="clearFilters"
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
  gap: var(--space-3);
}

.filter-pickers {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.filter-picker {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.filter-chips-label {
  font-size: var(--text-sm);
  color: var(--mm-black);
}

/* A chip that removes its filter: a button, so it is not the label-only `.chip`. */
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  background-color: var(--mm-beige);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-pill);
  font-family: inherit;
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
  outline: 2px solid var(--mm-black);
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
</style>
