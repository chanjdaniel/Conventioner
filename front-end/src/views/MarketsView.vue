<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { type Market, type MarketPhase, type Organization } from '@/assets/types/datatypes';
import { getApiErrorMessage } from '@/utils/api';
import { fetchMarkets, openMarket } from '@/utils/market';
import { fetchOrganizations } from '@/utils/organizations';
import { phaseLabel } from '@/utils/phase';
import {
  MARKET_SORTS,
  type MarketListQuery,
  type MarketSort,
  PHASES_IN_ORDER,
  localToday,
  marketListQueryFromRoute,
  marketListQueryToRoute,
  viewMarkets,
} from '@/utils/marketList';
import MarketSummaryCard from '@/components/MarketSummaryCard.vue';
import NewMarketOverlay from './NewMarketOverlay.vue';
import ManageMarketOverlay from './ManageMarketOverlay.vue';

const route = useRoute();
const router = useRouter();
const markets = ref<Market[]>([]);
const organizations = ref<Organization[]>([]);
const loading = ref(true);
const errorMessage = ref('');
const newOpen = ref(false);
const manageOpen = ref(false);
const manageMarket = ref<Market | null>(null);

async function loadMarkets() {
  loading.value = true;
  errorMessage.value = '';
  try {
    // Together, so the list is never narrowed by an organization filter that cannot yet be told
    // from a stale one. The organizations only fill the filter: failing to load them leaves the
    // list whole rather than failing the page.
    const [loadedMarkets, loadedOrganizations] = await Promise.all([
      fetchMarkets(),
      fetchOrganizations().catch(() => [] as Organization[]),
    ]);
    markets.value = loadedMarkets;
    organizations.value = [...loadedOrganizations].sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to load markets');
    markets.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadMarkets();
});

/*
 * The page's address holds the search, the filters and the order (E25/F01/S01), so Back from an
 * opened market returns to the same narrowed list. The search box alone is also held locally: the
 * list follows each keystroke at once, not a router round trip later.
 */
const addressed = computed(() =>
  marketListQueryFromRoute(
    route.query,
    organizations.value.map((org) => org.id),
  ),
);
const search = ref(addressed.value.search);
watch(
  () => addressed.value.search,
  (fromAddress) => {
    if (fromAddress !== search.value) search.value = fromAddress;
  },
);

const query = computed<MarketListQuery>(() => ({ ...addressed.value, search: search.value }));

function update(change: Partial<MarketListQuery>) {
  router.replace({ query: marketListQueryToRoute({ ...query.value, ...change }) });
}

watch(search, (text) => {
  if (text !== addressed.value.search) update({ search: text });
});

const shown = computed(() => viewMarkets(markets.value, query.value, localToday()));
const narrowed = computed(
  () =>
    query.value.search.trim() !== '' ||
    !!query.value.organizationId ||
    query.value.phases.length > 0,
);

function togglePhase(phase: MarketPhase) {
  const phases = query.value.phases.includes(phase)
    ? query.value.phases.filter((p) => p !== phase)
    : [...query.value.phases, phase];
  update({ phases });
}

function clearFilters() {
  search.value = '';
  update({ search: '', organizationId: null, phases: [] });
}

function handleOpen(market: Market) {
  openMarket(router, market);
}

function handleManage(market: Market) {
  manageMarket.value = market;
  manageOpen.value = true;
}

function handleManageClose() {
  manageOpen.value = false;
  manageMarket.value = null;
  loadMarkets();
}

function handleNewClose() {
  newOpen.value = false;
  loadMarkets();
}
</script>

