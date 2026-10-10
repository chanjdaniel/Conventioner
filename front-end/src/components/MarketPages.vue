<script setup lang="ts">
/**
 * The pages of the open tab, when it has more than one (E22/F04/S03).
 *
 * Only the Assignment tab does: Assignment (the rules and the run), Result (the assignment by table)
 * and Vendors (the assignment by vendor). The row sits under the rail and is pinned with the frame,
 * and it is what makes the tab and its first page - both called Assignment, the organizers' word -
 * read as "the tab, and its first page" rather than as a stutter. The dot marks the page the market
 * is worked on in its phase, as the bar's does for tabs.
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import type { Market } from '@/assets/types/datatypes';
import { marketPath } from '@/utils/market';
import { placeFilterQuery } from '@/utils/resultFilters';
import {
  PAGE_LABELS,
  TAB_PAGES,
  currentPage,
  hasAssignment,
  pageOfRoute,
  tabOf,
  type MarketPage,
} from '@/utils/marketPage';

const props = defineProps<{ market: Market | null }>();
const route = useRoute();

const here = computed(() => pageOfRoute(route.name, route.params));
const pages = computed(() => (here.value ? TAB_PAGES[tabOf(here.value)] : []));
const current = computed(() => currentPage(props.market?.phase, hasAssignment(props.market)));

/** The two pages that read the assignment through the same filters (E28/F02/S02). */
const FILTERED_PAGES: readonly MarketPage[] = ['result', 'vendors'];

/**
 * Where a page link goes. Between Result and Vendors it keeps the day, section, tier and table
 * size in view, so moving from who-is-at-which-table to who-is-where does not lose the question.
 */
function linkTo(marketId: string, page: MarketPage) {
  const path = marketPath(marketId, page);
  const carries =
    FILTERED_PAGES.includes(here.value as MarketPage) && FILTERED_PAGES.includes(page);
  return carries ? { path, query: placeFilterQuery(route.query) } : path;
}
</script>

<template>
  <nav
    v-if="market && pages.length > 1"
    class="market-pages"
    aria-label="Pages"
    data-testid="market-pages"
  >
    <RouterLink
      v-for="page in pages"
      :key="page"
      :to="linkTo(market.id, page)"
      class="market-page"
      :class="{ active: here === page, current: current === page }"
      :aria-current="here === page ? 'page' : undefined"
      :data-testid="`market-pages-${page}`"
    >
      {{ PAGE_LABELS[page] }}<span v-if="current === page" class="current-dot" aria-hidden="true" />
    </RouterLink>
  </nav>
</template>

<style scoped>
/* A quieter second row than the bar's tabs: pages of one tab, not places of their own. */
.market-pages {
  display: flex;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-6);
  border-bottom: 1px solid var(--mm-border);
  background-color: white;
}

.market-page {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  text-decoration: none;
}

.market-page:hover {
  color: var(--mm-black);
  background: var(--mm-beige);
}

.market-page.active {
  color: var(--mm-black);
  background: var(--mm-beige);
  font-weight: 600;
}

/* The current mark (E28/F04/S02): raised so its centre is the middle of the label's capitals - half
   the cap height above the baseline, less half its own height. `cap` is the label's own font, so it
   holds at any type size; `vertical-align: middle` centred it on the lower-case letters instead. */
.current-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-left: var(--space-2);
  vertical-align: calc(0.5cap - 2.5px);
  border-radius: var(--radius-pill);
  background: var(--mm-green);
}
</style>
