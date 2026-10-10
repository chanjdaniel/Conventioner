<script setup lang="ts">
/**
 * The Result page: the assignment, read and changed in one place (E22/F04/S04).
 *
 * It was the Tables screen, reached by a quick link from a results page under the rules. The
 * organizer's "result" is who sits where, which is this grid, so the grid became the page: a
 * summary strip on top (`ResultSummary`), then the tables with their seat editing, then the
 * placement history. It stands under the Assignment tab, beside the rules and the Vendors page.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { api } from '@/utils/api';
import { getFormattedDate } from '@/utils/utils';
import { type VendorNames } from '@/utils/vendorIdentity';
import PlacementDialog, { type SwapTarget } from '@/components/PlacementDialog.vue';
import ResultSeat from '@/components/ResultSeat.vue';
import MarketFrame from '@/components/MarketFrame.vue';
import { useOpenMarket } from '@/utils/openMarket';
import ResultSummary from '@/components/ResultSummary.vue';
import ResultFilterBar from '@/components/ResultFilterBar.vue';
import { useResultFilters } from '@/utils/useResultFilters';
import PlacementHistory from '@/components/PlacementHistory.vue';
import {
  FULL_TABLE,
  HALF_TABLE_LEFT,
  HALF_TABLE_RIGHT,
  type PlaceableVendor,
  type Seat,
} from '@/utils/placementChange';
import {
  TABLE_STATUSES,
  filterOptions,
  filtersBeside,
  rowStatus,
  statusCounts as countStatuses,
  tablesMatching,
  type MarketTableRow,
  type TableStatus,
} from '@/utils/resultFilters';

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

const route = useRoute();

const marketId = computed(() => String(route.params.marketId ?? ''));
/** The lifecycle band below this screen's header (E10/F01/S01). */
const { market, refresh: refreshMarket } = useOpenMarket(marketId);

/**
 * Tables the plan no longer has that a hand placement still names (bug 31): shown with the vendor
 * still in them, so they are marked, since Publish is refused until each is moved or freed.
 */
const orphanedSeats = computed(
  () => new Set((market.value?.orphanedPins ?? []).map((pin) => `${pin.date}|${pin.tableCode}`)),
);

const allRows = ref<MarketTableRow[]>([]);
/** Email to name, from the same response as the rows, so a table and its occupant agree. */
const vendorNames = ref<VendorNames>({});
/** Who may be put in a seat, and what they asked for - so a change that alters their table
    choice can be said out loud before it is made. */
const vendors = ref<PlaceableVendor[]>([]);
const isLoading = ref(false);
const errorMessage = ref('');

/**
 * The filters live in the address. The system was once complete and unreachable: every filter was
 * computed from `route.query`, the chips could clear one, and nothing in the product ever set one -
 * so an organizer could only narrow this view by editing the address bar (`E09/F02/S01`,
 * `E11/F03/S02`). The bar sets them now, and the counts set the status (E28/F02/S01).
 */
const { filters, setFilter } = useResultFilters();
const OFFERED = filtersBeside('tables');
const statusFilter = computed(() => filters.value.status);

function formatDisplayDate(date: string): string {
  return getFormattedDate(date) ?? date;
}

const filteredRows = computed(() => tablesMatching(allRows.value, filters.value));

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

const statusCounts = computed(() => countStatuses(allRows.value, filters.value));

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
  TABLE_STATUSES.map((kind) => {
    const count = statusCounts.value[kind];
    return { kind, count, fill: count === 0 ? 'count-badge--none' : `count-badge--${kind}` };
  }),
);

/**
 * A count is also the way to see those tables (E28/F02/S01): choosing it filters to them, and
 * choosing it again lets go. A zero is not a condition to act on, so it cannot be chosen.
 */
function toggleStatus(kind: TableStatus): void {
  setFilter('status', statusFilter.value === kind ? '' : kind);
}

const filterOptionsShown = computed(() => filterOptions(allRows.value));

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
  openSeat.value = { mode: 'occupied', row, seat: seatHeldBy(row, email), occupantEmail: email };
}

/** One side of a shared table: changed if somebody holds it, filled if nobody does. */
function openHalf(row: MarketTableRow, email: string | null, side: Seat): void {
  if (email) openOccupied(row, email);
  else openPlace(row, side);
}

/**
 * Nothing on this page may change the market (bug 30): it is archived, and so a record. The
 * server refuses every placement write on it; the seats say so by offering none.
 */
