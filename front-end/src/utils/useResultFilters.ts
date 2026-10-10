import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { readResultFilters, type ResultFilterName } from '@/utils/resultFilters';

const FILTER_NAMES: ResultFilterName[] = ['date', 'section', 'tier', 'choice', 'status'];

/**
 * The Result pages' filters, read from and written to the address (E28/F02): a filtered view is a
 * link, so a filter is set by replacing the query, never held in a ref beside it.
 */
export function useResultFilters() {
  const route = useRoute();
  const router = useRouter();

  const filters = computed(() => readResultFilters(route.query));

  function setFilter(name: ResultFilterName, value: string): void {
    const next = { ...route.query };
    if (value) next[name] = value;
    else delete next[name];
    void router.replace({ query: next });
  }

  /** Lets go of every filter, and of nothing else the address holds (an open vendor, say). */
  function clearFilters(): void {
    const next = { ...route.query };
    for (const name of FILTER_NAMES) delete next[name];
    void router.replace({ query: next });
  }

  return { filters, setFilter, clearFilters };
}
