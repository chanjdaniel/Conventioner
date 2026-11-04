<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MarketPhase, type Market, type Organization } from '@/assets/types/datatypes';
import { getApiErrorMessage } from '@/utils/api';
import { fetchMarkets, openMarket } from '@/utils/market';
import { forgetLastMarket, lastMarketId } from '@/utils/lastMarket';
import { fetchOrganizations } from '@/utils/organizations';
import { phaseLabel } from '@/utils/phase';
import {
  FILTERABLE_PHASES,
  MARKET_SORTS,
  type MarketListQuery,
  type MarketSort,
  localToday,
  marketListQueryFromRoute,
  marketListQueryToRoute,
  viewMarkets,
} from '@/utils/marketList';
import MarketSummaryCard from '@/components/MarketSummaryCard.vue';
import PhaseBadge from '@/components/PhaseBadge.vue';
import ReadFailed from '@/components/ReadFailed.vue';
import IconExpandDown from '@/components/icons/IconExpandDown.vue';
import NewMarketOverlay from './NewMarketOverlay.vue';
import ManageMarketOverlay from './ManageMarketOverlay.vue';

const route = useRoute();
const router = useRouter();
const markets = ref<Market[]>([]);
const organizations = ref<Organization[]>([]);
/** False while they are loading, or when they failed to: an organization filter cannot then be
 * told from a stale one, so the address's is kept rather than dropped (see `queryFromAddress`). */
const organizationsLoaded = ref(false);
const organizationIds = computed(() => organizations.value.map((org) => org.id));
/** The viewer's calendar day, re-read on every load, which splits upcoming markets from past. */
const today = ref(localToday());
const loading = ref(true);
const errorMessage = ref('');
const newOpen = ref(false);
const manageOpen = ref(false);
const manageMarket = ref<Market | null>(null);

/**
 * Which market this browser last opened: an id, never a copy (E21/F02/S05). What that market is
 * called now, and whether it still exists for this account, is the server's to say.
 */
const rememberedId = ref(lastMarketId());
/**
 * Whether this account is known to have had a market, so "You have not set up a market yet" is
 * never said to someone who has. Asked of the server's answers and the pointer, since a browser
 * that opened none says nothing of the account (E14/F01/S02).
 */
const hadAMarket = ref(rememberedId.value !== null);
/** Whether the page's first answer found the remembered market gone. */
const rememberedIsGone = ref(false);
let answered = false;

/**
 * Takes the first successful answer as the news that a remembered market has gone, said once and
 * then forgotten, so the next visit is silent. A later answer drops the line with no note, since
 * the organizer may just have deleted that market in Manage on this page.
 */
function readTheAnswer(loaded: Market[]) {
  const firstAnswer = !answered;
  answered = true;
  if (loaded.length > 0) hadAMarket.value = true;
  if (rememberedId.value === null || loaded.some((m) => m.id === rememberedId.value)) return;
  forgetLastMarket();
  rememberedId.value = null;
  rememberedIsGone.value = firstAnswer;
}

/** The line above the finder, which the list's own filters do not touch. */
const previouslyOpened = computed(() =>
  markets.value.length > 1
    ? (markets.value.find((m) => m.id === rememberedId.value) ?? null)
    : null,
);
/**
 * The note's words, which follow the list as it is re-read. There are none while the page shows no
 * answer: a re-read that keeps the list keeps the note too, so nothing moves under the organizer.
 */
const goneNote = computed(() => {
  const noAnswer = errorMessage.value || (loading.value && markets.value.length === 0);
  if (!rememberedIsGone.value || noAnswer) return null;
  return markets.value.length > 0
    ? 'The market you last opened is no longer available. Your other markets are still here.'
    : 'The market you last opened is no longer available, and there are no others.';
});

