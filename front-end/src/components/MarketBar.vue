<script setup lang="ts">
/**
 * The market's bar: its name and its tabs, on every market page (E22/F04/S02).
 *
 * Rendered once, by `MarketFrame`, rather than by each screen: Tables, Vendors and Attendance used
 * to draw a title of their own ("Tables: <name>") with no tabs, so moving between a market's
 * screens was two kinds of navigation. Every page is reached the same way now.
 *
 * Two marks, for two ideas: the underline is the tab you are looking at, and the dot is the tab the
 * market is worked on in its phase - so the bar and the rail beneath it say the same thing about
 * where the market is. A tab opens the page carrying the dot when it holds it (`pageForTab`).
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import type { Market } from '@/assets/types/datatypes';
import { marketPath } from '@/utils/market';
import {
  TAB_LABELS,
  currentPage,
  hasAssignment,
  pageForTab,
  pageOfRoute,
  tabOf,
  tabsFor,
  type MarketTab,
} from '@/utils/marketPage';

const props = defineProps<{ market: Market | null }>();
const route = useRoute();

/** The page or flow this route is, read off the route rather than told by each screen. */
const here = computed(() => pageOfRoute(route.name, route.params));

const assigned = computed(() => hasAssignment(props.market));
const current = computed(() => currentPage(props.market?.phase, assigned.value));
const activeTab = computed(() => (here.value ? tabOf(here.value) : null));

/** Attendance once the market is published, and only then. */
const tabs = computed((): MarketTab[] => tabsFor(props.market?.phase));

function linkFor(tab: MarketTab): string {
  return marketPath(props.market!.id, pageForTab(tab, props.market?.phase, assigned.value));
}
</script>

<template>
  <div class="market-bar" data-testid="market-bar">
    <template v-if="market">
      <!-- The market's own name, whole wherever it fits beside the tabs (E22/F04/S01). -->
      <h1 class="market-bar-title" data-testid="market-bar-title" :title="market.name">
        {{ market.name }}
      </h1>
      <nav class="market-bar-tabs" aria-label="Market">
        <RouterLink
          v-for="tab in tabs"
          :key="tab"
          :to="linkFor(tab)"
          class="market-bar-tab"
          :class="{ active: activeTab === tab, current: tabOf(current) === tab }"
          :aria-current="tabOf(current) === tab ? 'step' : undefined"
          :data-testid="`market-bar-tab-${tab}`"
        >
          {{ TAB_LABELS[tab] }}
        </RouterLink>
      </nav>
    </template>
  </div>
</template>

<style scoped>
.market-bar {
  align-self: stretch;
  height: 50px;
  background-color: var(--mm-black);
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  /* The rail's own inset, so the name and the rail's first stage line up. */
  padding: 0 var(--space-6);
}

/* Whole wherever it fits beside the tabs; ellipsed, with the full name on hover, only where it does
   not. The tabs never give way to it. */
.market-bar-title {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-2xl);
  color: white;
}

.market-bar-tabs {
  flex-shrink: 0;
  display: flex;
  flex-direction: row;
  gap: var(--space-hairline);
}

.market-bar-tab {
  padding: var(--space-2) var(--space-4);
  border-bottom: 2px solid transparent;
  font-size: var(--text-sm);
  color: var(--mm-text-muted-on-dark);
  text-decoration: none;
  transition:
    color 0.15s,
    border-color 0.15s;
}

.market-bar-tab:hover {
  color: var(--mm-text-hover-on-dark);
}

.market-bar-tab.active {
  color: white;
  border-bottom-color: var(--mm-green);
}

/*
 * Where the market IS, as against which tab is open (E18/F02/S02). A dot rather than a second
 * underline: the underline already means "you are looking at this", and two treatments for two
 * ideas on one control is how a bar stops being readable.
 */
.market-bar-tab.current::after {
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
