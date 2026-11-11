<script setup lang="ts">
/**
 * The Assignments page: the assignment, read and changed in one place (E22/F04/S04).
 *
 * It was the Tables screen, reached by a quick link from a results page under the rules. The
 * organizer's "result" is who sits where, which is this grid, so the grid became the page: a
 * summary strip on top (`ResultSummary`), then the tables with their seat editing. It stands under
 * the Assignment tab, between Settings and Vendors, and was called Result until the pages took the
 * names of what they hold (E38/F08/S01).
 */
import { MarketAction, mayTake } from '@/utils/marketActions';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { api, getApiErrorMessage, isMarketChanged } from '@/utils/api';
import { getFormattedDate } from '@/utils/utils';
import { vendorName, type VendorNames } from '@/utils/vendorIdentity';
import { formatPrice } from '@/utils/pricing';
import { loadAccount } from '@/utils/payments';
import PlacementDialog from '@/components/PlacementDialog.vue';
import ResultSeat from '@/components/ResultSeat.vue';
import VendorDrawer from '@/components/VendorDrawer.vue';
import { useVendorDetails } from '@/utils/vendorDetails';
import { useVendorDrawer } from '@/utils/vendorDrawer';
import MarketFrame from '@/components/MarketFrame.vue';
import { useOpenMarket } from '@/utils/openMarket';
import { hasAssignment } from '@/utils/marketPage';
import { canAssignIn } from '@/utils/assignPhase';
import ResultSummary from '@/components/ResultSummary.vue';
import ResultFilterBar from '@/components/ResultFilterBar.vue';
import ReadFailed from '@/components/ReadFailed.vue';
import RowGroup from '@/components/RowGroup.vue';
import { useGroupFolds } from '@/utils/useGroupFolds';
import { useResultFilters } from '@/utils/useResultFilters';
import {
  HALF_TABLE_LEFT,
  HALF_TABLE_RIGHT,
  emptySeatsOn,
  seatHeldBy,
  seatedOn,
  type EmptySeat,
  type PlaceableVendor,
  type Seat,
  type SeatedVendor,
} from '@/utils/placementChange';
import {
  TABLE_STATUSES,
  filterOptions,
  filtersBeside,
  rowStatus,
  sectionsOnTheGrid,
  statusCounts as countStatuses,
  tablesMatching,
  type GridSection,
  type MarketTableRow,
  type TableStatus,
  type VendorSearch,
} from '@/utils/resultFilters';

interface DateGroup {
  date: string;
  displayDate: string;
  sections: GridSection[];
  rowCount: number;
}

const route = useRoute();

const marketId = computed(() => String(route.params.marketId ?? ''));
/** The lifecycle band below this screen's header (E10/F01/S01). */
const { market, refresh: refreshMarket } = useOpenMarket(marketId);

/**
 * Whoever holds a seat opens their drawer (E35/F01/S02), from their name or the seat's dialog. The
 * vendors are read the first time it opens, and again after a change here moves anyone.
 */
const details = useVendorDetails(marketId, market);
const drawer = useVendorDrawer();

/**
 * Tables the plan no longer has that a hand placement still names (bug 31): shown with the vendor
 * still in them, so they are marked, since Publish is refused until each is moved or freed.
 */
const orphanedSeats = computed(
  () => new Set((market.value?.orphanedPins ?? []).map((pin) => `${pin.date}|${pin.tableCode}`)),
);

/**
 * The tables are the result, so before one is stored they are drawn only where a run can happen:
 * there they are where a vendor is pinned before the first run (E11/F02/S01), as the summary says.
 * Anywhere else a grid of empty tables would read as an assignment that came out empty
 * (E31/F03/S05).
 */
const tablesShown = computed(() => hasAssignment(market.value) || canAssignIn(market.value?.phase));

