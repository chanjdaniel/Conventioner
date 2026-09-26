<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { marketPath } from '@/utils/market';
import { useRoute, useRouter } from 'vue-router';

import { api } from '@/utils/api';
import { getFormattedDate } from '@/utils/utils';
import { type VendorNames } from '@/utils/vendorIdentity';
import VendorIdentity from '@/components/VendorIdentity.vue';
import PlacementDialog, { type SwapTarget } from '@/components/PlacementDialog.vue';
import PhaseRail from '@/components/PhaseRail.vue';
import { useOpenMarket } from '@/utils/openMarket';
import MarketArrival from '@/components/MarketArrival.vue';
import {
  FULL_TABLE,
  HALF_TABLE_LEFT,
  HALF_TABLE_RIGHT,
  type PlaceableVendor,
  type Seat,
} from '@/utils/placementChange';

interface MarketTableRow {
  date: string;
  assignment: string[];
  /** The table seat by seat - `[left, right]`, null for vacant. Which side is free is a fact
      the occupant list cannot carry, and every placement names a side. */
  assignmentSlots: (string | null)[];
  location: string;
  section: string;
  tableChoice: string;
  tableCode: string;
  tier: string;
}

interface SectionGroup {
  section: string;
  location: string;
  tier: string;
  rows: MarketTableRow[];
}

interface DateGroup {
  date: string;
  displayDate: string;
  sections: SectionGroup[];
  rowCount: number;
}

type ChoiceFilter = 'full' | 'half' | '';
type FilterName = 'date' | 'section' | 'tier' | 'choice';

const route = useRoute();
const router = useRouter();

const marketId = computed(() => String(route.params.marketId ?? ''));
/** The lifecycle band below this screen's header (E10/F01/S01). */
const { market, status: marketStatus, refresh: refreshMarket } = useOpenMarket(marketId);

/** A failed arrival retries both halves: the market the rail draws, and this screen's own rows. */
function retryArrival(): void {
  void refreshMarket();
  void loadTables();
}
const allRows = ref<MarketTableRow[]>([]);
/** Email to name, from the same response as the rows, so a table and its occupant agree. */
const vendorNames = ref<VendorNames>({});
/** Who may be put in a seat, and what they asked for - so a change that alters their table
    choice can be said out loud before it is made. */
const vendors = ref<PlaceableVendor[]>([]);
const isLoading = ref(false);
const errorMessage = ref('');

const dateFilter = computed(() => normalizeQuery(route.query.date));
const sectionFilter = computed(() => normalizeQuery(route.query.section));
const tierFilter = computed(() => normalizeQuery(route.query.tier));
const choiceFilter = computed<ChoiceFilter>(() => {
  const raw = normalizeQuery(route.query.choice).toLowerCase();
  if (raw === 'full' || raw === 'half') return raw;
  return '';
});

const hasActiveFilters = computed(
  () =>
    Boolean(dateFilter.value) ||
    Boolean(sectionFilter.value) ||
    Boolean(tierFilter.value) ||
    Boolean(choiceFilter.value),
);

function normalizeQuery(raw: unknown): string {
  if (Array.isArray(raw)) {
    const first = raw.find((v) => typeof v === 'string' && v.length > 0);
    return typeof first === 'string' ? first : '';
  }
  return typeof raw === 'string' ? raw : '';
}

function formatDisplayDate(date: string): string {
  return getFormattedDate(date) ?? date;
}

function rowMatchesChoice(row: MarketTableRow, filter: ChoiceFilter): boolean {
  if (!filter) return true;
  const normalized = row.tableChoice.toLowerCase();
  if (filter === 'full') return normalized.includes('full');
  return normalized.includes('half');
}

const filteredRows = computed((): MarketTableRow[] => {
  const date = dateFilter.value;
  const section = sectionFilter.value;
  const tier = tierFilter.value;
  const choice = choiceFilter.value;

  return allRows.value.filter((row) => {
    if (date && row.date !== date) return false;
    if (section && row.section !== section) return false;
    if (tier && row.tier !== tier) return false;
    if (!rowMatchesChoice(row, choice)) return false;
    return true;
  });
});

