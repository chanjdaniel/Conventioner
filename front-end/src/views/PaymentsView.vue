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
 * the vendor's drawer on its Payment tab, and a change made there is read here again.
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
import { balanceState, balanceText, money } from '@/utils/payments';
import {
  PAYMENTS_SHOWN,
  loadMarketPayments,
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
const shown = computed(() => paymentsShownFrom(route.query.show));
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
    { shown: shown.value, search: search.value, names: names.value },
    sort.value,
  ),
);
const counts = computed(
  () =>
    new Map(
      PAYMENTS_SHOWN.map((f) => [f.id, vendors.value.filter((v) => vendorShownIn(v, f.id)).length]),
    ),
);
const narrowed = computed(() => !!shown.value || !!search.value.trim());

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

/** A row's comparison, toned as the Payment tab's is. */
const CHIP = {
  owing: 'chip--attention',
  settled: 'chip--positive',
  overpaid: 'chip--informational',
};
function balanceChip(vendor: { owedCents: number; paidCents: number }): string {
  return vendor.owedCents || vendor.paidCents ? CHIP[balanceState(vendor)] : 'chip--neutral';
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
          <div class="payments-shown" role="group" aria-label="Show only">
            <button
              v-for="filter in PAYMENTS_SHOWN"
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
          <!-- Pricing is optional (E43/F01/S01): without it nothing is owed, so the page says
               where prices are set rather than showing noughts. -->
          <p v-if="!priced" class="note" data-testid="payments-unpriced">
            Pricing is off for this market, so nobody owes anything for a table.
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

          <template v-if="vendors.length && priced">
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
                  <table class="payments-table payments-table--figures">
                    <thead>
                      <tr>
                        <th scope="col">{{ breakdown.head }}</th>
                        <th v-for="figure in FIGURES" :key="figure.key" scope="col">
                          {{ figure.label }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="row in breakdown.rows"
                        :key="row.label"
                        :data-testid="`payments-by-${breakdown.id}-row`"
                      >
                        <th scope="row">{{ row.label }}</th>
                        <td v-for="figure in FIGURES" :key="figure.key" :data-figure="figure.key">
                          {{ amount(row[figure.key]) }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <p class="payments-caption">
                A payment is a vendor's, not a day's: what each vendor paid is shared across their
                table-days by what each owes.
              </p>
            </section>
          </template>

          <section
            v-if="vendors.length"
            class="payments-section"
            aria-labelledby="payments-vendors-title"
          >
            <h2 id="payments-vendors-title" class="payments-title">Vendors</h2>
            <p v-if="!listed.length" class="payments-note" data-testid="payments-none-shown">
              {{ nobodyShown }}
            </p>
            <table v-else class="payments-table payments-table--vendors">
              <thead>
                <tr>
                  <th
                    v-for="column in COLUMNS"
                    :key="column.key"
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
              <tbody>
                <tr
                  v-for="vendor in listed"
                  :key="vendor.email"
                  class="payments-row"
                  :class="{ 'payments-row--open': vendor.email === drawer.email.value }"
                  :data-email="vendor.email"
                  data-testid="payments-row"
                  @click="drawer.open(vendor.email, 'payment')"
                >
                  <td>
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
                  <td class="payments-amount" data-testid="payments-row-owed">
                    {{ amount(vendor.owedCents) }}
                  </td>
                  <td class="payments-amount" data-testid="payments-row-paid">
                    {{ amount(vendor.paidCents) }}
                  </td>
                  <td class="payments-amount">
                    <span
                      class="chip"
                      :class="balanceChip(vendor)"
                      data-testid="payments-row-balance"
                      >{{ balanceText({ ...vendor, currency: found.currency }) }}</span
                    >
                  </td>
                </tr>
              </tbody>
            </table>
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
  color: var(--mm-black);
  opacity: 0.8;
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

/* As wide as the vendor's name or address, so its halo hugs the words in the wide Vendor column;
   a click on the rest of the row opens the drawer as well. */
.payments-row-open {
  display: block;
  width: fit-content;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
}
</style>