const allRows = ref<MarketTableRow[]>([]);
/** Email to name, from the same response as the rows, so a table and its occupant agree. */
const vendorNames = ref<VendorNames>({});
/** What the search finds each vendor by beyond their address, from the same response (E35/F02/S01). */
const vendorSearch = ref<VendorSearch>({});
/** Who may be put in a seat, and what they asked for - so a change that alters their table
    choice can be said out loud before it is made. */
const vendors = ref<PlaceableVendor[]>([]);
/** Who holds a seat by hand though the review left them out, as the tables read says (E36/F02/S03). */
const notApprovedAddresses = computed(
  () => new Set(vendors.value.filter((v) => v.notApproved).map((v) => v.email.toLowerCase())),
);
function notApproved(email: string | null | undefined): boolean {
  return Boolean(email) && notApprovedAddresses.value.has(String(email).toLowerCase());
}
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

const filteredRows = computed(() =>
  tablesMatching(allRows.value, filters.value, vendorSearch.value),
);

const groupedRows = computed((): DateGroup[] => {
  const byDate = new Map<string, MarketTableRow[]>();
  for (const row of filteredRows.value) {
    const rows = byDate.get(row.date);
    if (rows) rows.push(row);
    else byDate.set(row.date, [row]);
  }

  const dateGroups: DateGroup[] = [];
  for (const [date, rows] of byDate.entries()) {
    const sections = sectionsOnTheGrid(rows, market.value?.setupObject);
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

/** How many tables a section shows before "Show all 31 in Gold Hall" (L7). */
const SECTION_FOLD = 20;

/** A section's fold stands for it on one date, whatever the filters do to it. */
const sectionKey = (date: string, section: string) => `${date}|${section}`;

/**
 * Each section's fold, held here because a re-read unmounts the sections: a placement or a swap
 * leaves the page as the organizer had it. The page's search narrows first, and one "Show all" lets
 * the browser's own find reach every table.
 */
const {
  allUnfolded: allSectionsUnfolded,
  isUnfolded: isSectionUnfolded,
  offered: aSectionFolds,
  reset: forgetSectionFolds,
  rows: tablesOnThePage,
  setUnfolded: setSectionUnfolded,
  toggleAll: toggleAllSections,
} = useGroupFolds(
  () =>
    groupedRows.value.flatMap(({ date, sections }) =>
      sections.map(({ section, rows }) => ({
        key: sectionKey(date, section),
        rows: rows.length,
      })),
    ),
  SECTION_FOLD,
);

const statusCounts = computed(() =>
  countStatuses(allRows.value, filters.value, vendorSearch.value),
);

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
      vendorSearch?: VendorSearch;
      vendors?: PlaceableVendor[];
    }>(`/markets/${encodeURIComponent(marketId.value)}/tables`);
    allRows.value = Array.isArray(resp.data?.rows) ? resp.data.rows : [];
    vendorNames.value = resp.data?.vendorNames ?? {};
    vendorSearch.value = resp.data?.vendorSearch ?? {};
    vendors.value = Array.isArray(resp.data?.vendors) ? resp.data.vendors : [];
  } catch (err: unknown) {
    errorMessage.value = getApiErrorMessage(err, 'The tables could not be loaded.');
    allRows.value = [];
    vendorNames.value = {};
    vendorSearch.value = {};
    vendors.value = [];
  } finally {
    isLoading.value = false;
  }
}

watch(
  () => marketId.value,
  () => {
    forgetSectionFolds();
    allRows.value = [];
    void loadTables();
  },
);

onMounted(loadTables);

// ── Changing a placement (E11/F03/S01) ─────────────────────────────────────────
//
// Three changes and never a fourth: fill a seat, from nobody or from another table; trade two
// vendors' seats atomically; or free a seat. Moving a vendor to an empty seat is the fill, one
// write that replaces the seat they held that date, so they never stand at no table (T208).
// Nothing puts a vendor into a seat somebody holds, because that is how a vendor is silently
// unassigned on market day; freeing is its own control on an occupied seat, never a hidden effect
// of another.

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

