<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { withoutQueryKey } from '@/utils/routeQuery';
import { useRoute, useRouter } from 'vue-router';

import { useOpenMarket } from '@/utils/openMarket';
import { vendorMatches } from '@/utils/vendorIdentity';
import VendorIdentity from '@/components/VendorIdentity.vue';
import MarketFrame from '@/components/MarketFrame.vue';
import NothingAssigned from '@/components/NothingAssigned.vue';
import VendorDrawer from '@/components/VendorDrawer.vue';
import { hasAssignment } from '@/utils/marketPage';
import ResultFilterBar from '@/components/ResultFilterBar.vue';
import {
  filterOptions,
  filtersBeside,
  hasPlaceFilter,
  offeredFilters,
  vendorShown,
} from '@/utils/resultFilters';
import { useResultFilters } from '@/utils/useResultFilters';
import { signedInEmail } from '@/utils/signedIn';
import { useVendorDetails } from '@/utils/vendorDetails';
import { useVendorDrawer } from '@/utils/vendorDrawer';

const router = useRouter();
const route = useRoute();

const marketId = computed(() => String(route.params.marketId ?? ''));
const { market } = useOpenMarket(marketId);
const assigned = computed(() => hasAssignment(market.value));

/** The market's vendors, read once and shared with the drawer (E35/F01/S01). */
const details = useVendorDetails(marketId, market);
const { tableRows, vendorNames, isLoading } = details;
/** The open vendor and tab, in the address. */
const drawer = useVendorDrawer();

const signedOut = ref(false);
const loadError = computed(() =>
  signedOut.value ? 'You must be signed in.' : details.loadError.value,
);
const filterText = ref('');

async function loadVendors(): Promise<void> {
  signedOut.value = !signedInEmail();
  if (signedOut.value || !marketId.value) return;
  await details.load();
}

watch(marketId, () => void loadVendors(), { immediate: true });

/**
 * A vendor is an applicant being placed (CONTEXT.md), so this page lists the applications the
 * solver places and nobody else: a rejected applicant was counted as an unassigned vendor, and the
 * page disagreed with Result (bug 10, claims-and-room 04). The list comes from `/tables`, which
 * serves the run's own vendors, so the two pages cannot count different people.
 */
const vendors = computed(() =>
  details.rows.value.filter((row) => details.placeable.value.has(row.email)),
);

/**
 * Only the vendors the assignment left without a table: where "N unassigned" on the Result page
 * leads (E22/F04/S04), in the address so the link is a link. It replaced the results page's own
 * list of them, which could only report an address.
 */
const onlyUnassigned = computed(() => route.query.show === 'unassigned');

function showEveryone(): void {
  void router.replace({ query: withoutQueryKey(route.query, 'show') });
}

/**
 * The Result page's filters, asked of where each vendor is placed (E28/F02/S02): the same bar and
 * the same address keys as the tables, so a filter set there is still set here.
 */
const { filters: addressFilters } = useResultFilters();
/** The where-filters, or the date alone beside "Unassigned only" (`filtersBeside`). */
const offered = computed(() => filtersBeside('vendors', onlyUnassigned.value));
const filters = computed(() => offeredFilters(addressFilters.value, offered.value));
const filterOptionsShown = computed(() => filterOptions(tableRows.value));
const placeFiltered = computed(() => hasPlaceFilter(filters.value));

const filteredVendors = computed(() => {
  const shown = vendors.value.filter((v) =>
    vendorShown(v.assignmentsByDate, filters.value, {
      onlyUnassigned: onlyUnassigned.value,
      isAssigned: v.isAssigned,
    }),
  );
  const term = filterText.value.trim();
  if (!term) return shown;
  // Name AND address. The box used to read "Filter by email" and match only that, which on a
  // market of 232 vendors meant knowing someone's address to find them by name.
  return shown.filter((v) => vendorMatches(term, v.email, vendorNames.value));
});

const totalVendorCount = computed(() => vendors.value.length);
const assignedVendorCount = computed(() => vendors.value.filter((v) => v.isAssigned).length);
</script>

