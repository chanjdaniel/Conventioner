<script setup lang="ts">
/**
 * The Payments page (E44/F02/S01), the Assignment tab's fourth: the market's money at a glance,
 * who has yet to pay, and whose refund is to be issued (Daniel, T92 Q16, Q26).
 *
 * The figures head it: the amount owed (every table-day line), the amount paid, what is still owed
 * and what was paid more than owed, each also by tier and by date. Under them every vendor with a
 * line or a payment, with what they owe, what they paid and how the two compare, in the words of
 * their Payment tab; filtered to "Owes", "Paid in full" or "Paid more than owed", searched, and
 * sorted by any column, all in the address, so a link or a reload shows the same list. A row opens
 * the vendor's drawer on its Payment tab, and a change made there is read here again. The table
 * draws 50 rows at a time (`ListFrame`), and every figure and count above it still counts every
 * vendor.
 *
 * The server counts all of it (`utils/paymentsPage.ts`). It reads and changes nothing itself, so
 * anyone who reads the market reads it; a market that sets no prices says so, and where to set them.
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import { getApiErrorMessage } from '@/utils/api';
import { marketPath } from '@/utils/market';
import { hasAssignment } from '@/utils/marketPage';
import { useOpenMarket } from '@/utils/openMarket';
import { balanceChip, balanceText, money } from '@/utils/payments';
import {
  loadMarketPayments,
  owingCounted,
  paidOwingNothing,
  paymentsFilters,
  paymentsShownFrom,
  paymentsSortFrom,
  paymentsSortQuery,
  shownVendors,
  vendorShownIn,
  type MarketPayments,
  type PaymentsFigures,
  type PaymentsShown,
  type PaymentsSortKey,
} from '@/utils/paymentsPage';
import { withoutQueryKey } from '@/utils/routeQuery';
import { signedInEmail } from '@/utils/signedIn';
import { dateLabel, useVendorDetails } from '@/utils/vendorDetails';
import { useVendorDrawer } from '@/utils/vendorDrawer';
import ListFrame from '@/components/ListFrame.vue';
import MarketFrame from '@/components/MarketFrame.vue';
import NothingAssigned from '@/components/NothingAssigned.vue';
import VendorDrawer from '@/components/VendorDrawer.vue';
import VendorIdentity from '@/components/VendorIdentity.vue';

const route = useRoute();
const router = useRouter();
const marketId = computed(() => String(route.params.marketId ?? ''));
const { market } = useOpenMarket(marketId);

/** The market's vendors, for their names and the drawer (E35/F01/S01). */
const details = useVendorDetails(marketId, market);
const names = computed(() => details.vendorNames.value);
const drawer = useVendorDrawer();

/** What the server counted, or null until it answers. */
const found = ref<MarketPayments | null>(null);
const loadError = ref('');

async function load(): Promise<void> {
  if (!marketId.value) return;
  loadError.value = '';
  try {
    found.value = await loadMarketPayments(marketId.value);
  } catch (err: unknown) {
    loadError.value = getApiErrorMessage(err, 'The payments could not be loaded.');
  }
}

async function loadAll(): Promise<void> {
  if (!signedInEmail() || !marketId.value) return;
  await Promise.all([load(), details.load()]);
}
watch(marketId, () => void loadAll(), { immediate: true });

const priced = computed(() => found.value?.currency != null);
/** Whether there is money owed to count: prices, or an amount set by hand on a market without. */
const counted = computed(() => owingCounted(found.value));
const amount = (cents: number) => money(cents, { currency: found.value?.currency ?? null });

/** The four figures, in the order the page reads them. */
const FIGURES: readonly { key: keyof PaymentsFigures; label: string }[] = [
  { key: 'owedCents', label: 'Owed' },
  { key: 'paidCents', label: 'Paid' },
  { key: 'stillOwedCents', label: 'Still owed' },
  { key: 'paidMoreCents', label: 'Paid more than owed' },
];

const breakdowns = computed(() => {
  const read = found.value;
  if (!read) return [];
  return [
    {
      id: 'tier',
      title: 'By tier',
      head: 'Tier',
      rows: read.byTier.map((row) => ({ ...row, label: row.tier ?? 'No table' })),
    },
    {
      id: 'date',
      title: 'By date',
      head: 'Date',
      rows: read.byDate.map((row) => ({
        ...row,
        label: row.date ? dateLabel(row.date) : 'No table',
      })),
    },
  ];
});