/*
 * The tables stay up through the read a placement brings, and one change can move other vendors, so
 * until that read lands a seat says what it held. A press then opens nothing, or the dialog would act
 * on who the page no longer holds.
 */
function openPlace(row: MarketTableRow, seat: Seat | null): void {
  if (isLoading.value) return;
  placementError.value = '';
  openSeat.value = { mode: 'place', row, seat, occupantEmail: null };
}

function openOccupied(row: MarketTableRow, email: string): void {
  if (isLoading.value) return;
  placementError.value = '';
  openSeat.value = { mode: 'occupied', row, seat: seatHeldBy(row, email), occupantEmail: email };
}

/** One side of a shared table: changed if somebody holds it, filled if nobody does. */
function openHalf(row: MarketTableRow, email: string | null, side: Seat): void {
  if (email) openOccupied(row, email);
  else openPlace(row, side);
}

/**
 * Whether this person may place, swap or free a seat here: the table's Assignment row (bug 37,
 * E39/F01/S02), refused on an archived market, which is a record (bug 30). The server refuses
 * every placement write it would; the seats say so by offering none.
 */
const readOnly = computed(() => !mayTake(market.value, MarketAction.Assign));

function closePlacement(): void {
  openSeat.value = null;
  placementError.value = '';
}

/** From the seat's dialog to the drawer of whoever holds it. */
function viewOccupant(): void {
  const email = openSeat.value?.occupantEmail;
  closePlacement();
  if (email) drawer.open(email);
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

/**
 * Everyone seated on the open seat's date, and its empty seats, from every row of the date - never
 * the filtered rows, so a filter never hides the seat or the vendor a change needs (T208).
 */
const seated = computed((): SeatedVendor[] => {
  const seat = openSeat.value;
  if (!seat) return [];
  return seatedOn(allRows.value, seat.row.date, market.value?.setupObject);
});
const emptySeats = computed((): EmptySeat[] => {
  const seat = openSeat.value;
  if (seat?.mode !== 'occupied') return [];
  return emptySeatsOn(allRows.value, seat.row.date, market.value?.setupObject, seat.row.tableCode);
});

/** The tables and, when a vendor's details are open, those details, read again. */
function rereadTheTables(): Promise<unknown> {
  return Promise.all([loadTables(), details.loaded.value ? details.load() : Promise.resolve()]);
}

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
    await Promise.all([rereadTheTables(), refreshMarket()]);
  } catch (err: unknown) {
    placementError.value = getApiErrorMessage(err, 'That change could not be saved.');
    // Another change to the market landed first, so this one stored nothing (ADR 0024): the grid
    // is read again as after a success, and the sentence stays in the seat's dialog, which now
    // shows who sits where. The store's market is read again by the market-changed interceptor.
    if (isMarketChanged(err)) await rereadTheTables();
  } finally {
    placementBusy.value = false;
  }
}

function placementsUrl(): string {
  return `/markets/${encodeURIComponent(marketId.value)}/placements`;
}

/**
 * The one placement write: a vendor into one seat on the open seat's date, replacing whatever they
 * held that date. A placement and a move are both this request.
 */
function putPlacement(email: string, tableCode: string, tableChoice: Seat): void {
  const seat = openSeat.value;
  if (!seat) return;
  void runPlacementChange(() =>
    api.put(placementsUrl(), { email, date: seat.row.date, tableCode, tableChoice }),
  );
}

function placeVendor(payload: { email: string; seat: Seat }): void {
  const seat = openSeat.value;
  if (seat) putPlacement(payload.email, seat.row.tableCode, payload.seat);
}

/**
 * The open seat's vendor, moved to an empty seat on the same date (T208): the one placement write,
 * which replaces the seat they held that date, so their old seat is free and the day's line of what
 * they owe follows the new table's price.
 */
