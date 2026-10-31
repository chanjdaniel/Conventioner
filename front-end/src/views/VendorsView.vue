<script setup lang="ts">
import { MarketAction, mayTake } from '@/utils/marketActions';
import { computed, ref, watch } from 'vue';
import { withoutQueryKey } from '@/utils/routeQuery';
import { useRoute, useRouter } from 'vue-router';

import { useOpenMarket } from '@/utils/openMarket';
import { vendorMatches } from '@/utils/vendorIdentity';
import VendorIdentity from '@/components/VendorIdentity.vue';
import MarketFrame from '@/components/MarketFrame.vue';
import NothingAssigned from '@/components/NothingAssigned.vue';
import VendorDrawer from '@/components/VendorDrawer.vue';
import AddVendorDialog from '@/components/AddVendorDialog.vue';
import ExportVendorsDialog from '@/components/ExportVendorsDialog.vue';
import { hasAssignment } from '@/utils/marketPage';
import ResultFilterBar from '@/components/ResultFilterBar.vue';
import {
  filterOptions,
  filtersBeside,
  hasPlaceFilter,
  inVendorsShown,
  offeredFilters,
  vendorShown,
  vendorsShownFrom,
  type VendorsShown,
} from '@/utils/resultFilters';
import { statusChip, statusLabel } from '@/utils/verdicts';
import { ApplicationStatus } from '@/assets/types/datatypes';
import { useMarketStore } from '@/stores/market';
import { useResultFilters } from '@/utils/useResultFilters';
import { signedInEmail } from '@/utils/signedIn';
import { useVendorDetails } from '@/utils/vendorDetails';
import { useVendorDrawer } from '@/utils/vendorDrawer';
import { NO_FILTERS, vendorsPageSeed, type ExportFilters } from '@/utils/vendorExport';

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
 * Every applicant (E36/F02/S04): anyone may be seated by hand, so anyone may need finding. The
 * counts are of the vendors who need a table - the run's own and those added by hand (E38/F08/S02)
 * - as the Assignments page's are, because a rejected applicant counted as an unassigned vendor
 * made this page disagree with it (bug 10).
 */
const vendors = computed(() => details.rows.value);
/**
 * The server refused where vendors sit (T123), as it does while an approved application's answers
 * are incomplete: the applications are listed, and nothing on the page says who is placed or not -
 * no date count, no "Unassigned only", no filter by where they sit, no "N of M assigned".
 */
const placementsRefused = computed(() => details.loaded.value && !details.placementsRead.value);
const tableVendors = computed(() => vendors.value.filter((v) => v.needsATable));
const isRejected = (v: { status: string }) => v.status === ApplicationStatus.ReviewerRejected;
const anyRejected = computed(() => vendors.value.some(isRejected));

/**
 * One kind of applicant, in the address so a link is a link: "Unassigned only", where "N
 * unassigned" on the Assignments page leads (E22/F04/S04), and "Rejected only" beside it.
 */
const shown = computed<VendorsShown>(() => {
  const asked = vendorsShownFrom(route.query.show);
  return asked === 'unassigned' && placementsRefused.value ? null : asked;
});
const onlyUnassigned = computed(() => shown.value === 'unassigned');

function show(choice: VendorsShown): void {
  const next = shown.value === choice ? null : choice;
  void router.replace({
    query: next ? { ...route.query, show: next } : withoutQueryKey(route.query, 'show'),
  });
}

/**
 * The Assignments page's filters, asked of where each vendor is placed (E28/F02/S02): the same bar and
 * the same address keys as the tables, so a filter set there is still set here.
 */
const { filters: addressFilters } = useResultFilters();
/** The where-filters, or the date alone beside "Unassigned only" (`filtersBeside`). */
const offered = computed(() =>
  // None on a refused read: a filter by where vendors sit would ask that read of the list, and
  // Export opens on these.
  placementsRefused.value ? [] : filtersBeside('vendors', onlyUnassigned.value),
);
const filters = computed(() => offeredFilters(addressFilters.value, offered.value));
const filterOptionsShown = computed(() => filterOptions(tableRows.value));
const placeFiltered = computed(() => hasPlaceFilter(filters.value));

const filteredVendors = computed(() => {
  const listed = vendors.value.filter(
    (v) =>
      inVendorsShown({ needsATable: v.needsATable, rejected: isRejected(v) }, shown.value) &&
      vendorShown(v.assignmentsByDate, filters.value, {
        onlyUnassigned: onlyUnassigned.value,
        isAssigned: v.isAssigned,
      }),
  );
  const term = filterText.value.trim();
  if (!term) return listed;
  // Name AND address. The box used to read "Filter by email" and match only that, which on a
  // market of 232 vendors meant knowing someone's address to find them by name.
  return listed.filter((v) => vendorMatches(term, v.email, vendorNames.value));
});