<template>
  <div class="vendors-view">
    <MarketFrame :market="market" @retry="loadVendors">
      <!-- The search stays in view with the frame; it used to stick inside the card's own
           scroller, which is gone (E21/F04/S02). -->
      <template #pinned>
        <div v-if="market" class="vendors-toolbar">
          <label class="filter-label" for="vendor-filter">Search vendors</label>
          <input
            id="vendor-filter"
            v-model="filterText"
            type="search"
            placeholder="Filter by name or email…"
            autocomplete="off"
            class="filter-input"
            data-testid="vendors-search-input"
          />
          <button
            v-if="onlyUnassigned"
            type="button"
            class="btn btn--secondary btn--compact"
            aria-label="Show every vendor"
            data-testid="vendors-filter-unassigned"
            @click="showEveryone"
          >
            Unassigned only &times;
          </button>
          <!-- With anything narrowing the list, it counts what is left (E28/F02/S02). -->
          <div class="summary-line" data-testid="vendors-summary">
            <template v-if="placeFiltered || onlyUnassigned || filterText.trim()">
              <span class="summary-strong">{{ filteredVendors.length }}</span>
              of
              <span class="summary-strong">{{ totalVendorCount }}</span>
              vendors shown
            </template>
            <template v-else-if="!assigned">
              <span class="summary-strong">{{ totalVendorCount }}</span>
              {{ totalVendorCount === 1 ? 'vendor' : 'vendors' }}
            </template>
            <template v-else>
              <span class="summary-strong">{{ assignedVendorCount }}</span>
              of
              <span class="summary-strong">{{ totalVendorCount }}</span>
              vendors assigned
            </template>
          </div>
        </div>
      </template>

      <div class="vendors-body">
        <p v-if="loadError" class="error-text">{{ loadError }}</p>
        <NothingAssigned v-if="market && !assigned" :market="market" testid="vendors-empty" />

        <ResultFilterBar
          v-if="assigned && tableRows.length"
          class="vendors-filters"
          :offered="offered"
          :options="filterOptionsShown"
          testid="vendors"
        />

        <div v-if="isLoading" class="loading-state">
          <div class="spinner" aria-hidden="true" />
          <span>Loading vendors…</span>
        </div>

        <div v-else-if="filteredVendors.length === 0" class="empty-state empty-state--inline">
          <p v-if="totalVendorCount === 0">No vendors found.</p>
          <p v-else-if="filterText.trim()">No vendors match "{{ filterText }}".</p>
          <p v-else-if="placeFiltered">No vendors match these filters.</p>
          <p v-else-if="onlyUnassigned">Every vendor has a table.</p>
        </div>

        <ul v-else class="vendor-list">
          <li
            v-for="vendor in filteredVendors"
            :key="vendor.rowIndex"
            class="vendor-row"
            :class="{ 'vendor-row--active': vendor.email === drawer.email.value }"
          >
            <button
              type="button"
              class="vendor-row-button"
              @click="drawer.open(vendor.email)"
              data-testid="vendors-list-item"
            >
              <VendorIdentity
                class="vendor-email"
                :email="vendor.displayEmail"
                :names="vendorNames"
              />
              <span v-if="assigned" class="vendor-meta">
                <span
                  class="vendor-badge"
                  :class="vendor.isAssigned ? 'vendor-badge--assigned' : 'vendor-badge--unassigned'"
                >
                  {{ vendor.isAssigned ? 'Assigned' : 'Unassigned' }}
                </span>
                <span class="vendor-date-count" data-testid="vendor-date-count">
                  {{ vendor.assignedDateCount }} of {{ vendor.reachableDateCount }}
                  {{ vendor.reachableDateCount === 1 ? 'date' : 'dates' }}
                </span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </MarketFrame>

    <VendorDrawer
      :market="market"
      :details="details"
      :email="drawer.email.value"
      :tab="drawer.tab.value"
      @close="drawer.close()"
      @update:tab="drawer.setTab"
    />
  </div>