const readOnly = computed(() => Boolean(market.value?.readOnlyReason));

/** Which seat at this table a vendor holds: the whole of it, or one side. */
function seatHeldBy(row: MarketTableRow, email: string): Seat {
  if (rowStatus(row).isFull) return FULL_TABLE;
  return row.assignmentSlots?.[0] === email ? HALF_TABLE_LEFT : HALF_TABLE_RIGHT;
}

function closePlacement(): void {
  openSeat.value = null;
  placementError.value = '';
}

/**
 * The dates each vendor holds a seat on, keyed by lowercased address - who cannot be placed again
 * on a date, and how many dates a placement would give them against their own limit and the
 * market's ceiling.
 */
const datesHeld = computed((): Record<string, string[]> => {
  const held: Record<string, Set<string>> = {};
  for (const row of allRows.value) {
    for (const email of row.assignmentSlots ?? []) {
      if (email) (held[email.toLowerCase()] ??= new Set()).add(row.date);
    }
  }
  return Object.fromEntries(Object.entries(held).map(([email, dates]) => [email, [...dates]]));
});

const marketCeiling = computed(
  () => market.value?.setupObject?.assignmentOptions?.maxAssignmentsPerVendor ?? null,
);

const swapTargets = computed((): SwapTarget[] => {
  const seat = openSeat.value;
  if (!seat || seat.mode !== 'occupied') return [];
  const targets: SwapTarget[] = [];
  for (const row of allRows.value) {
    if (row.date !== seat.row.date) continue;
    const seen = new Set<string>();
    for (const email of row.assignmentSlots ?? []) {
      if (!email || email === seat.occupantEmail || seen.has(email)) continue;
      seen.add(email);
      targets.push({
        email,
        tableCode: row.tableCode,
        tier: row.tier,
        seat: seatHeldBy(row, email),
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
    <MarketFrame :market="market" @retry="loadTables">
      <div class="tables-body">
        <!-- The Result page (E22/F04/S04): how the assignment came out, then the tables it sits on,
             then who changed what. -->
        <ResultSummary v-if="market" :market="market" />
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

        <div v-if="isLoading" class="status-message">Loading tables…</div>

        <template v-else-if="allRows.length === 0 && !errorMessage">
          <div class="empty-state">
            <p>No tables found for this market.</p>
          </div>
        </template>

        <template v-else-if="allRows.length > 0">
          <ResultFilterBar
            class="filter-band"
            :offered="OFFERED"
            :options="filterOptionsShown"
            testid="tables"
          >
            <div class="counts-row">
              <span class="counts-primary">
                {{ filteredRows.length }} of {{ allRows.length }} tables
              </span>
              <!-- Each count shows its tables (E28/F02/S01). -->
              <button
                v-for="pill in countPills"
                :key="pill.kind"
                type="button"
                class="count-badge"
                :class="pill.fill"
                :aria-pressed="statusFilter === pill.kind"
                :disabled="pill.count === 0 && statusFilter !== pill.kind"
                :title="pill.count === 0 ? undefined : `Show only ${pill.kind} tables`"
                :aria-label="pill.count === 0 ? `0 ${pill.kind}, none to show` : undefined"
                :data-testid="`tables-count-${pill.kind}`"
                @click="toggleStatus(pill.kind)"
              >
                <span v-if="statusFilter === pill.kind" class="count-badge-tick" aria-hidden="true"
                  >✓</span
                >{{ pill.count }} {{ pill.kind }}
              </button>
            </div>
          </ResultFilterBar>

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
                      <!-- The size its occupants chose; a table nobody is at has none (bug 43 - an
                           empty table was badged "FULL TABLE"). -->
                      <span
                        v-if="rowStatus(row).label !== 'empty'"
                        class="chip"
                        :class="
                          row.tableChoice.toLowerCase().includes('full')
                            ? 'chip--positive'
                            : 'chip--neutral'
                        "
                        data-testid="tables-table-choice"
                      >
                        {{ row.tableChoice }}
                      </span>
                      <span v-if="row.tier" class="meta-tag">{{ row.tier }}</span>
                      <span v-if="row.location" class="meta-tag">{{ row.location }}</span>
                      <span
                        v-if="orphanedSeats.has(`${row.date}|${row.tableCode}`)"
                        class="chip chip--attention"
                        data-testid="tables-orphaned"
                        >No longer in the plan - move or free this vendor</span
                      >
                    </div>

                    <!-- Every seat is a control: an empty one is filled, an occupied one is
                         freed or traded. A table holds two seats, so a seat - not a table - is
                         what a placement names (E11/F03/S01). On a market that cannot change,
                         every seat is a record instead (bug 30). -->
                    <div class="table-row-assignment">
                      <ResultSeat
                        v-if="rowStatus(row).label === 'empty'"
                        :email="null"
                        vacantLabel="Unassigned"
                        :names="vendorNames"
                        :readOnly="readOnly"
                        @open="openPlace(row, null)"
                      />
                      <ResultSeat
                        v-else-if="rowStatus(row).isFull"
                        :email="rowStatus(row).leftEmail"
                        vacantLabel="Unassigned"
                        whole
                        :names="vendorNames"
                        :readOnly="readOnly"
                        @open="openOccupied(row, rowStatus(row).leftEmail!)"
                      />
                      <template v-else>
                        <div class="half-slot">
                          <span class="half-slot-label">Left</span>
                          <ResultSeat
                            :email="rowStatus(row).leftEmail"
                            vacantLabel="Vacant"
                            :names="vendorNames"
                            :readOnly="readOnly"
                            @open="openHalf(row, rowStatus(row).leftEmail, HALF_TABLE_LEFT)"
                          />
                        </div>
                        <div class="half-slot">
                          <span class="half-slot-label">Right</span>
                          <ResultSeat
                            :email="rowStatus(row).rightEmail"
                            vacantLabel="Vacant"
                            :names="vendorNames"
                            :readOnly="readOnly"
                            @open="openHalf(row, rowStatus(row).rightEmail, HALF_TABLE_RIGHT)"
                          />
                        </div>
                      </template>
                    </div>
                  </li>
                </ul>
              </div>
            </section>
          </div>
        </template>
        <PlacementHistory v-if="market" :marketId="market.id" />
      </div>
    </MarketFrame>

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
      :vendors="vendors"
      :datesHeld="datesHeld"
      :marketCeiling="marketCeiling"
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
  /* The frame places itself on the page (E26/F10/S01); this holds it and the placement dialog. */
  width: 100%;
}

.tables-body {
  padding: 24px;
  color: var(--mm-black);
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Stays in view over the tables it filters. */
.filter-band {
  position: sticky;
  top: 0;
  z-index: 2;
  background-color: white;
  padding: 12px 0;
  border-bottom: 1px solid var(--mm-border);
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
  /* Every pill carries a border, in its own fill where it needs none, so all three are one height:
     "assigned" was 2px shorter than its neighbours. */
  border: 1px solid transparent;
  border-radius: var(--radius-card);
  font-family: inherit;
  font-size: var(--text-xs);
  line-height: normal;
  cursor: pointer;
}

.count-badge:hover:not(:disabled) {
  opacity: 0.9;
}

/* The chosen count is ticked, as a filter chip is: its fill already says which status it is. */
.count-badge[aria-pressed='true'] {
  font-weight: 600;
}

.count-badge-tick {
  margin-right: var(--space-1);
  font-weight: 600;
}

/* Nothing to show: the zero stops offering itself, and stays legible - its neutral fill already
   quietens it (see `.count-badge--none`). */
.count-badge:disabled {
  cursor: default;
}

.count-badge--assigned {
  background-color: var(--mm-green);
  border-color: var(--mm-green);
  color: white;
}

.count-badge--partial {
  background-color: var(--mm-yellow);
  border-color: var(--mm-yellow);
  color: var(--mm-black);
}

/*
 * Black on beige is 12.49. The obvious alternative - muted text, to say "nothing here" - is 4.24 on
 * beige and so below AA, and `contrast.test.ts` would not have caught it: it holds only --mm-black
 * to the beige ground, because --mm-black was the only thing ever set on it. Quieten a pill by
 * changing its FILL, never by lowering its text.
 */
.count-badge--empty,
.count-badge--none {
  background-color: var(--mm-beige);
  color: var(--mm-black);
  border-color: var(--mm-border);
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

.half-slot {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.half-slot-label {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-xs);
  text-transform: uppercase;
  color: var(--mm-black);
  opacity: 0.55;
  letter-spacing: 0.6px;
}

.error-text {
  margin: 0 0 12px;
  color: var(--mm-red);
  font-size: var(--text-sm);
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