<template>
  <div class="markets-view">
    <div class="header">
      <h1>Markets</h1>
      <button class="new-market-button" @click="newOpen = true" data-testid="markets-create-button">
        New market
      </button>
    </div>

    <div class="markets-block">
      <p v-if="loading" class="empty-state">Loading markets...</p>
      <p v-else-if="errorMessage" class="error-state">{{ errorMessage }}</p>
      <p v-else-if="markets.length === 0" class="empty-state">No markets found</p>
      <template v-else>
        <div class="finder" role="search" aria-label="Find a market" data-testid="markets-finder">
          <div class="finder-row">
            <label class="finder-search">
              <span class="field-label">Search</span>
              <input
                v-model="search"
                type="search"
                class="field"
                placeholder="Market name"
                autocomplete="off"
                data-testid="markets-search-input"
              />
            </label>
            <label>
              <span class="field-label">Organization</span>
              <select
                class="field field--select"
                :value="query.organizationId ?? ''"
                data-testid="markets-org-select"
                @change="
                  update({ organizationId: ($event.target as HTMLSelectElement).value || null })
                "
              >
                <option value="">All organizations</option>
                <option v-for="org in organizations" :key="org.id" :value="org.id">
                  {{ org.name }}
                </option>
              </select>
            </label>
            <label>
              <span class="field-label">Sort by</span>
              <select
                class="field field--select"
                :value="query.sort"
                data-testid="markets-sort-select"
                @change="update({ sort: ($event.target as HTMLSelectElement).value as MarketSort })"
              >
                <option v-for="sort in MARKET_SORTS" :key="sort.value" :value="sort.value">
                  {{ sort.label }}
                </option>
              </select>
            </label>
          </div>
          <div class="phase-filter" role="group" aria-labelledby="markets-phase-label">
            <span id="markets-phase-label" class="field-label">Phase</span>
            <div class="phase-toggles">
              <button
                type="button"
                class="btn btn--compact btn--secondary phase-toggle"
                :aria-pressed="query.phases.length === 0"
                data-testid="markets-phase-toggle-all"
                @click="update({ phases: [] })"
              >
                All phases
              </button>
              <button
                v-for="phase in PHASES_IN_ORDER"
                :key="phase"
                type="button"
                class="btn btn--compact btn--secondary phase-toggle"
                :aria-pressed="query.phases.includes(phase)"
                :data-testid="`markets-phase-toggle-${phase}`"
                @click="togglePhase(phase)"
              >
                {{ phaseLabel(phase) }}
              </button>
            </div>
          </div>
        </div>

        <p class="result-count" aria-live="polite" data-testid="markets-result-count">
          <template v-if="narrowed">
            {{ shown.length }} of {{ markets.length }}
            {{ markets.length === 1 ? 'market' : 'markets' }}
          </template>
          <template v-else>
            {{ markets.length }} {{ markets.length === 1 ? 'market' : 'markets' }}
          </template>
        </p>

        <div v-if="shown.length === 0" class="no-match" data-testid="markets-no-match">
          <p class="empty-state">No markets match these filters</p>
          <button
            type="button"
            class="btn btn--secondary"
            data-testid="markets-clear-filters-button"
            @click="clearFilters"
          >
            Clear filters
          </button>
        </div>
        <div v-else class="markets-container">
          <MarketSummaryCard
            v-for="market in shown"
            :key="market.id"
            :market="market"
            showManage
            @open="handleOpen(market)"
            @manage="handleManage(market)"
          />
        </div>
      </template>
    </div>

    <NewMarketOverlay @newClose="handleNewClose" :newOpen="newOpen" />
    <ManageMarketOverlay
      :manageOpen="manageOpen"
      :market="manageMarket"
      @manageClose="handleManageClose"
    />
  </div>
</template>

<style scoped>
/* A list column of the list width, centred, growing to its content while the page scrolls
   (E16/F03). It was full-bleed, which is how a market name came to be capped at 320px inside an
   1840px row with 1,455px of the row left empty. */
.markets-view {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: var(--list-max);
  margin: 0 auto;
  padding: 32px 40px;
}

.header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--mm-border);
}

.header h1 {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--mm-black);
}

.new-market-button {
  padding: 10px 24px;
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: var(--radius-control);
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 400;
  box-shadow: var(--shadow-card);
}

.new-market-button:hover {
  background: var(--mm-green);
  opacity: 0.9;
  box-shadow: var(--shadow-card);
}

.markets-block {
  padding-top: 24px;
}

.empty-state,
.error-state {
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.error-state {
  color: var(--mm-red);
}

/* The finder: search, organization and sort on one row that wraps at phone width, the phase
   toggles under it. Every control is a primitive; all this decides is where they sit. */
.finder {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.finder-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.finder-search {
  flex: 1 1 240px;
  min-width: 0;
}

.phase-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* A pressed toggle is filled, so which phases are on reads at a glance - the same fill and ink as
   a primary button, which is already measured for contrast. */
.phase-toggle[aria-pressed='true'] {
  background: var(--mm-green);
  border-color: var(--mm-green);
  color: white;
  font-weight: 600;
}

.result-count {
  margin: var(--space-4) 0 var(--space-3);
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.no-match {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
}

.no-match .empty-state {
  margin: 0;
}

.markets-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Scrollbar styling */
.markets-block::-webkit-scrollbar {
  width: 8px;
}

.markets-block::-webkit-scrollbar-track {
  background: var(--mm-beige);
  border-radius: var(--radius-control);
}

.markets-block::-webkit-scrollbar-thumb {
  background: var(--mm-border);
  border-radius: var(--radius-control);
}

.markets-block::-webkit-scrollbar-thumb:hover {
  background: var(--mm-text-muted);
}
</style>