async function loadMarkets() {
  loading.value = true;
  errorMessage.value = '';
  today.value = localToday();
  try {
    // Together, so the list is never shown narrowed by an organization filter that cannot yet be
    // judged. The organizations only fill the filter: failing to load them leaves the list whole
    // rather than failing the page.
    const [loadedMarkets, loadedOrganizations] = await Promise.all([
      fetchMarkets(),
      fetchOrganizations().then(
        (orgs) => ({ ok: true, orgs }),
        () => ({ ok: false, orgs: [] as Organization[] }),
      ),
    ]);
    readTheAnswer(loadedMarkets);
    markets.value = loadedMarkets;
    organizations.value = [...loadedOrganizations.orgs].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    organizationsLoaded.value = loadedOrganizations.ok;
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'The markets could not be loaded.');
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
 * opened market returns to the same narrowed list.
 *
 * The page works from ONE local copy, `query`, and the address follows it. Each change is a single
 * `router.replace` built from that copy, never from the address: a replace resolves a tick later,
 * so building from the address let a second change in the same tick (Clear filters emptying the
 * search box and the filters together) write back the filters the first had just cleared. The copy
 * is only re-read from the address when the address moves on its own - Back, a link, a reload.
 */
const queryFromAddress = computed(() =>
  marketListQueryFromRoute(route.query, organizationsLoaded.value ? organizationIds.value : null),
);
const query = ref<MarketListQuery>(queryFromAddress.value);
watch(queryFromAddress, (fromAddress) => {
  if (JSON.stringify(fromAddress) !== JSON.stringify(query.value)) query.value = fromAddress;
});

function setQuery(change: Partial<MarketListQuery>) {
  query.value = { ...query.value, ...change };
  router.replace({ query: marketListQueryToRoute(query.value) });
}

const visibleMarkets = computed(() => viewMarkets(markets.value, query.value, today.value));
const narrowed = computed(
  () =>
    query.value.search.trim() !== '' ||
    !!query.value.organizationId ||
    query.value.phases.length > 0,
);
const marketsWord = computed(() => (markets.value.length === 1 ? 'market' : 'markets'));

/**
 * A phase as the filter names it. The list holds markets of both paths, and the stage is Review on
 * a Google Form market and Applications on the other (E38/F04/S01), so its toggle names both.
 */
function filterLabel(phase: MarketPhase): string {
  return phase === MarketPhase.Applications ? 'Applications / Review' : phaseLabel(phase);
}

function togglePhase(phase: MarketPhase) {
  const phases = query.value.phases.includes(phase)
    ? query.value.phases.filter((p) => p !== phase)
    : [...query.value.phases, phase];
  setQuery({ phases });
}

function clearFilters() {
  setQuery({ search: '', organizationId: null, phases: [] });
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
      <!-- With the list, so nothing moves when the answer lands; the finder arrives under it. -->
      <p v-if="goneNote" class="note opening-line" data-testid="markets-last-market-gone">
        {{ goneNote }}
      </p>
      <button
        v-else-if="previouslyOpened"
        type="button"
        class="previously-opened opening-line"
        data-testid="markets-previously-opened"
        @click="handleOpen(previouslyOpened)"
      >
        <span class="previously-opened-label">Previously opened</span>
        <span class="previously-opened-name" :title="previouslyOpened.name">
          {{ previouslyOpened.name }}
        </span>
        <PhaseBadge
          class="previously-opened-phase"
          :phase="previouslyOpened.phase"
          :intake-mode="previouslyOpened.intakeMode"
        />
        <IconExpandDown class="previously-opened-go" aria-hidden="true" />
      </button>

      <!-- Only before the first answer: a re-read after a dialog closes keeps the list and the finder
           on screen, rather than unmounting the control the organizer was using. -->
      <p v-if="loading && markets.length === 0" class="empty-state">Loading markets...</p>
      <ReadFailed
        v-else-if="errorMessage"
        name="markets"
        :message="errorMessage"
        @retry="loadMarkets"
      />
      <!-- "New market" in the header is the step this names, so it carries no button of its own. -->
      <p
        v-else-if="markets.length === 0 && !hadAMarket"
        class="note"
        data-testid="markets-no-market-yet"
      >
        You have not set up a market yet. Every market belongs to an organization - if you are not
        in one yet, create it under <RouterLink to="/organizations">Organizations</RouterLink>
        first.
      </p>
      <p
        v-else-if="markets.length === 0 && !rememberedIsGone"
        class="empty-state"
        data-testid="markets-empty"
      >
        No markets found
      </p>
      <template v-else-if="markets.length > 0">
        <div class="finder" role="search" aria-label="Find a market" data-testid="markets-finder">
          <div class="finder-row">
            <label class="finder-search">
              <span class="field-label">Search</span>
              <input
                :value="query.search"
                type="search"
                name="search"
                class="field"
                placeholder="Market name"
                autocomplete="off"
                data-testid="markets-search-input"
                @input="setQuery({ search: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label>
              <span class="field-label">Organization</span>
              <select
                name="organization"
                autocomplete="off"
                class="field field--select"
                :value="query.organizationId ?? ''"
                data-testid="markets-org-select"
                @change="
                  setQuery({ organizationId: ($event.target as HTMLSelectElement).value || null })
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
                name="sort"
                class="field field--select"
                :value="query.sort"
                data-testid="markets-sort-select"
                @change="
                  setQuery({ sort: ($event.target as HTMLSelectElement).value as MarketSort })
                "
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
                @click="setQuery({ phases: [] })"
              >
                All phases
              </button>
              <button
                v-for="phase in FILTERABLE_PHASES"
                :key="phase"
                type="button"
                class="btn btn--compact btn--secondary phase-toggle"
                :aria-pressed="query.phases.includes(phase)"
                :data-testid="`markets-phase-toggle-${phase}`"
                @click="togglePhase(phase)"
              >
                {{ filterLabel(phase) }}
              </button>
            </div>
          </div>
        </div>

        <p class="result-count" aria-live="polite" data-testid="markets-result-count">
          <template v-if="narrowed">{{ visibleMarkets.length }} of </template>{{ markets.length }}
          {{ marketsWord }}
        </p>

        <div v-if="visibleMarkets.length === 0" class="no-match" data-testid="markets-no-match">
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
            v-for="market in visibleMarkets"
            :key="market.id"
            :market="market"
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
  padding: var(--space-8);
}

/* On a phone the gutter narrows, as the door's does, and stays on both sides (T142). */
@media (width <= 640px) {
  .markets-view {
    padding: var(--space-4);
  }
}

.header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding-bottom: var(--space-6);
  border-bottom: 1px solid var(--mm-border);
}