function moveOccupant(payload: { tableCode: string; seat: Seat }): void {
  const email = openSeat.value?.occupantEmail;
  if (email) putPlacement(email, payload.tableCode, payload.seat);
}

/**
 * What the open seat's vendor owes for its day, read from their account when the seat opens, for
 * whoever may change the amount owed: the line's own amount, set by hand or calculated, which is
 * what the deduction takes away. Null until it is read, and for anyone else.
 */
const seatOwed = ref<{ seat: OpenSeat; cents: number | null; currency: string | null } | null>(
  null,
);
watch(openSeat, async (seat) => {
  seatOwed.value = null;
  const email = seat?.occupantEmail;
  if (seat?.mode !== 'occupied' || !email || !mayTake(market.value, MarketAction.ChangeOwed)) {
    return;
  }
  try {
    const account = await loadAccount(marketId.value, email);
    if (openSeat.value !== seat) return;
    const line = account.lines.find((candidate) => candidate.date === seat.row.date);
    seatOwed.value = { seat, cents: line?.owedCents ?? null, currency: account.currency };
  } catch {
    // An account that cannot be read asks nothing: the free still frees, and the line stays owed.
  }
});

/**
 * What freeing the open seat may also take off what its vendor owes (E44/F01/S02): "Also remove its
 * $15.00 from what Alice owes?", naming what the line owes, and not asked where it owes nothing.
 */
const deduction = computed(() => {
  const owed = seatOwed.value;
  const email = owed?.seat.occupantEmail;
  if (!owed || owed.seat !== openSeat.value || !email || !owed.cents) return null;
  return {
    amount: formatPrice(owed.cents, owed.currency ?? 'CAD'),
    name: vendorName(email, vendorNames.value) || email,
  };
});

