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
import { PAGE_LABELS, TAB_PAGES, currentPage, pageOfRoute, tabOf } from '@/utils/marketPage';

const props = defineProps<{ market: Market | null }>();
const route = useRoute();

const here = computed(() => pageOfRoute(route.name, route.params));
const pages = computed(() => (here.value ? TAB_PAGES[tabOf(here.value)] : []));
const current = computed(() =>
  currentPage(
    props.market?.phase,
    (props.market?.assignmentObject?.vendorAssignments?.length ?? 0) > 0,
  ),
);
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
      :to="marketPath(market.id, page)"
      class="market-page"
      :class="{ active: here === page, current: current === page }"
      :aria-current="here === page ? 'page' : undefined"
      :data-testid="`market-pages-${page}`"
    >
      {{ PAGE_LABELS[page] }}
    </RouterLink>
  </nav>
</template>

<style scoped>
/* A quieter second row than the bar's tabs: pages of one tab, not places of their own. */
.market-pages {
  display: flex;
  gap: var(--space-1);
  padding: var(--space-2) 20px;
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

.market-page.current::after {
  content: '';
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-left: var(--space-2);
  vertical-align: middle;
  border-radius: var(--radius-pill);
  background: var(--mm-green);
}
</style>