.header h1 {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--mm-black);
}

.new-market-button {
  /* A thumb's 44px on a phone; a desk's padding is taller than its target already. */
  min-height: var(--target-min);
  padding: var(--space-2) var(--space-6);
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: var(--radius-control);
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 400;
  box-shadow: var(--shadow-card);
}

/* Its resting shadow outranks the primitives' focus rule, so it says its halo itself. */
.new-market-button:focus-visible {
  box-shadow: var(--focus-halo), var(--shadow-card);
}

.new-market-button:hover {
  background: var(--mm-green);
  opacity: 0.9;
  box-shadow: var(--shadow-card);
}

.markets-block {
  padding-top: var(--space-6);
}

.opening-line {
  margin-bottom: var(--space-4);
}

/* One control, its whole width opening the market, a phone's or a desk's 44px. It is not a result
   of the finder under it, so it wears a control's edge rather than a card's. */
.previously-opened {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 44px;
  padding: 0 var(--space-3);
  background: white;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  color: var(--mm-black);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease-in-out;
}

.previously-opened:hover {
  border-color: var(--mm-green);
}

.previously-opened-label {
  flex: none;
  color: var(--mm-text-muted);
}

.previously-opened-name {
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.previously-opened-phase {
  flex: none;
}

.previously-opened-go {
  flex: none;
  width: 16px;
  height: 16px;
  margin-left: auto;
  color: var(--mm-text-muted);
  transform: rotate(-90deg);
}

/* The name keeps the room on a phone, the phase being on its card in the list below. */
@media (width <= 640px) {
  .previously-opened-phase {
    display: none;
  }
}

.empty-state {
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

/* The finder: search, organization and sort on one row that wraps when the room runs out, the
   phase toggles under it. Every control is a primitive; all this decides is where they sit. */
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
  gap: var(--space-6);
}
</style>