function freeSeat(deductOwed: boolean): void {
  const seat = openSeat.value;
  if (!seat?.occupantEmail) return;
  const data = {
    email: seat.occupantEmail,
    date: seat.row.date,
    ...(deductOwed && { deductOwed }),
  };
  void runPlacementChange(() => api.delete(placementsUrl(), { data }));
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
        <!-- The Assignments page (E22/F04/S04): how the assignment came out, then the tables it sits on,
             then who changed what. -->
        <ResultSummary v-if="market" :market="market" />
        <ReadFailed v-if="errorMessage" name="tables" :message="errorMessage" @retry="loadTables" />

        <template v-if="tablesShown">
          <!-- Only a first read says so: a re-read leaves the tables up until the new ones come, or a
               placement past the fold would lose the reader's place. -->
          <div v-if="isLoading && !allRows.length" class="status-message">Loading tables…</div>

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
                  <span
                    v-if="statusFilter === pill.kind"
                    class="count-badge-tick"
                    aria-hidden="true"
                    >✓</span
                  >{{ pill.count }} {{ pill.kind }}
                </button>
              </div>
            </ResultFilterBar>

            <div v-if="filteredRows.length === 0" class="empty-state">
              <p>No tables match the current filters.</p>
            </div>

            <div v-else class="date-groups">
              <!-- Stands above the groups, where a press leaves it, so the focus stays and nothing
                   jumps. -->
              <button
                v-if="aSectionFolds"
                type="button"
                class="btn btn--secondary page-fold"
                data-testid="tables-show-all"
                @click="toggleAllSections"
              >
                {{ allSectionsUnfolded ? 'Show fewer' : `Show all ${tablesOnThePage} tables` }}
              </button>

              <section
                v-for="dateGroup in groupedRows"
                :key="dateGroup.date"
                class="date-group"
                :data-date="dateGroup.date"
                data-testid="tables-date-group"
              >
                <h2 class="date-heading" data-testid="tables-date-heading">
                  <span>{{ dateGroup.displayDate }}</span>
                  <span class="date-heading-count"
                    >{{ dateGroup.rowCount }}
                    {{ dateGroup.rowCount === 1 ? 'table' : 'tables' }}</span
                  >
                </h2>

                <RowGroup
                  v-for="sectionGroup in dateGroup.sections"
                  :key="`${dateGroup.date}-${sectionGroup.section}`"
                  class="section-group"
                  :heading="sectionGroup.section"
                  :items="sectionGroup.rows"
                  :itemKey="(row: MarketTableRow) => `${row.date}-${row.tableCode}`"
                  :level="3"
                  :fold="SECTION_FOLD"
                  :testid="`tables-section-${dateGroup.date}-${sectionGroup.section}`"
                  :unfolded="isSectionUnfolded(sectionKey(dateGroup.date, sectionGroup.section))"
                  @update:unfolded="
                    setSectionUnfolded(sectionKey(dateGroup.date, sectionGroup.section), $event)
                  "
                >
                  <template #heading>
                    <span class="section-heading">
                      <span class="section-heading-name">{{ sectionGroup.section }}</span>
                      <span v-if="sectionGroup.location" class="section-heading-meta">{{
                        sectionGroup.location
                      }}</span>
                      <span v-if="sectionGroup.tier" class="section-heading-meta">{{
                        sectionGroup.tier
                      }}</span>
                    </span>
                  </template>
                  <template #row="{ item: row }">
                    <div
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
                          :notApproved="notApproved(rowStatus(row).leftEmail)"
                          vacantLabel="Unassigned"
                          whole
                          :names="vendorNames"
                          :readOnly="readOnly"
                          @open="openOccupied(row, rowStatus(row).leftEmail!)"
                          @view="drawer.open(rowStatus(row).leftEmail!)"
                        />
                        <template v-else>
                          <div class="half-slot">
                            <span class="half-slot-label">Left</span>
                            <ResultSeat
                              :email="rowStatus(row).leftEmail"
                              :notApproved="notApproved(rowStatus(row).leftEmail)"
                              vacantLabel="Vacant"
                              :names="vendorNames"
                              :readOnly="readOnly"
                              @open="openHalf(row, rowStatus(row).leftEmail, HALF_TABLE_LEFT)"
                              @view="drawer.open(rowStatus(row).leftEmail!)"
                            />
                          </div>
                          <div class="half-slot">
                            <span class="half-slot-label">Right</span>
                            <ResultSeat
                              :email="rowStatus(row).rightEmail"
                              :notApproved="notApproved(rowStatus(row).rightEmail)"
                              vacantLabel="Vacant"
                              :names="vendorNames"
                              :readOnly="readOnly"
                              @open="openHalf(row, rowStatus(row).rightEmail, HALF_TABLE_RIGHT)"
                              @view="drawer.open(rowStatus(row).rightEmail!)"
                            />
                          </div>
                        </template>
                      </div>
                    </div>
                  </template>
                </RowGroup>
              </section>
            </div>
          </template>
        </template>
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
      :seated="seated"
      :emptySeats="emptySeats"
      :vendorNames="vendorNames"
      :vendorSearch="vendorSearch"
      :busy="placementBusy"
      :errorMessage="placementError"
      :deduction="deduction"
      @place="placeVendor"
      @free="freeSeat"
      @swap="swapSeats"
      @move="moveOccupant"
      @view="viewOccupant"
      @close="closePlacement"
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
.tables-view {
  /* The frame places itself on the page (E26/F10/S01); this holds it and the placement dialog. */
  width: 100%;
}

.tables-body {
  padding: var(--space-6);
  color: var(--mm-black);
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* Stays in view over the tables it filters. */
.filter-band {
  position: sticky;
  top: 0;
  z-index: 2;
  background-color: white;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--mm-border);
}

.counts-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
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
  padding: var(--space-hairline) var(--space-2);
  /* Every pill carries a border, in its own fill where it needs none, so all three are one height:
     "assigned" was 2px shorter than its neighbours. */
  border: 1px solid transparent;
  border-radius: var(--radius-card);
  font-family: inherit;
  font-size: var(--text-xs);
  line-height: normal;
  cursor: pointer;
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
  --focus-border: var(--focus-border-on-fill);
  background-color: var(--mm-green);
  border-color: var(--mm-green);
  color: white;
}