const groupedRows = computed((): DateGroup[] => {
  const dateMap = new Map<string, Map<string, SectionGroup>>();

  for (const row of filteredRows.value) {
    let sectionMap = dateMap.get(row.date);
    if (!sectionMap) {
      sectionMap = new Map();
      dateMap.set(row.date, sectionMap);
    }
    let group = sectionMap.get(row.section);
    if (!group) {
      group = {
        section: row.section,
        location: row.location,
        tier: row.tier,
        rows: [],
      };
      sectionMap.set(row.section, group);
    }
    group.rows.push(row);
  }

  const dateGroups: DateGroup[] = [];
  for (const [date, sectionMap] of dateMap.entries()) {
    const sections = Array.from(sectionMap.values()).sort((a, b) =>
      a.section.localeCompare(b.section),
    );
    for (const section of sections) {
      section.rows.sort((a, b) =>
        a.tableCode.localeCompare(b.tableCode, undefined, { numeric: true }),
      );
    }
    const rowCount = sections.reduce((sum, s) => sum + s.rows.length, 0);
    dateGroups.push({
      date,
      displayDate: formatDisplayDate(date),
      sections,
      rowCount,
    });
  }
  dateGroups.sort((a, b) => a.date.localeCompare(b.date));
  return dateGroups;
});

interface RowStatus {
  label: 'assigned' | 'partial' | 'empty';
  leftEmail: string | null;
  rightEmail: string | null;
  isFull: boolean;
}

function rowStatus(row: MarketTableRow): RowStatus {
  const isFull = row.tableChoice.toLowerCase().includes('full');
  // Seat by seat, not the occupant list: a lone occupant on the RIGHT used to draw on the left,
  // because a list of one cannot say which half of the table it means. Nothing could produce that
  // until a pin could (E11).
  const left = row.assignmentSlots?.[0] ?? null;
  const right = row.assignmentSlots?.[1] ?? null;

  if (!left && !right) {
    return { label: 'empty', leftEmail: null, rightEmail: null, isFull };
  }

  if (isFull) {
    const email = left ?? right;
    return { label: 'assigned', leftEmail: email, rightEmail: email, isFull };
  }

  const filled = (left ? 1 : 0) + (right ? 1 : 0);
  return {
    label: filled === 2 ? 'assigned' : 'partial',
    leftEmail: left,
    rightEmail: right,
    isFull,
  };
}

const statusCounts = computed(() => {
  let assigned = 0;
  let partial = 0;
  let empty = 0;
  for (const row of filteredRows.value) {
    const status = rowStatus(row).label;
    if (status === 'assigned') assigned += 1;
    else if (status === 'partial') partial += 1;
    else empty += 1;
  }
  return { assigned, partial, empty };
});

/**
 * The three status pills, each with the fill it is worn in.
 *
 * A count of zero is not a condition to act on, so it loses its colour whatever the category. The
 * partial pill was amber at every value, so a market with nothing partially filled showed a
 * warning-coloured zero pulling the eye to a non-problem (E14/F02/S03). Applied to all three rather
 * than to partial alone: "0 assigned" in the green that means "done" is the same mistake wearing a
 * friendlier face, and one rule needs no explaining to the next reader.
 *
 * Built as a list rather than written out three times in the template, because the kind and the
 * count travelled together and nothing stopped them being paired wrongly - `('assigned', partial)`
 * typechecks perfectly and renders a lie.
 */
const countPills = computed(() =>
  (['assigned', 'partial', 'empty'] as const).map((kind) => {
    const count = statusCounts.value[kind];
    return { kind, count, fill: count === 0 ? 'count-badge--none' : `count-badge--${kind}` };
  }),
);

function clearFilter(name: FilterName): void {
  setFilter(name, '');
}

/**
 * Set one filter, from the page.
 *
 * The filter system was complete and unreachable: every filter is computed from `route.query`,
 * the chips could clear one, and nothing in the product ever set one - so an organizer could
 * only narrow this view by editing the address bar (`E09/F02/S01`, `E11/F03/S02`).
 */
function setFilter(name: FilterName, value: string): void {
  const nextQuery = { ...route.query };
  if (value) nextQuery[name] = value;
  else delete nextQuery[name];
  router.replace({ query: nextQuery });
}