/** The list's filter, search and sort, each in the address. */
const filters = computed(() => paymentsFilters(found.value));
const shown = computed(() => paymentsShownFrom(route.query.show, found.value));
const search = computed(() => String(route.query.search ?? ''));
const sort = computed(() => paymentsSortFrom(route.query));

function replaceQuery(query: LocationQuery): void {
  void router.replace({ query });
}

function show(choice: PaymentsShown): void {
  replaceQuery(
    shown.value === choice
      ? withoutQueryKey(route.query, 'show')
      : { ...route.query, show: choice },
  );
}

function setSearch(value: string): void {
  replaceQuery(value ? { ...route.query, search: value } : withoutQueryKey(route.query, 'search'));
}

function sortBy(key: PaymentsSortKey): void {
  const query = withoutQueryKey(withoutQueryKey(route.query, 'sort'), 'order');
  replaceQuery({ ...query, ...paymentsSortQuery(sort.value, key) });
}

const vendors = computed(() => found.value?.vendors ?? []);
const listed = computed(() =>
  shownVendors(
    vendors.value,
    {
      shown: shown.value,
      search: search.value,
      names: names.value,
      legalNames: details.legalNames.value,
    },
    sort.value,
  ),
);
const counts = computed(
  () =>
    new Map(
      filters.value.map((f) => [f.id, vendors.value.filter((v) => vendorShownIn(v, f.id)).length]),
    ),
);
const narrowed = computed(() => !!shown.value || !!search.value.trim());
/**
 * Everything that orders or narrows the rows: a change of any goes back to the first page
 * (`ListFrame`), since a new sort's first rows are the point of it.
 */
const listFilterKey = computed(() =>
  JSON.stringify([shown.value, search.value.trim(), sort.value.key, sort.value.descending]),
);

const COLUMNS: readonly { key: PaymentsSortKey; label: string; amount: boolean }[] = [
  { key: 'vendor', label: 'Vendor', amount: false },
  { key: 'owed', label: 'Owed', amount: true },
  { key: 'paid', label: 'Paid', amount: true },
  { key: 'difference', label: 'Difference', amount: true },
];

function ariaSort(key: PaymentsSortKey): 'ascending' | 'descending' | undefined {
  if (sort.value.key !== key) return undefined;
  return sort.value.descending ? 'descending' : 'ascending';
}

const nobodyShown = computed(() => {
  const term = search.value.trim();
  if (term) return `No vendor matches "${term}".`;
  if (shown.value === 'owes') return 'Nobody owes anything.';
  if (shown.value === 'paid') return 'Nobody has paid in full yet.';
  return 'Nobody paid more than they owe.';
});
</script>