</template>

<style scoped>
.vendors-view {
  /* The frame places itself on the page (E26/F10/S01); this holds it and the vendor detail. */
  width: 100%;
}

.vendors-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  flex: 1;
  color: var(--mm-black);
}

.vendors-toolbar {
  background-color: white;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--mm-border);
}

.filter-label {
  font-size: var(--text-sm);
  color: var(--mm-black);
  opacity: 0.75;
}

.filter-input {
  width: 100%;
  padding: 10px 12px;
  font-size: var(--text-sm);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  transition:
    border-color 0.15s ease-in-out,
    box-shadow 0.15s ease-in-out;
}

.filter-input:focus {
  outline: none;
  border-color: var(--mm-green);
  outline: 2px solid var(--mm-black);
  outline-offset: 2px;
}

.summary-line {
  font-size: var(--text-sm);
  color: var(--mm-black);
  opacity: 0.8;
  white-space: nowrap;
}

.summary-strong {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  color: var(--mm-green);
  margin: 0 2px;
}

.error-text {
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-sm);
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 0;
  color: var(--mm-black);
  opacity: 0.75;
}

.spinner {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 3px solid var(--mm-border);
  border-top-color: var(--mm-green);
  animation: spinner-spin 0.9s linear infinite;
}

@keyframes spinner-spin {
  to {
    transform: rotate(360deg);
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 48px 16px;
  text-align: center;
  color: var(--mm-text-muted);
}

.empty-state--inline {
  padding: 32px 16px;
}

.vendor-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* No max-height and no overflow of its own: .vendors-body is the one scroller on this page.
     Two nested scrollers meant the wheel did different things depending on where the pointer
     was - the page scrolled 945/900 while the list scrolled 14,374/540. */
  padding-right: 4px;
}

.vendor-row {
  margin: 0;
}

.vendor-row-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
  cursor: pointer;
  text-align: left;
  color: var(--mm-black);
  box-shadow: var(--shadow-card);
  transition:
    border-color 0.15s ease-in-out,
    box-shadow 0.15s ease-in-out,
    transform 0.05s ease-in-out;
}

.vendor-row-button:hover {
  border-color: var(--mm-green);
  box-shadow: var(--shadow-card);
}

.vendor-row-button:active {
  transform: translateY(1px);
}

.vendor-row--active .vendor-row-button {
  border-color: var(--mm-green);
  outline: 2px solid var(--mm-black);
  outline-offset: 2px;
}

.vendor-email {
  font-size: var(--text-sm);
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.vendor-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.vendor-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-xs);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.vendor-badge--assigned {
  background: rgba(54, 130, 111, 0.16);
  /* Darkened from #1e7a4f, which measured 4.35 on this tint - the rendered-usage sweep in
     E16/F01/S05 is what found it. A tinted chip is its own ground, and neither the token test nor
     the eye catches a miss of 0.15. */
  color: var(--mm-text-green); /* 5.34 on rgba(54,130,111,.16) over white */
}

.vendor-badge--unassigned {
  background: rgba(228, 166, 41, 0.18);
  color: var(--mm-text-yellow);
}

.vendor-date-count {
  /* Figures in a column need fixed-width digits (E15/F01/S03). Outfit's 0, 1 and 2 are different
     widths, so a right-aligned group shifts by a pixel or two per row and the column reads ragged
     down the list. */
  font-variant-numeric: tabular-nums;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  white-space: nowrap;
  /* "1 of 1 date" and "2 of 2 dates" differ by a letter: a fixed width, right-aligned, keeps the
     column's left edge straight down the list. 14ch holds "10 of 10 dates". */
  min-width: 14ch;
  text-align: end;
}

@media (max-width: 720px) {
  .vendors-toolbar {
    grid-template-columns: 1fr;
  }

  .vendor-row-button {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .vendor-meta {
    width: 100%;
    justify-content: space-between;
  }

  .summary-line {
    white-space: normal;
  }
}
</style>