.count-badge--partial {
  --focus-border: var(--focus-border-on-fill);
  background-color: var(--mm-yellow);
  border-color: var(--mm-yellow);
  color: var(--mm-black);
}

/*
 * Under the pointer each pill's fill darkens a step, never dims (T229): opacity 0.9 took the
 * assigned pill's white words to 3.81:1. Each hover fill is a token `contrast.test.ts` holds.
 */
.count-badge--assigned:hover:not(:disabled) {
  background-color: var(--mm-green-hover);
  border-color: var(--mm-green-hover);
}

.count-badge--partial:hover:not(:disabled) {
  background-color: var(--mm-yellow-hover);
  border-color: var(--mm-yellow-hover);
}

.count-badge--empty:hover:not(:disabled),
.count-badge--none:hover:not(:disabled) {
  background-color: var(--mm-beige-hover);
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
  padding: var(--space-12) 0;
  text-align: center;
  color: var(--mm-text-muted);
}

.empty-state {
  padding: var(--space-12) 0;
  text-align: center;
  color: var(--mm-text-muted);
}

.date-groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.date-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.date-heading {
  margin: 0;
  padding-bottom: var(--space-2);
  border-bottom: 2px solid var(--mm-black);
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  color: var(--mm-black);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.date-heading-count {
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.page-fold {
  align-self: flex-start;
}

.section-group {
  padding-left: var(--space-1);
}

/* A `RowGroup`'s heading sets the face and the size; this lays out what the section says in it. */
.section-heading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.section-heading-name {
  font-size: var(--text-md);
}

.section-heading-meta {
  /* Not redundant, unlike the 273 declarations E15/F01/S01 removed: a `RowGroup` sets Merge One on
     its heading, and this chip is a <span> inside it, so it opts back out. */
  font-family: 'Outfit', sans-serif;
  font-size: var(--text-xs);
  padding: var(--space-hairline) var(--space-2);
  background-color: var(--mm-beige);
  border-radius: var(--radius-card);
  color: var(--mm-black);
}

.table-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
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
  gap: var(--space-2);
}

.table-code {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  color: var(--mm-black);
  letter-spacing: 0.5px;
}

.meta-tag {
  font-size: var(--text-xs);
  /* On an empty table's yellow ground too, where the plain muted ink falls short of AA. */
  color: var(--mm-text-muted-on-beige);
}

.table-row-assignment {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding-top: var(--space-1);
  border-top: 1px dashed var(--mm-border);
}

.half-slot {
  display: flex;
  flex-direction: column;
  gap: var(--space-hairline);
  min-width: 0;
  flex: 1;
}

.half-slot-label {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-xs);
  text-transform: uppercase;
  color: var(--mm-text-muted-on-beige);
  letter-spacing: 0.6px;
}

/*
 * A phone (T142): the vendor drawer's "Change assignment" at the door leads here, so the page fits
 * the phone it was tapped on (`meta.fitsAPhone`). The gutter is the door's; the filters stand in
 * the page's flow, since four rows of them pinned would take back the half of the window the frame
 * gave up; each count is a thumb's target, its type grown with it; and a half table's two seats
 * stand one under the other, each the row's width, rather than squeezing a name into a column a
 * word wide.
 */
@media (width <= 640px) {
  .tables-body {
    padding: var(--space-4);
  }

  .filter-band {
    position: static;
  }

  .count-badge {
    min-height: var(--target-min);
    padding-inline: var(--space-3);
    font-size: var(--text-sm);
  }

  .half-slot {
    flex-basis: 100%;
  }
}
</style>