<template>
  <div class="payments-view">
    <MarketFrame :market="market" @retry="loadAll">
      <template #pinned>
        <div v-if="market && vendors.length" class="payments-toolbar">
          <label class="payments-search-label" for="payments-search">Search vendors</label>
          <input
            id="payments-search"
            :value="search"
            type="search"
            placeholder="Filter by name or email…"
            autocomplete="off"
            class="payments-search"
            data-testid="payments-search"
            @input="setSearch(($event.target as HTMLInputElement).value)"
          />
          <!-- No filter where pricing is off: nobody owes, so the refunds one would be everyone. -->
          <div
            v-if="filters.length"
            class="payments-shown"
            role="group"
            aria-label="Show only"
            data-testid="payments-shown"
          >
            <button
              v-for="filter in filters"
              :key="filter.id"
              type="button"
              class="btn btn--secondary btn--compact"
              :aria-pressed="shown === filter.id"
              :data-testid="`payments-show-${filter.id}`"
              @click="show(filter.id)"
            >
              {{ filter.label }} ({{ counts.get(filter.id) }})<span
                v-if="shown === filter.id"
                aria-hidden="true"
              >
                &times;</span
              >
            </button>
          </div>
          <div class="payments-summary" data-testid="payments-summary">
            <template v-if="narrowed">
              <span class="payments-summary-strong">{{ listed.length }}</span>
              of
              <span class="payments-summary-strong">{{ vendors.length }}</span>
              vendors shown
            </template>
            <template v-else>
              <span class="payments-summary-strong">{{ vendors.length }}</span>
              {{ vendors.length === 1 ? 'vendor' : 'vendors' }}
            </template>
          </div>
        </div>
      </template>

      <div class="payments-body">
        <p v-if="loadError" class="payments-error" role="alert">{{ loadError }}</p>
        <p v-else-if="!found" class="payments-note">Loading payments…</p>

        <template v-else-if="market">
          <!-- Pricing is optional (E43/F01/S01): without it nothing is owed but an amount set by
               hand or a refund beyond what was paid, so the page says where prices are set rather
               than showing noughts. -->
          <p v-if="!priced" class="note" data-testid="payments-unpriced">
            {{
              counted
                ? 'Pricing is off for this market, so a vendor owes only an amount set by hand on their Payment tab, or a refund beyond what they paid.'
                : 'Pricing is off for this market, so nobody owes anything for a table.'
            }}
            <RouterLink :to="marketPath(market.id, 'setup')" data-testid="payments-pricing-link"
              >Set prices on Market Setup's Pricing card</RouterLink
            >.
          </p>
          <NothingAssigned
            v-if="!vendors.length && !hasAssignment(market)"
            :market="market"
            testid="payments-empty"
          />
          <p v-else-if="!vendors.length" class="payments-note" data-testid="payments-nobody">
            Nobody holds a table or has paid yet.
          </p>

          <!-- Drawn wherever some vendor owes (`owingCounted`), and summed by the same rule as the
               rows (T153 review finding 12): where nobody owes, every figure would be what was paid. -->
          <template v-if="vendors.length && counted">
            <section class="payments-section" aria-labelledby="payments-totals-title">
              <h2 id="payments-totals-title" class="payments-title">The market's money</h2>
              <dl class="payments-figures" data-testid="payments-totals">
                <div
                  v-for="figure in FIGURES"
                  :key="figure.key"
                  class="payments-figure"
                  :data-testid="`payments-total-${figure.key}`"
                >
                  <dt>{{ figure.label }}</dt>
                  <dd>{{ amount(found.totals[figure.key]) }}</dd>
                </div>
              </dl>
              <div class="payments-breakdowns">
                <div
                  v-for="breakdown in breakdowns"
                  :key="breakdown.id"
                  class="payments-breakdown"
                  :data-testid="`payments-by-${breakdown.id}`"
                >
                  <h3 class="payments-subtitle">{{ breakdown.title }}</h3>
                  <!-- The roles keep it a table to a screen reader where a phone lays its rows out
                       as blocks (`display` drops a table's own semantics in some browsers). -->
                  <table role="table" class="payments-table payments-table--figures">
                    <thead role="rowgroup">
                      <tr role="row">
                        <th role="columnheader" scope="col">{{ breakdown.head }}</th>
                        <th
                          v-for="figure in FIGURES"
                          :key="figure.key"
                          role="columnheader"
                          scope="col"
                        >
                          {{ figure.label }}
                        </th>
                      </tr>
                    </thead>
                    <tbody role="rowgroup">
                      <tr
                        v-for="row in breakdown.rows"
                        :key="row.label"
                        role="row"
                        :data-testid="`payments-by-${breakdown.id}-row`"
                      >
                        <th role="rowheader" scope="row">{{ row.label }}</th>
                        <td
                          v-for="figure in FIGURES"
                          :key="figure.key"
                          role="cell"
                          :data-figure="figure.key"
                        >
                          <span class="payments-cell-label" aria-hidden="true">{{
                            figure.label
                          }}</span>
                          {{ amount(row[figure.key]) }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div class="payments-captions">
                <p class="payments-caption">
                  A payment is a vendor's, not a day's: what each vendor paid is shared across their
                  table-days by what each owes.
                </p>
                <p
                  v-if="paidOwingNothing(found)"
                  class="payments-caption"
                  data-testid="payments-unpriced-caption"
                >
                  "Paid" includes what vendors who owe nothing paid; only a vendor who owes can pay
                  more than owed.
                </p>
              </div>
            </section>
          </template>

          <section
            v-if="vendors.length"
            class="payments-section"
            aria-labelledby="payments-vendors-title"
          >
            <h2
              id="payments-vendors-title"
              class="payments-title"
              data-testid="payments-vendors-title"
            >
              Vendors
            </h2>
            <p v-if="!listed.length" class="payments-note" data-testid="payments-none-shown">
              {{ nobodyShown }}
            </p>
            <ListFrame
              v-else
              :items="listed"
              :filter-key="listFilterKey"
              :item-key="(vendor) => vendor.email"
              :noun="{ one: 'vendor', many: 'vendors' }"
              testid="payments-list"
            >
              <template #rows="{ rows }">
                <table role="table" class="payments-table payments-table--vendors">
                  <thead role="rowgroup">
                    <tr role="row">
                      <th
                        v-for="column in COLUMNS"
                        :key="column.key"
                        role="columnheader"
                        scope="col"
                        :aria-sort="ariaSort(column.key)"
                        :class="{ 'payments-amount': column.amount }"
                      >
                        <button
                          type="button"
                          class="payments-sort"
                          :data-testid="`payments-sort-${column.key}`"
                          @click="sortBy(column.key)"
                        >
                          {{ column.label
                          }}<span
                            v-if="ariaSort(column.key)"
                            class="payments-sort-mark"
                            aria-hidden="true"
                            >{{ sort.descending ? '▼' : '▲' }}</span
                          >
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    <tr
                      v-for="vendor in rows"
                      :key="vendor.email"
                      role="row"
                      data-list-row
                      tabindex="-1"
                      class="payments-row"
                      :class="{ 'payments-row--open': vendor.email === drawer.email.value }"
                      :data-email="vendor.email"
                      data-testid="payments-row"
                      @click="drawer.open(vendor.email, 'payment')"
                    >
                      <td role="cell">
                        <!-- The row's one keyboard stop; a click anywhere on the row does the same. -->
                        <button
                          type="button"
                          class="payments-row-open"
                          data-testid="payments-row-open"
                          @click.stop="drawer.open(vendor.email, 'payment')"
                        >
                          <VendorIdentity :email="vendor.email" :names="names" />
                        </button>
                      </td>
                      <td role="cell" class="payments-amount" data-testid="payments-row-owed">
                        <span
                          class="payments-cell-label"
                          aria-hidden="true"
                          data-testid="payments-cell-label"
                          >{{ COLUMNS[1].label }}</span
                        >
                        {{ amount(vendor.owedCents) }}
                      </td>
                      <td role="cell" class="payments-amount" data-testid="payments-row-paid">
                        <span
                          class="payments-cell-label"
                          aria-hidden="true"
                          data-testid="payments-cell-label"
                          >{{ COLUMNS[2].label }}</span
                        >
                        {{ amount(vendor.paidCents) }}
                      </td>
                      <td role="cell" class="payments-amount">
                        <span
                          class="payments-cell-label"
                          aria-hidden="true"
                          data-testid="payments-cell-label"
                          >{{ COLUMNS[3].label }}</span
                        >
                        <span
                          class="chip"
                          :class="balanceChip({ ...vendor, currency: found.currency })"
                          data-testid="payments-row-balance"
                          >{{ balanceText({ ...vendor, currency: found.currency }) }}</span
                        >
                      </td>
                    </tr>
                  </tbody>
                </table>
              </template>
            </ListFrame>
          </section>
        </template>
      </div>
    </MarketFrame>

    <VendorDrawer
      :market="market"
      :details="details"
      :email="drawer.email.value"
      :tab="drawer.tab.value"
      @close="drawer.close()"
      @update:tab="drawer.setTab"
      @payment-changed="load"
    />
  </div>
</template>

<style scoped>
.payments-view {
  width: 100%;
}

.payments-toolbar {
  background-color: white;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--mm-border);
}

.payments-search-label {
  font-size: var(--text-sm);
  color: var(--mm-black);
  opacity: 0.75;
}

.payments-search {
  flex: 1 1 16rem;
  min-width: 0;
  min-height: var(--target-min);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
}

.payments-shown {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.payments-summary {
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  white-space: nowrap;
}

.payments-summary-strong {
  font-family: 'Merge One', sans-serif;
  color: var(--mm-green);
  margin: 0 var(--space-hairline);
}

.payments-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-6);
  color: var(--mm-black);
}