/** A vendor who never applied, added by hand (E36/F03/S01): offered when the server would take it. */
const adding = ref(false);
const canAdd = computed(
  () => mayTake(market.value, MarketAction.AddVendor) && !market.value?.addingVendorsReason,
);
async function vendorAdded(email: string): Promise<void> {
  adding.value = false;
  // A write is followed by a re-read: the market's own facts count them too (publishOutcomes).
  void useMarketStore().refresh();
  await details.load();
  drawer.open(email);
}

/**
 * The vendors shown, as a CSV (E42/F01/S01): the dialog opens on this page's filters and search,
 * taken as it opens, so the file holds who the organizer was looking at.
 */
const exporting = ref(false);
/** Export is the table's Export CSV row (E39/F01/S02): a market that raises it hides the button. */
const mayExport = computed(() => mayTake(market.value, MarketAction.ExportCsv));
const exportSeed = ref<ExportFilters>(NO_FILTERS);
function openExport(): void {
  exportSeed.value = vendorsPageSeed({
    shown: shown.value,
    filters: filters.value,
    search: filterText.value,
  });
  exporting.value = true;
}

const totalVendorCount = computed(() => vendors.value.length);
const tableVendorCount = computed(() => tableVendors.value.length);
const assignedVendorCount = computed(() => tableVendors.value.filter((v) => v.isAssigned).length);
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
          <div
            v-if="assigned && (!placementsRefused || anyRejected)"
            class="vendors-shown"
            role="group"
            aria-label="Show only"
          >
            <button
              v-if="!placementsRefused"
              type="button"
              class="btn btn--secondary btn--compact"
              :aria-pressed="onlyUnassigned"
              data-testid="vendors-filter-unassigned"
              @click="show('unassigned')"
            >
              Unassigned only<span v-if="onlyUnassigned" aria-hidden="true"> &times;</span>
            </button>
            <button
              v-if="anyRejected"
              type="button"
              class="btn btn--secondary btn--compact"
              :aria-pressed="shown === 'rejected'"
              data-testid="vendors-filter-rejected"
              @click="show('rejected')"
            >
              Rejected only<span v-if="shown === 'rejected'" aria-hidden="true"> &times;</span>
            </button>
          </div>
          <button
            v-if="mayExport"
            type="button"
            class="btn btn--secondary btn--compact"
            data-testid="vendors-export-button"
            @click="openExport"
          >
            Export
          </button>
          <button
            v-if="canAdd"
            type="button"
            class="btn btn--primary btn--compact"
            data-testid="vendors-add-button"
            @click="adding = true"
          >
            Add a vendor
          </button>
          <!-- With anything narrowing the list, it counts what is left (E28/F02/S02). -->
          <div class="summary-line" data-testid="vendors-summary">
            <template v-if="placeFiltered || shown || filterText.trim()">
              <span class="summary-strong">{{ filteredVendors.length }}</span>
              of
              <span class="summary-strong">{{ totalVendorCount }}</span>
              vendors shown
            </template>
            <!-- Where they sit was refused, so nobody is counted as placed or not (T123). -->
            <template v-else-if="placementsRefused">
              <span class="summary-strong">{{ totalVendorCount }}</span>
              {{ totalVendorCount === 1 ? 'vendor' : 'vendors' }}
            </template>
            <template v-else-if="!assigned">
              <span class="summary-strong">{{ tableVendorCount }}</span>
              {{ tableVendorCount === 1 ? 'vendor' : 'vendors' }}
            </template>
            <template v-else>
              <span class="summary-strong">{{ assignedVendorCount }}</span>
              of
              <span class="summary-strong">{{ tableVendorCount }}</span>
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
          <p v-else-if="shown === 'rejected'">Nobody was rejected.</p>
        </div>

        <ul v-else class="vendor-list">
          <li
            v-for="vendor in filteredVendors"
            :key="vendor.rowIndex"
            class="vendor-row"
            :class="{ 'vendor-row--open': vendor.email === drawer.email.value }"
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
                <!-- "Added" leads, so what follows holds one column down the list: whoever needs
                     a table says whether they have one, a vendor added by hand included
                     (E38/F08/S02); for anyone else the verdict stands there (E36/F02/S04). -->
                <span
                  v-if="vendor.added"
                  class="chip chip--informational"
                  data-testid="vendors-list-status"
                  >Added</span
                >
                <span class="vendor-standing">
                  <span
                    v-if="vendor.needsATable"
                    class="vendor-badge"
                    :class="
                      vendor.isAssigned ? 'vendor-badge--assigned' : 'vendor-badge--unassigned'
                    "
                    data-testid="vendors-list-badge"
                  >
                    {{ vendor.isAssigned ? 'Assigned' : 'Unassigned' }}
                  </span>
                  <span
                    v-else
                    :class="statusChip(vendor.status)"
                    data-testid="vendors-list-status"
                    >{{ statusLabel(vendor.status) }}</span
                  >
                </span>
                <span
                  v-if="!placementsRefused"
                  class="vendor-date-count"
                  data-testid="vendor-date-count"
                >
                  {{ vendor.assignedDateCount }} of {{ vendor.reachableDateCount }}
                  {{ vendor.reachableDateCount === 1 ? 'date' : 'dates' }}
                </span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </MarketFrame>

    <AddVendorDialog
      :open="adding"
      :market-id="marketId"
      :form="market?.applicationForm"
      :price-reads="market?.priceReads ?? []"
      @close="adding = false"
      @added="vendorAdded"
    />
    <ExportVendorsDialog
      :open="exporting"
      :market-id="marketId"
      :seed="exportSeed"
      @close="exporting = false"
    />
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
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex: 1;
  color: var(--mm-black);
}