/** Every distinct value the loaded rows offer for one filter, so the picker offers only what exists. */
function optionsFor(pick: (row: MarketTableRow) => string): string[] {
  const seen = new Set<string>();
  for (const row of allRows.value) {
    const value = pick(row);
    if (value) seen.add(value);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

const dateOptions = computed(() => optionsFor((row) => row.date));
const sectionOptions = computed(() => optionsFor((row) => row.section));
const tierOptions = computed(() => optionsFor((row) => row.tier));

function clearAllFilters(): void {
  router.replace({ query: {} });
}

function choiceFilterLabel(filter: ChoiceFilter): string {
  if (filter === 'full') return 'Full Tables';
  if (filter === 'half') return 'Half Tables';
  return '';
}

/**
 * Back to wherever the organizer came from.
 *
 * A vendor named in the query means they arrived from that vendor's panel, on their way to
 * change one person's placement. Returning them to the results tab instead would lose the
 * context they were working in and make them find that vendor again (`E11/F03/S02`).
 */
function goBack(): void {
  const vendor = normalizeQuery(route.query.vendor);
  if (vendor) {
    router.push({ path: marketPath(marketId.value, 'vendors'), query: { vendor } });
    return;
  }
  router.push(marketPath(marketId.value, 'setup', 'assignment'));
}

async function loadTables(): Promise<void> {
  errorMessage.value = '';
  if (!marketId.value) {
    errorMessage.value = 'Missing market id.';
    return;
  }
  const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
  if (!userEmail) {
    errorMessage.value = 'You must be signed in to view tables.';
    return;
  }
  isLoading.value = true;
  try {
    const resp = await api.get<{
      rows: MarketTableRow[];
      vendorNames: VendorNames;
      vendors?: PlaceableVendor[];
    }>(`/markets/${encodeURIComponent(marketId.value)}/tables`);
    allRows.value = Array.isArray(resp.data?.rows) ? resp.data.rows : [];
    vendorNames.value = resp.data?.vendorNames ?? {};
    vendors.value = Array.isArray(resp.data?.vendors) ? resp.data.vendors : [];
  } catch (err: unknown) {
    const data =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data
        : undefined;
    errorMessage.value = data?.error || 'Failed to load tables.';
    allRows.value = [];
    vendorNames.value = {};
    vendors.value = [];
  } finally {
    isLoading.value = false;
  }
}

watch(() => marketId.value, loadTables);

onMounted(loadTables);

// ── Changing a placement (E11/F03/S01) ─────────────────────────────────────────
//
// Two operations and no third: fill a seat, or trade two vendors' seats atomically. A "move"
// that displaces whoever is already there does not exist, because that is how a vendor is
// silently unassigned on market day. Freeing a seat first is safe and mirrors what an organizer
// physically does, so it is the third control on an occupied seat rather than a hidden effect of
// the first.

interface OpenSeat {
  mode: 'place' | 'occupied';
  row: MarketTableRow;
  /** Fixed when only one side is free; null when the whole table is, and the seat is a choice. */
  seat: Seat | null;
  occupantEmail: string | null;
}

const openSeat = ref<OpenSeat | null>(null);
const placementBusy = ref(false);
const placementError = ref('');

function openPlace(row: MarketTableRow, seat: Seat | null): void {
  placementError.value = '';
  openSeat.value = { mode: 'place', row, seat, occupantEmail: null };
}

function openOccupied(row: MarketTableRow, email: string): void {
  placementError.value = '';
  openSeat.value = { mode: 'occupied', row, seat: null, occupantEmail: email };
}

function closePlacement(): void {
  openSeat.value = null;
  placementError.value = '';
}

/** Who already holds a table on one date - the people who cannot be placed again that day. */
function seatedOn(date: string): Set<string> {
  const seated = new Set<string>();
  for (const row of allRows.value) {
    if (row.date !== date) continue;
    for (const email of row.assignmentSlots ?? []) {
      if (email) seated.add(email.toLowerCase());
    }
  }
  return seated;
}

const placementCandidates = computed((): PlaceableVendor[] => {
  const seat = openSeat.value;
  if (!seat || seat.mode !== 'place') return [];
  const seated = seatedOn(seat.row.date);
  return vendors.value.filter((vendor) => !seated.has(vendor.email.toLowerCase()));
});

const swapTargets = computed((): SwapTarget[] => {
  const seat = openSeat.value;
  if (!seat || seat.mode !== 'occupied') return [];
  const targets: SwapTarget[] = [];
  for (const row of allRows.value) {
    if (row.date !== seat.row.date) continue;
    const status = rowStatus(row);
    const seen = new Set<string>();
    for (const [index, email] of (row.assignmentSlots ?? []).entries()) {
      if (!email || email === seat.occupantEmail || seen.has(email)) continue;
      seen.add(email);
      targets.push({
        email,
        tableCode: row.tableCode,
        seat: status.isFull ? FULL_TABLE : index === 0 ? HALF_TABLE_LEFT : HALF_TABLE_RIGHT,
      });
    }
  }
  return targets;
});

async function runPlacementChange(change: () => Promise<unknown>): Promise<void> {
  placementBusy.value = true;
  placementError.value = '';
  try {
    await change();
    closePlacement();
    // Re-read rather than patch the grid in place: the solver places everyone else around a pin,
    // so one change can move other vendors, and a locally patched grid would show a floor plan
    // nobody is standing on. A placement is a write to the market's stored assignment, so the
    // store re-reads the market too (E21/F02/S04): anything else showing it follows.
    await Promise.all([loadTables(), refreshMarket()]);
  } catch (err: unknown) {
    const data =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data
        : undefined;
    placementError.value = data?.error || 'That change could not be saved.';
  } finally {
    placementBusy.value = false;
  }
}

function placementsUrl(): string {
  return `/markets/${encodeURIComponent(marketId.value)}/placements`;
}

function placeVendor(payload: { email: string; seat: Seat }): void {
  const seat = openSeat.value;
  if (!seat) return;
  void runPlacementChange(() =>
    api.put(placementsUrl(), {
      email: payload.email,
      date: seat.row.date,
      tableCode: seat.row.tableCode,
      tableChoice: payload.seat,
    }),
  );
}

function freeSeat(): void {
  const seat = openSeat.value;
  if (!seat?.occupantEmail) return;
  void runPlacementChange(() =>
    api.delete(placementsUrl(), { data: { email: seat.occupantEmail, date: seat.row.date } }),
  );
}

function swapSeats(withEmail: string): void {
  const seat = openSeat.value;
  if (!seat?.occupantEmail) return;
  void runPlacementChange(() =>
    api.post(`${placementsUrl()}/swap`, {
      date: seat.row.date,
      emails: [seat.occupantEmail, withEmail],
    }),
  );
}
</script>

<template>
  <div class="tables-view">
    <div class="tables-card">
      <header class="tables-header">
        <!-- The screen, then the market. An organizer running two markets in the same week
             could open this one and have nothing on screen say whose tables these are - on the
             screen where a hand placement moves a real vendor to a real seat (E15/F02/S03). -->
        <h1 data-testid="tables-heading">
          {{ market ? `Tables: ${market.name}` : 'Tables' }}
        </h1>
      </header>

      <MarketArrival v-if="!market" :status="marketStatus" @retry="retryArrival" />
      <PhaseRail :market="market" />

      <div v-if="marketStatus !== 'missing'" class="tables-body">
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

        <div v-if="isLoading" class="status-message">Loading tables…</div>

        <template v-else-if="allRows.length === 0 && !errorMessage">
          <div class="empty-state">
            <p>No tables found for this market.</p>
          </div>
        </template>

        <template v-else-if="allRows.length > 0">
          <div class="filter-bar">
            <!-- The filters were computed from the URL and could only be cleared: nothing in the
                 product ever set one (E09/F02/S01, E11/F03/S02). -->
            <div class="filter-pickers">
              <label class="filter-picker">
                <span class="filter-picker-label">Date</span>
                <select
                  :value="dateFilter"
                  data-testid="tables-filter-date"
                  @change="setFilter('date', ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">All dates</option>
                  <option v-for="option in dateOptions" :key="option" :value="option">
                    {{ formatDisplayDate(option) }}
                  </option>
                </select>
              </label>
              <label class="filter-picker">
                <span class="filter-picker-label">Section</span>
                <select
                  :value="sectionFilter"
                  data-testid="tables-filter-section"
                  @change="setFilter('section', ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">All sections</option>
                  <option v-for="option in sectionOptions" :key="option" :value="option">
                    {{ option }}
                  </option>
                </select>
              </label>
              <label class="filter-picker">
                <span class="filter-picker-label">Tier</span>
                <select
                  :value="tierFilter"
                  data-testid="tables-filter-tier"
                  @change="setFilter('tier', ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">All tiers</option>
                  <option v-for="option in tierOptions" :key="option" :value="option">
                    {{ option }}
                  </option>
                </select>
              </label>
              <label class="filter-picker">
                <span class="filter-picker-label">Table</span>
                <select
                  :value="choiceFilter"
                  data-testid="tables-filter-choice"
                  @change="setFilter('choice', ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">Any size</option>
                  <option value="full">Full Tables</option>
                  <option value="half">Half Tables</option>
                </select>
              </label>
            </div>

            <div class="filter-chips" v-if="hasActiveFilters">
              <span class="filter-chips-label">Filters:</span>
              <button
                v-if="dateFilter"
                type="button"
                class="filter-chip"
                @click="clearFilter('date')"
                data-testid="tables-filter-chip-date"
              >
                Date: {{ dateFilter }}
                <span class="filter-chip-close" aria-hidden="true">×</span>
                <span class="visually-hidden">Remove date filter</span>
              </button>
              <button
                v-if="sectionFilter"
                type="button"
                class="filter-chip"
                @click="clearFilter('section')"
                data-testid="tables-filter-chip-section"
              >
                Section: {{ sectionFilter }}
                <span class="filter-chip-close" aria-hidden="true">×</span>
                <span class="visually-hidden">Remove section filter</span>
              </button>
              <button
                v-if="tierFilter"
                type="button"
                class="filter-chip"
                @click="clearFilter('tier')"
                data-testid="tables-filter-chip-tier"
              >
                Tier: {{ tierFilter }}
                <span class="filter-chip-close" aria-hidden="true">×</span>
                <span class="visually-hidden">Remove tier filter</span>
              </button>
              <button
                v-if="choiceFilter"
                type="button"
                class="filter-chip"
                @click="clearFilter('choice')"
                data-testid="tables-filter-chip-choice"
              >
                {{ choiceFilterLabel(choiceFilter) }}
                <span class="filter-chip-close" aria-hidden="true">×</span>
                <span class="visually-hidden">Remove choice filter</span>
              </button>
              <button
                type="button"
                class="filter-chip filter-chip--clear-all"
                @click="clearAllFilters"
                data-testid="tables-filter-chip-clear-all"
              >
                Clear all
              </button>
            </div>

            <div class="counts-row">
              <span class="counts-primary">
                {{ filteredRows.length }} of {{ allRows.length }} tables
              </span>
              <span
                v-for="pill in countPills"
                :key="pill.kind"
                class="count-badge"
                :class="pill.fill"
                :data-testid="`tables-count-${pill.kind}`"
                >{{ pill.count }} {{ pill.kind }}</span
              >
            </div>
          </div>

          <div v-if="filteredRows.length === 0" class="empty-state">
            <p>No tables match the current filters.</p>
          </div>

          <div v-else class="date-groups">
            <section
              v-for="dateGroup in groupedRows"
              :key="dateGroup.date"
              class="date-group"
              :data-date="dateGroup.date"
              data-testid="tables-date-group"
            >
              <h2 class="date-heading">
                <span>{{ dateGroup.displayDate }}</span>
                <span class="date-heading-count">{{ dateGroup.rowCount }} tables</span>
              </h2>

              <div
                v-for="sectionGroup in dateGroup.sections"
                :key="`${dateGroup.date}-${sectionGroup.section}`"
                class="section-group"
              >
                <h3 class="section-heading">
                  <span class="section-heading-name">{{ sectionGroup.section }}</span>
                  <span v-if="sectionGroup.location" class="section-heading-meta">{{
                    sectionGroup.location
                  }}</span>
                  <span v-if="sectionGroup.tier" class="section-heading-meta">{{
                    sectionGroup.tier
                  }}</span>
                </h3>

                <ul class="table-list">
                  <li
                    v-for="row in sectionGroup.rows"
                    :key="`${row.date}-${row.tableCode}`"
                    class="table-row"
                    :class="{
                      'table-row--empty': rowStatus(row).label === 'empty',
                      'table-row--partial': rowStatus(row).label === 'partial',
                    }"
                    :data-table-code="row.tableCode"
                    data-testid="tables-table-row"
                  >
                    <div class="table-row-head">
                      <span class="table-code">{{ row.tableCode }}</span>
                      <span
                        class="choice-badge"
                        :class="
                          row.tableChoice.toLowerCase().includes('full')
                            ? 'choice-badge--full'
                            : 'choice-badge--half'
                        "
                      >
                        {{ row.tableChoice }}
                      </span>
                      <span v-if="row.tier" class="meta-tag">{{ row.tier }}</span>
                      <span v-if="row.location" class="meta-tag">{{ row.location }}</span>
                    </div>

                    <!-- Every seat is a control: an empty one is filled, an occupied one is
                         freed or traded. A table holds two seats, so a seat - not a table - is
                         what a placement names (E11/F03/S01). -->
                    <div class="table-row-assignment">
                      <template v-if="rowStatus(row).label === 'empty'">
                        <button
                          type="button"
                          class="seat-button seat-button--vacant"
                          data-testid="tables-seat-empty"
                          @click="openPlace(row, null)"
                        >
                          <span class="assignment-empty">Unassigned</span>
                          <span class="seat-button-hint">Place someone</span>
                        </button>
                      </template>
                      <template v-else-if="rowStatus(row).isFull">
                        <button
                          type="button"
                          class="seat-button"
                          data-testid="tables-seat-occupied"
                          :data-vendor-email="rowStatus(row).leftEmail"
                          @click="openOccupied(row, rowStatus(row).leftEmail!)"
                        >
                          <VendorIdentity
                            class="assignment-email assignment-email--full"
                            :email="rowStatus(row).leftEmail"
                            :names="vendorNames"
                          />
                          <span class="seat-button-hint">Change</span>
                        </button>
                      </template>
                      <template v-else>
                        <div class="half-slot">
                          <span class="half-slot-label">Left</span>
                          <button
                            v-if="rowStatus(row).leftEmail"
                            type="button"
                            class="seat-button"
                            data-testid="tables-seat-occupied"
                            :data-vendor-email="rowStatus(row).leftEmail"
                            @click="openOccupied(row, rowStatus(row).leftEmail!)"
                          >
                            <VendorIdentity
                              class="assignment-email"
                              :email="rowStatus(row).leftEmail"
                              :names="vendorNames"
                            />
                            <span class="seat-button-hint">Change</span>
                          </button>
                          <button
                            v-else
                            type="button"
                            class="seat-button seat-button--vacant"
                            data-testid="tables-seat-empty"
                            @click="openPlace(row, HALF_TABLE_LEFT)"
                          >
                            <span class="assignment-email assignment-email--vacant">Vacant</span>
                            <span class="seat-button-hint">Place someone</span>
                          </button>
                        </div>
                        <div class="half-slot">
                          <span class="half-slot-label">Right</span>
                          <button
                            v-if="rowStatus(row).rightEmail"
                            type="button"
                            class="seat-button"
                            data-testid="tables-seat-occupied"
                            :data-vendor-email="rowStatus(row).rightEmail"
                            @click="openOccupied(row, rowStatus(row).rightEmail!)"
                          >
                            <VendorIdentity
                              class="assignment-email"
                              :email="rowStatus(row).rightEmail"
                              :names="vendorNames"
                            />
                            <span class="seat-button-hint">Change</span>
                          </button>
                          <button
                            v-else
                            type="button"
                            class="seat-button seat-button--vacant"
                            data-testid="tables-seat-empty"
                            @click="openPlace(row, HALF_TABLE_RIGHT)"
                          >
                            <span class="assignment-email assignment-email--vacant">Vacant</span>
                            <span class="seat-button-hint">Place someone</span>
                          </button>
                        </div>
                      </template>
                    </div>
                  </li>
                </ul>
              </div>
            </section>
          </div>
        </template>
      </div>

      <div v-if="marketStatus !== 'missing'" class="actions-row">
        <button
          type="button"
          class="primary-button"
          @click="goBack"
          data-testid="tables-back-button"
        >
          Back
        </button>
      </div>
    </div>

    <PlacementDialog
      v-if="openSeat"
      :open="true"
      :mode="openSeat.mode"
      :date="openSeat.row.date"
      :dateLabel="formatDisplayDate(openSeat.row.date)"
      :tableCode="openSeat.row.tableCode"
      :section="openSeat.row.section"
      :tier="openSeat.row.tier"
      :seat="openSeat.seat"
      :occupantEmail="openSeat.occupantEmail"
      :candidates="placementCandidates"
      :swapTargets="swapTargets"
      :vendorNames="vendorNames"
      :busy="placementBusy"
      :errorMessage="placementError"
      @place="placeVendor"
      @free="freeSeat"
      @swap="swapSeats"
      @close="closePlacement"
    />
  </div>
</template>

<style scoped>
.tables-view {
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 40px 20px;
  display: flex;
  justify-content: center;
  /* flex-start, not the default `stretch`: a stretched card is forced to the height of this
     container (100vh minus padding) regardless of what it holds. Combined with the card's
     `overflow: hidden` that clipped 1,942px of the 2,762px of table rows with no scrollbar
     anywhere - six of twenty-four tables visible, the second market date unreachable - and it is
     the same reason the Attendance card was an 820px slab holding 200px of content. */
  align-items: flex-start;
  background-color: var(--mm-beige);
}

.tables-card {
  width: 100%;
  max-width: var(--list-max);
  background-color: white;
  box-shadow: var(--shadow-card);
  border-radius: var(--radius-card);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  /* Grow with the content, then cap at the viewport and let the body scroll, so the header and
     the actions row stay put on a long list. Same shape as the assignment results page. */
  max-height: 100%;
}

.tables-header {
  background-color: var(--mm-black);
  padding: 18px 24px;
}

.tables-header h1 {
  margin: 0;
  color: white;
  font-size: var(--text-xl);
  text-align: center;
}

.tables-body {
  padding: 24px;
  color: var(--mm-black);
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  overflow-y: auto;
}

.filter-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  background-color: white;
  padding: 12px 0;
  border-bottom: 1px solid var(--mm-border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.filter-chips-label {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background-color: var(--mm-beige);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  color: var(--mm-black);
  cursor: pointer;
  transition:
    background-color 0.12s ease-in-out,
    border-color 0.12s ease-in-out;
}

.filter-chip:hover {
  background-color: white;
  border-color: var(--mm-green);
}

.filter-chip:focus-visible {
  outline: 2px solid var(--mm-green);
  outline-offset: 2px;
}

.filter-chip-close {
  font-size: var(--text-md);
  line-height: 1;
  color: var(--mm-black);
  font-weight: 600;
}

.filter-chip--clear-all {
  background-color: white;
  border-style: dashed;
}

.counts-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  font-size: var(--text-sm);
}

.counts-primary {
  /* Figures in a column need fixed-width digits (E15/F01/S03). Outfit's 0, 1 and 2 are different
     widths, so a right-aligned group shifts by a pixel or two per row and the column reads ragged
     down the list. */
  font-variant-numeric: tabular-nums;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.count-badge {
  /* Figures in a column need fixed-width digits (E15/F01/S03). Outfit's 0, 1 and 2 are different
     widths, so a right-aligned group shifts by a pixel or two per row and the column reads ragged
     down the list. */
  font-variant-numeric: tabular-nums;
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: var(--radius-card);
  font-size: var(--text-xs);
}

.count-badge--assigned {
  background-color: var(--mm-green);
  color: white;
}

.count-badge--partial {
  background-color: var(--mm-yellow);
  color: var(--mm-black);
}

/*
 * The neutral pill, and the one a count of zero falls back to.
 *
 * Black on beige is 12.49. The obvious alternative - muted text, to say "nothing here" - is 4.24 on
 * beige and so below AA, and `contrast.test.ts` would not have caught it: it holds only --mm-black
 * to the beige ground, because --mm-black was the only thing ever set on it. Quieten a pill by
 * changing its FILL, never by lowering its text.
 */
.count-badge--empty,
.count-badge--none {
  background-color: var(--mm-beige);
  color: var(--mm-black);
  border: 1px solid var(--mm-border);
}

.status-message {
  padding: 40px 0;
  text-align: center;
  color: var(--mm-black);
  opacity: 0.7;
}

.empty-state {
  padding: 40px 0;
  text-align: center;
  color: var(--mm-black);
  opacity: 0.6;
}

.date-groups {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.date-group {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.date-heading {
  margin: 0;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--mm-black);
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  color: var(--mm-black);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.date-heading-count {
  font-size: var(--text-sm);
  color: var(--mm-black);
  opacity: 0.6;
}

.section-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-left: 4px;
}

.section-heading {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-md);
  color: var(--mm-black);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.section-heading-name {
  font-size: var(--text-md);
}

.section-heading-meta {
  /* Not redundant, unlike the 273 declarations E15/F01/S01 removed: `.section-heading` sets Merge
     One on the <h3>, and this chip is a <span> inside it, so it opts back out. */
  font-family: 'Outfit', sans-serif;
  font-size: var(--text-xs);
  padding: 2px 8px;
  background-color: var(--mm-beige);
  border-radius: var(--radius-card);
  color: var(--mm-black);
}

.table-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.table-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  background-color: white;
  border-radius: var(--radius-card);
  border-left: 4px solid var(--mm-green);
  box-shadow: var(--shadow-card);
}

.table-row--partial {
  border-left-color: var(--mm-yellow);
}

.table-row--empty {
  border-left-color: var(--mm-yellow);
  background-color: rgba(228, 166, 41, 0.18);
}

.table-row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.table-code {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  color: var(--mm-black);
  letter-spacing: 0.5px;
}

.choice-badge {
  font-size: var(--text-xs);
  padding: 2px 10px;
  border-radius: var(--radius-card);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.choice-badge--full {
  background-color: var(--mm-green);
  color: white;
}

.choice-badge--half {
  background-color: var(--mm-beige);
  color: var(--mm-black);
  border: 1px solid var(--mm-border);
}

.meta-tag {
  font-size: var(--text-xs);
  color: var(--mm-black);
  opacity: 0.65;
}

.table-row-assignment {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding-top: 4px;
  border-top: 1px dashed var(--mm-border);
}

.assignment-email {
  font-size: var(--text-sm);
  color: var(--mm-black);
  word-break: break-word;
}

.assignment-email--full {
  font-weight: 600;
}

.assignment-email--vacant {
  color: var(--mm-black);
  opacity: 0.5;
  font-style: italic;
}

.assignment-empty {
  font-size: var(--text-sm);
  color: var(--mm-black);
  opacity: 0.6;
  font-style: italic;
}

.half-slot {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

/* A seat is a control, so it looks like one: bordered, hovering, focusable. It stays quiet at
   rest because a page of twenty-four tables is a page of forty-eight of these, and a grid of
   buttons shouting at once is harder to read than the list it replaced. */
.seat-button {
  display: flex;
  align-items: baseline;
  gap: 8px;
  /* Sized to its occupant, not to the row. A full-width button lit the whole row on hover, which
     reads as "this table" rather than "this seat" - and a table holds two of them. */
  align-self: flex-start;
  max-width: 100%;
  min-width: 0;
  text-align: left;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

/* Bordered at rest, not only on hover. A vendor's name with no box around it does not look like
   anything you can press, and an organizer who cannot tell a seat is a control has no way to
   reach the change they came for (E09/F03). */
.seat-button {
  border-color: var(--mm-border);
}

.seat-button:hover {
  border-color: var(--mm-green);
  background: var(--mm-beige);
}

.seat-button:focus-visible {
  outline: 2px solid var(--mm-green);
  outline-offset: 1px;
}

/* Dashed for a seat with nobody in it, solid for one with somebody: the difference between an
   opening and a person is worth reading before any of the text is. */
.seat-button--vacant {
  border-style: dashed;
}

/* Shown only on hover or focus: at rest the word "Vacant" is the whole message, and repeating
   "Place someone" on every empty seat turns a floor plan into a wall of instructions. */
/* Shown on hover or focus, but its space is reserved always: a hint that appears and pushes the
   row taller makes the grid jump under the pointer. `nowrap` keeps it beside the label rather
   than below it, so a vacant seat is exactly as tall as an occupied one. */
.seat-button-hint {
  font-size: var(--text-xs);
  white-space: nowrap;
  color: var(--mm-text-link);
  opacity: 0;
}

.seat-button:hover .seat-button-hint,
.seat-button:focus-visible .seat-button-hint {
  opacity: 1;
}

.filter-pickers {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.filter-picker {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.filter-picker-label {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.filter-picker select {
  padding: 6px 8px;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
  font-size: var(--text-xs);
  color: var(--mm-black);
  max-width: 100%;
}

.half-slot-label {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-xs);
  text-transform: uppercase;
  color: var(--mm-black);
  opacity: 0.55;
  letter-spacing: 0.6px;
}

.actions-row {
  padding: 16px 24px;
  display: flex;
  justify-content: flex-start;
  border-top: 1px solid var(--mm-border);
}

.primary-button {
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: var(--radius-control);
  padding: 0 18px;
  height: 38px;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-md);
  cursor: pointer;
  transition: opacity 0.12s ease-in-out;
}

.primary-button:hover:not(:disabled) {
  opacity: 0.9;
}

.primary-button:focus-visible {
  outline: 2px solid var(--mm-black);
  outline-offset: 2px;
}

.error-text {
  margin: 0 0 12px;
  color: var(--mm-red);
  font-size: var(--text-sm);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 720px) {
  .tables-view {
    padding: 20px 12px;
  }

  .tables-body {
    padding: 16px;
  }

  .date-heading {
    font-size: var(--text-lg);
  }

  .table-row-head {
    gap: 8px;
  }

  .table-code {
    font-size: var(--text-lg);
  }
}
</style>