.payments-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.payments-title {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  font-weight: 400;
}

.payments-subtitle {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
}

.payments-note {
  margin: 0;
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.payments-error {
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-sm);
}

/* The figures' footnotes read as one block under them. */
.payments-captions {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.payments-caption {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.payments-figures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
  gap: var(--space-4);
  margin: 0;
}

.payments-figure {
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
  box-shadow: var(--shadow-card);
}

.payments-figure dt {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.payments-figure dd {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  font-variant-numeric: tabular-nums;
}

/* Side by side where each has room for a date and its four headings on one line; at the 1000px
   floor they wrapped onto two, so there one stands under the other. */
.payments-breakdowns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 34rem), 1fr));
  align-items: start;
  gap: var(--space-4);
}

.payments-breakdown {
  min-width: 0;
}

.payments-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.payments-table th,
.payments-table td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--mm-border);
  text-align: left;
  vertical-align: middle;
}

.payments-table thead th {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-text-muted);
}

/* Figures in a column need fixed-width digits, right-aligned, so a column reads straight. */
.payments-table--figures td,
.payments-amount {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.payments-table--figures tbody th {
  font-weight: 400;
}

/* A figure's heading stands over its figures' right edge. */
.payments-table--figures thead th:not(:first-child) {
  text-align: right;
}

.payments-table .payments-amount {
  text-align: right;
}

/* The vendor takes the spare width, so Owed, Paid and the Difference stand together at the right,
   each a figure's width plus a gap, rather than spread across a wide window: at 1440 Paid and the
   Difference stood 500px apart. */
.payments-table--vendors th:first-child {
  width: 100%;
}

.payments-table--vendors .payments-amount {
  padding-left: var(--space-8);
}

.payments-sort {
  --focus-border-offset: var(--focus-border-width);
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.payments-sort-mark {
  font-size: var(--text-xs);
}

.payments-row {
  cursor: pointer;
}

.payments-row:hover {
  background: var(--mm-beige);
}

/* The vendor whose drawer is open is the selected row, as on the Vendors page; a row pointed at
   takes the beige a pointed seat takes on the Assignments page. */
.payments-row--open {
  background: var(--mm-chip-positive);
}

.payments-row--open .chip {
  background: white;
}

.payments-row--open :deep(.vendor-identity-email) {
  color: var(--mm-text-muted-on-beige);
}

/* As wide as the vendor's name or address, so its focus border hugs the words in the wide Vendor column;
   a click on the rest of the row opens the drawer as well. */
.payments-row-open {
  --focus-border-offset: var(--focus-border-width);
  display: block;
  width: fit-content;
  max-width: 100%;
  min-height: var(--target-min);
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
}

/* A column's heading beside each value, where a phone lays a row out as a block (below). The
   table's own `th` says it to a screen reader, so this copy is for the eye alone. */
.payments-cell-label {
  display: none;
}

/*
 * A phone (T180): who still owes is read at the door, so the page fits the phone it is read on
 * (`meta.fitsAPhone`). The gutter is the door's. A table whose columns cannot share the phone's
 * room keeps its rows and headers (the roles hold them where `display` would drop them) but lays
 * each row out as a block: its row heading, the date or tier or the vendor, on a line of its own,
 * then each value on a line beside its column's heading. The vendors' headings stay as a row of
 * sort buttons above, each a thumb's target.
 */
@media (width <= 640px) {
  .payments-toolbar {
    padding-inline: var(--space-4);
  }

  .payments-search {
    flex-basis: 100%;
  }

  .payments-body {
    padding: var(--space-4);
  }

  .payments-figures {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .payments-table,
  .payments-table thead,
  .payments-table tbody,
  .payments-table tr,
  .payments-table th,
  .payments-table td {
    display: block;
  }

  .payments-table tbody tr {
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--mm-border);
  }

  .payments-table th,
  .payments-table td {
    padding: var(--space-1) var(--space-2);
    border-bottom: 0;
  }

  .payments-table tbody td {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-3);
  }

  .payments-cell-label {
    display: inline;
    color: var(--mm-text-muted);
  }

  .payments-table tbody th {
    font-weight: 600;
  }

  /* The figures' headings are said by each line, so they stand only for a screen reader: the
     `.visually-hidden` utility of `assets/base.css`, copied whole, since it applies here only on a
     phone; change one with the other. */
  .payments-table--figures thead {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    /* stylelint-disable-next-line declaration-property-value-allowed-list -- the utility's own value, not spacing: it pulls the 1px box off the layout */
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .payments-table--vendors thead tr {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--mm-border);
  }

  .payments-table--vendors th:first-child {
    width: auto;
  }

  .payments-table--vendors .payments-amount {
    padding-left: var(--space-2);
  }

  .payments-sort {
    min-width: var(--target-min);
    min-height: var(--target-min);
  }

  .payments-row--open .payments-cell-label {
    color: var(--mm-text-muted-on-beige);
  }
}
</style>