.vendors-toolbar {
  background-color: white;
  /* The label, the search, the show-only choices, the count, and adding a vendor: a row that
     wraps, since which of them are there depends on the market and the person. */
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--mm-border);
}

.vendors-shown {
  display: flex;
  gap: var(--space-2);
}

.filter-label {
  font-size: var(--text-sm);
  color: var(--mm-black);
  opacity: 0.75;
}

.filter-input {
  flex: 1 1 16rem;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
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
  margin: 0 var(--space-hairline);
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
  gap: var(--space-3);
  padding: var(--space-12) 0;
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
  gap: var(--space-4);
  padding: var(--space-12) var(--space-4);
  text-align: center;
  color: var(--mm-text-muted);
}

.empty-state--inline {
  padding: var(--space-8) var(--space-4);
}

.vendor-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  /* No max-height and no overflow of its own: .vendors-body is the one scroller on this page.
     Two nested scrollers meant the wheel did different things depending on where the pointer
     was - the page scrolled 945/900 while the list scrolled 14,374/540. */
  padding-right: var(--space-1);
}

.vendor-row {
  margin: 0;
}

.vendor-row-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
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

/* Its resting shadow outranks the primitives' focus rule, so it says its halo itself. */
.vendor-row-button:focus-visible {
  box-shadow: var(--focus-halo), var(--shadow-card);
}

.vendor-row-button:active {
  transform: translateY(1px);
}

/* The vendor whose details are open is the selected row: the on toggle's green tint inside a green
   border (`docs/design-system.md`), where it once drew a 2px black outline beside the focus halo. */
.vendor-row--open .vendor-row-button {
  background: var(--mm-chip-positive);
  border-color: var(--mm-green);
}

/* The tint is a chip's own ground, so a chip on it would lose its edge: each keeps its ink on
   white, where every chip ink measures higher than on its own tint. */
.vendor-row--open :is(.chip, .vendor-badge) {
  background: white;
}

/* `--mm-text-muted` is 4.27 on the tint; this is 5.25 (`contrast.test.ts`). Both muted lines take
   it: the address under a name, and the date count. */
.vendor-row--open :deep(.vendor-identity-email),
.vendor-row--open .vendor-date-count {
  color: var(--mm-text-muted-on-beige);
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
  gap: var(--space-3);
  flex-shrink: 0;
}

/* One column for the badge or the verdict, whatever its word, right before the date count. As wide
   as "Unassigned", the longest; centred, so "Assigned" sits in the middle of the same slot. */
.vendor-standing {
  display: inline-flex;
  justify-content: center;
  min-width: 92px;
}

.vendor-badge {
  display: inline-flex;
  align-items: center;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-pill);
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-xs);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

/* A badge is a chip's ground and ink in its own type: the opaque `--mm-chip-*` ground, which reads
   the same whatever it sits on, and the ink `contrast.test.ts` holds to it. */
.vendor-badge--assigned {
  background: var(--mm-chip-positive);
  color: var(--mm-text-green); /* 5.34 on that ground */
}

.vendor-badge--unassigned {
  background: var(--mm-chip-attention); /* rgba(228, 166, 41, 0.18) over white */
  /* `--mm-text-yellow` measured 3.96 on this tint: the Vendors page sweep never had an unassigned
     vendor on screen until one added by hand counted as one (E38/F08/S02). */
  color: var(--mm-text-yellow-on-tint);
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
  .vendor-row-button {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
  }

  /* Under the name, the badge or verdict leads, so it keeps one column down the list whether or
     not "Added" follows it, and the date count holds the right. */
  .vendor-meta {
    width: 100%;
  }

  .vendor-standing {
    order: -1;
    justify-content: flex-start;
  }

  .vendor-date-count {
    margin-left: auto;
  }

  .summary-line {
    white-space: normal;
  }
}
</style>
