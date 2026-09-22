<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';

import {
  type AssignmentStatistics,
  type Market,
  type UnassignedTableEntry,
} from '@/assets/types/datatypes';
import AssignmentStatListItem from '@/components/AssignmentStatListItem.vue';
import VendorsModal from '@/components/VendorsModal.vue';
import PlacementHistory from '@/components/PlacementHistory.vue';
import IconAttendance from '@/components/icons/IconAttendance.vue';
import NoMarketLoaded from '@/components/NoMarketLoaded.vue';
import VendorIdentity from '@/components/VendorIdentity.vue';
import { type VendorNames } from '@/utils/vendorIdentity';
import IconTables from '@/components/icons/IconTables.vue';
import IconVendors from '@/components/icons/IconVendors.vue';
import { api } from '@/utils/api';
import { parseMarketFromApi } from '@/utils/market';
import { getFormattedDate, getShortDate } from '@/utils/utils';

const router = useRouter();

const assignmentStatistics = ref<AssignmentStatistics | null>(null);
/** Email to name, arriving with the statistics that carry the bare addresses. */
const vendorNames = ref<VendorNames>({});
/**
 * Read at setup, not on mount: the page renders "no market is open" when there is none, and a
 * value that only arrives a tick later would flash that message on every page that does have one.
 */
function marketFromStorage(): Market | null {
  const raw = localStorage.getItem('market');
  if (!raw) return null;
  try {
    return parseMarketFromApi(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

const market = ref<Market | null>(marketFromStorage());
const showVendorsModal = ref(false);

/** API / localStorage may use camelCase or snake_case; statistics lists must match backend field names. */
const unassignedVendorList = computed((): unknown[] => {
  const s = assignmentStatistics.value as Record<string, unknown> | null;
  if (!s) return [];
  const list = s.unassignedVendors ?? s.unassigned_vendors;
  return Array.isArray(list) ? list : [];
});

const hasUnassignedVendors = computed(() => unassignedVendorList.value.length > 0);

type LegacyUnassignedTable =
  | string
  | {
      table_code?: string;
      tableCode?: string;
      code?: string;
      table_choice?: string;
      tableChoice?: string;
    };

interface UnassignedTableDisplayRow {
  tableCode: string;
  tableChoice: string;
  dateRaw: string;
}

interface UnassignedTableDateGroup {
  dateRaw: string;
  dateDisplay: string;
  rows: UnassignedTableDisplayRow[];
}

function formatDisplayDate(date: string): string {
  return getFormattedDate(date) ?? date;
}

function toComparableDate(date: string): number {
  const t = new Date(`${date}T00:00:00`).getTime();
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

function normalizeUnassignedTableEntry(raw: LegacyUnassignedTable | UnassignedTableEntry): {
  tableCode: string;
  tableChoice: string;
} {
  if (typeof raw === 'string') {
    return {
      tableCode: raw,
      tableChoice: 'Unknown',
    };
  }
  const entry = raw as Record<string, unknown>;
  return {
    tableCode:
      String(entry.table_code ?? entry.tableCode ?? entry.code ?? '').trim() || '(unknown table)',
    tableChoice: String(entry.table_choice ?? entry.tableChoice ?? 'Unknown').trim() || 'Unknown',
  };
}

const unassignedTableGroups = computed((): UnassignedTableDateGroup[] => {
  const unassignedTables = assignmentStatistics.value?.unassignedTables;
  if (!unassignedTables) return [];

  const sortedDates = Object.keys(unassignedTables).sort((a, b) => {
    const t1 = toComparableDate(a);
    const t2 = toComparableDate(b);
    if (t1 === t2) return a.localeCompare(b);
    return t1 - t2;
  });

  return sortedDates
    .map((dateRaw) => {
      const dateDisplay = formatDisplayDate(dateRaw);
      const rowsRaw = unassignedTables[dateRaw];
      const rowsArray = Array.isArray(rowsRaw)
        ? rowsRaw
        : Object.values(rowsRaw as Record<string, LegacyUnassignedTable>);
      const rows = rowsArray.map((raw) => {
        const normalized = normalizeUnassignedTableEntry(
          raw as LegacyUnassignedTable | UnassignedTableEntry,
        );
        return {
          tableCode: normalized.tableCode,
          tableChoice: normalized.tableChoice,
          dateRaw,
        };
      });
      return { dateRaw, dateDisplay, rows };
    })
    .filter((group) => group.rows.length > 0);
});

const hasUnassignedTables = computed(() => unassignedTableGroups.value.length > 0);

const showUnassignedColumn = computed(
  () => hasUnassignedVendors.value || hasUnassignedTables.value,
);

// An assignment with no address is now a bug rather than a mapping mistake: the address comes
// from the application itself, and there is no column mapping left to get wrong.
const NO_EMAIL_HINT = '(no email recorded on this assignment)';

/** The address on an unassigned-vendor entry, whatever shape the statistics carried it in. */
function unassignedEntryEmail(vendor: unknown): string {
  if (vendor == null) return '';
  if (typeof vendor === 'string') return vendor.trim();
  const entry = vendor as { email?: string; name?: string };
  return String(entry.email || entry.name || '').trim();
}

function displayUnassignedEntry(vendor: unknown): string {
  return unassignedEntryEmail(vendor) || NO_EMAIL_HINT;
}

const processedTableChoices = computed(() => {
  if (!assignmentStatistics.value?.assignmentsPerTableChoice) {
    return {};
  }

  const choices = assignmentStatistics.value.assignmentsPerTableChoice;
  const processed: Record<string, number> = {};
  let halfTableTotal = 0;
  let halfTableLabel = '';

  for (const [choice, count] of Object.entries(choices)) {
    if (choice.toLowerCase().includes('half')) {
      halfTableTotal += count;
      // Use the first half table label found, or create a generic one
      if (!halfTableLabel) {
        halfTableLabel = 'Half table';
      }
    } else {
      processed[choice] = count;
    }
  }

  // Add combined half table entry if any were found
  if (halfTableTotal > 0) {
    processed[halfTableLabel] = halfTableTotal;
  }

  return processed;
});

onMounted(() => {
  assignmentStatistics.value = null;
  const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
  if (!market.value?.id || !userEmail) return;

  api
    .get(`/markets/${encodeURIComponent(market.value.id)}/assignment-statistics`)
    .then((response) => {
      assignmentStatistics.value = response.data as AssignmentStatistics;
      vendorNames.value = (response.data as { vendorNames?: VendorNames }).vendorNames ?? {};
    })
    .catch(() => {
      assignmentStatistics.value = null;
      vendorNames.value = {};
    });
});

/**
 * The satisfaction score, or a statement that there was nothing to score.
 *
 * `null` from the server means no vendor could be scored - none at all, or none with a date they
 * could attend. It used to arrive as 0.0 and render "0.0%", which reads as a run that satisfied
 * nobody rather than a run with nothing to satisfy.
 */
const satisfactionDisplay = computed(() => {
  const score = assignmentStatistics.value?.satisfactionScore;
  if (score === null || score === undefined) return 'Not applicable';
  return `${(score * 100).toFixed(1)}%`;
});

/**
 * Open one vendor, where their date cards say why they hold no table (E12/F02/S01).
 *
 * The vendor list reads the address off the URL and opens that panel, so the entry leads somewhere
 * rather than merely reporting.
 */
function openVendor(email: string) {
  if (!email || !market.value?.id) return;
  router.push({ path: '/vendors', query: { vendor: email } });
}

const openVendorsModal = () => {
  showVendorsModal.value = true;
};

const closeVendorsModal = () => {
  showVendorsModal.value = false;
};

const goToAttendance = () => {
  if (!market.value?.id) return;
  router.push(`/markets/${encodeURIComponent(market.value.id)}/attendance`);
};

const tablesBase = computed((): string | null => {
  const id = market.value?.id;
  if (!id) return null;
  return `/markets/${encodeURIComponent(id)}/tables`;
});

const goToTables = () => {
  if (!tablesBase.value) return;
  router.push(tablesBase.value);
};

function tablesLinkForFilter(
  name: 'date' | 'section' | 'tier' | 'choice',
  value: string,
): string | undefined {
  if (!tablesBase.value) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  return `${tablesBase.value}?${name}=${encodeURIComponent(v)}`;
}

function tableChoiceToFilterValue(label: string): string {
  return label.toLowerCase().includes('half') ? 'half' : 'full';
}

function formatDateLabel(dateKey: string): string {
  return getShortDate(dateKey);
}

const downloadError = ref('');
const isDownloading = ref(false);

function filenameFromContentDisposition(header: string | undefined, fallback: string): string {
  if (!header) return fallback;
  const match = header.match(/filename="?([^";]+)"?/i);
  return match && match[1] ? match[1] : fallback;
}

const handleDownloadCsv = async () => {
  downloadError.value = '';
  if (!market.value?.id) {
    downloadError.value = 'No market loaded.';
    return;
  }
  const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
  if (!userEmail) {
    downloadError.value = 'You must be signed in to download the CSV.';
    return;
  }
  isDownloading.value = true;
  try {
    const response = await api.get(
      `/markets/${encodeURIComponent(market.value.id)}/assignment-csv`,
      {
        responseType: 'blob',
      },
    );
    const fallback = `${market.value.name || 'market'}_assigned.csv`;
    const filename = filenameFromContentDisposition(
      (response.headers as Record<string, string | undefined>)['content-disposition'],
      fallback,
    );
    const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err: unknown) {
    let message = 'Failed to download CSV.';
    const response =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: unknown } }).response
        : undefined;
    const data = response?.data;
    if (data instanceof Blob) {
      try {
        const text = await data.text();
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        // keep default message
      }
    } else if (data && typeof data === 'object' && 'error' in data) {
      const errVal = (data as { error?: unknown }).error;
      if (typeof errVal === 'string' && errVal) message = errVal;
    }
    downloadError.value = message;
  } finally {
    isDownloading.value = false;
  }
};
</script>

<template>
  <NoMarketLoaded v-if="!market" shows="the assignment" />
  <template v-else>
    <VendorsModal :open="showVendorsModal" :market="market" @close="closeVendorsModal" />
    <!-- A tab's content, not a page: the market's name and its tab bar are drawn above this, so
         the card, the centring and the second "Assignment Results" heading this used to carry are
         gone with the route (E10/F03/S01). -->
    <div class="assignment-results">
      <div class="assignment-results-body">
        <div v-if="assignmentStatistics" class="statistics-layout">
          <div class="statistics-header-row">
            <div class="stat-card summary-card">
              <h3>Summary</h3>
              <div class="stat-grid">
                <div class="stat-item">
                  <span class="stat-label">Assignments</span>
                  <span class="stat-value">{{ assignmentStatistics.totalAssignments }}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">Assigned Tables</span>
                  <span class="stat-value"
                    >{{ assignmentStatistics.totalAssignedTables }} /
                    {{ assignmentStatistics.totalTables }}</span
                  >
                </div>
                <div class="stat-item">
                  <span class="stat-label">Assigned Vendors</span>
                  <span class="stat-value"
                    >{{ assignmentStatistics.totalAssignedVendors }} /
                    {{ assignmentStatistics.totalVendors }}</span
                  >
                </div>
                <div class="stat-item">
                  <span class="stat-label">Satisfaction</span>
                  <span class="stat-value" data-testid="assignment-satisfaction-score">{{
                    satisfactionDisplay
                  }}</span>
                </div>
              </div>
              <!-- The number had no definition, no breakdown and no tooltip anywhere in the
                       product, and read 0.0% on a run with nothing in it. -->
              <p class="stat-note">
                Satisfaction is the share of the dates vendors asked for, and could have had, that
                they got.
              </p>
            </div>
            <nav class="stat-card assignment-quick-nav" aria-label="Assignment shortcuts">
              <div class="assignment-quick-nav-list">
                <button
                  type="button"
                  class="assignment-quick-nav-row"
                  @click="openVendorsModal"
                  data-testid="assignment-results-view-vendors-button"
                >
                  <IconVendors class="assignment-quick-nav-icon" />
                  <span class="assignment-quick-nav-label">
                    <span>View </span>
                    <span>Vendors</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="assignment-quick-nav-row"
                  @click="goToTables"
                  data-testid="assignment-results-view-tables-button"
                >
                  <IconTables class="assignment-quick-nav-icon" />
                  <span class="assignment-quick-nav-label">
                    <span>View </span>
                    <span>Tables</span>
                  </span>
                </button>
                <button
                  type="button"
                  class="assignment-quick-nav-row"
                  @click="goToAttendance"
                  data-testid="assignment-results-view-attendance-button"
                >
                  <IconAttendance class="assignment-quick-nav-icon" />
                  <span class="assignment-quick-nav-label">
                    <span>View </span>
                    <span>Attendance</span>
                  </span>
                </button>
              </div>
            </nav>
          </div>

          <div
            class="statistics-body-grid"
            :class="
              showUnassignedColumn
                ? 'statistics-body-grid--with-unassigned'
                : 'statistics-body-grid--four-cards'
            "
          >
            <div class="stat-card body-grid-date">
              <h3>Per Date</h3>
              <div class="stat-list">
                <AssignmentStatListItem
                  v-for="(count, date) in assignmentStatistics.assignmentsPerDate"
                  :key="date"
                  :label="formatDateLabel(String(date))"
                  :value="count"
                  :to="tablesLinkForFilter('date', String(date))"
                />
              </div>
            </div>

            <div class="stat-card body-grid-section">
              <h3>Per Section</h3>
              <div class="stat-list">
                <AssignmentStatListItem
                  v-for="(count, section) in assignmentStatistics.assignmentsPerSection"
                  :key="section"
                  :label="String(section)"
                  :value="count"
                  :to="tablesLinkForFilter('section', String(section))"
                />
              </div>
            </div>

            <div class="stat-card body-grid-tier">
              <h3>Per Tier</h3>
              <div class="stat-list">
                <AssignmentStatListItem
                  v-for="(count, tier) in assignmentStatistics.assignmentsPerTier"
                  :key="tier"
                  :label="String(tier)"
                  :value="count"
                  :to="tablesLinkForFilter('tier', String(tier))"
                />
              </div>
            </div>

            <div
              v-if="assignmentStatistics.assignmentsPerTableChoice"
              class="stat-card body-grid-table-choice"
            >
              <h3>Per Table Choice</h3>
              <!-- The only list here that is not seeded from the plan: what vendors were
                       given is not something the market declares in advance. With no placements
                       it is empty, and an empty card with a heading and a rule says nothing. -->
              <p v-if="!Object.keys(processedTableChoices).length" class="stat-empty">
                Nothing was placed, so there is nothing to break down.
              </p>
              <div v-else class="stat-list">
                <AssignmentStatListItem
                  v-for="(count, choice) in processedTableChoices"
                  :key="choice"
                  :label="String(choice)"
                  :value="count"
                  :to="tablesLinkForFilter('choice', tableChoiceToFilterValue(String(choice)))"
                />
              </div>
            </div>

            <template v-if="showUnassignedColumn">
              <div
                v-if="hasUnassignedVendors"
                class="stat-card unassigned-card body-grid-unassigned-vendors"
                :class="{ 'body-grid-span-two-rows': !hasUnassignedTables }"
              >
                <h3>Unassigned Vendors ({{ unassignedVendorList.length }})</h3>
                <div class="unassigned-list">
                  <!-- The panel listed bare addresses under a heading and said nothing else. An
                       entry now opens that vendor, where their date cards say why (E12/F02/S02). -->
                  <component
                    :is="unassignedEntryEmail(vendor) ? 'button' : 'div'"
                    v-for="(vendor, index) in unassignedVendorList"
                    :key="index"
                    class="unassigned-item"
                    :class="{ 'unassigned-item--openable': !!unassignedEntryEmail(vendor) }"
                    v-bind="unassignedEntryEmail(vendor) ? { type: 'button' } : {}"
                    :data-testid="
                      unassignedEntryEmail(vendor)
                        ? 'assignment-results-unassigned-vendor'
                        : undefined
                    "
                    @click="openVendor(unassignedEntryEmail(vendor))"
                  >
                    <!-- The panel was a list of bare addresses; on a market of 232 vendors
                             that is 232 gmail addresses and no way to recognise anyone. -->
                    <VendorIdentity
                      v-if="unassignedEntryEmail(vendor)"
                      class="unassigned-text"
                      :email="unassignedEntryEmail(vendor)"
                      :names="vendorNames"
                    />
                    <span v-else class="unassigned-text">
                      {{ displayUnassignedEntry(vendor) }}
                    </span>
                  </component>
                </div>
              </div>

              <div
                v-if="hasUnassignedTables"
                class="stat-card unassigned-card body-grid-unassigned-tables"
                :class="{ 'body-grid-span-two-rows': !hasUnassignedVendors }"
              >
                <h3>Unassigned Tables</h3>
                <div class="unassigned-list">
                  <div
                    v-for="group in unassignedTableGroups"
                    :key="group.dateRaw"
                    class="unassigned-date-group"
                  >
                    <div class="unassigned-date-header">{{ group.dateDisplay }}</div>
                    <div class="unassigned-tables-list">
                      <div
                        v-for="(row, tableIndex) in group.rows"
                        :key="`${group.dateRaw}-${row.tableCode}-${tableIndex}`"
                        class="unassigned-item unassigned-item--table"
                      >
                        <!-- The date is the group heading above; it used to be repeated on
                               every row underneath it as well. -->
                        <span class="unassigned-text unassigned-table-label"
                          >{{ row.tableCode }} - {{ row.tableChoice }}</span
                        >
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- Who changed what, and when. A placement that differs from what the solver produced
               is a fact someone will later ask about, and a flag saying "hand-placed" cannot
               answer it (E11/F04/S01). -->
          <div class="stat-card placement-history-card">
            <h3>Placement history</h3>
            <PlacementHistory v-if="market?.id" :marketId="market.id" />
          </div>
        </div>
        <div v-else class="no-data-message">
          <p>No assignment statistics available.</p>
        </div>
      </div>
      <p v-if="downloadError" class="done-error">{{ downloadError }}</p>
      <div class="assignment-actions-row">
        <div>
          <button
            class="btn btn--primary download-button"
            :disabled="isDownloading || !assignmentStatistics"
            @click="handleDownloadCsv"
            data-testid="assignment-results-download-csv-button"
          >
            {{ isDownloading ? 'Downloading…' : 'Download CSV' }}
          </button>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
/* A flex item of the tab body, so it takes the height the card has rather than collapsing to
   nothing and painting its content below the card. */
.assignment-results {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Match `.market-setup-body` on Market Setup (Assignment Priority / Assignment options): 80% × 80% centered card.
   Do not set overflow:hidden here - it clips the white card's box-shadow (same shadow as `.settings-container`). */
/* The one scroll container on this tab. Extra inset so centred box-shadows are not clipped. */
.assignment-results-body {
  align-self: stretch;
  padding: 24px 36px 30px 36px;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overflow-x: visible;
  display: flex;
  flex-direction: column;
}

.statistics-layout {
  display: flex;
  flex-direction: column;
  gap: 25px;
  width: 100%;
  /* Never shrink below the content. `.assignment-results-body` is the one scroll container, so
     anything taller than the window scrolls there rather than being squeezed here. This used to be
     `flex: 1; min-height: 0; overflow: hidden`, which let every descendant be compressed and then
     clipped what did not fit. Padding gives the card box-shadows their clearance. */
  flex-shrink: 0;
  padding: 18px;
  overflow: visible;
}

.statistics-header-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 25px;
  width: 100%;
  align-items: stretch;
  flex-shrink: 0;
}

.assignment-quick-nav-list {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  align-self: stretch;
  width: 100%;
  gap: 0;
  flex: 1;
  min-height: 0;
}

.assignment-quick-nav-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  margin: 0;
  flex: 1;
  min-width: 0;
  min-height: 36px;
  border: none;
  border-right: 1.75px solid rgba(39, 35, 35, 0.49);
  border-radius: 0;
  background-color: transparent;
  cursor: pointer;
  text-align: center;
  transition:
    background-color 0.15s ease-in-out,
    box-shadow 0.15s ease-in-out;
}

.assignment-quick-nav-row:first-child {
  border-top-left-radius: 10px;
  border-bottom-left-radius: 10px;
}

.assignment-quick-nav-row:last-child {
  border-top-right-radius: 10px;
  border-bottom-right-radius: 10px;
  border-right: none;
}

.assignment-quick-nav-row:hover {
  background-color: var(--hover-grey);
  box-shadow: var(--shadow-card);
}

.assignment-quick-nav-icon {
  height: 24px;
  aspect-ratio: 1;
  margin: 6px;
  color: var(--mm-black);
  flex-shrink: 0;
}

.assignment-quick-nav-label {
  font-family: 'Merge One';
  font-style: normal;
  font-size: var(--text-lg);
  color: var(--mm-black);
  margin: 0;
  min-width: 0;
  /* Wrap between the two words, never inside one: at the width a tab gives this, `break-word`
     rendered "View Attendanc / e" (E09/F02/S03's rule, reached here by a narrower column). */
  overflow-wrap: normal;
  text-align: center;
}

.statistics-body-grid {
  /* A shrinkable flex item with `min-height: 0` compresses below its own content, which is what
     squeezed the auto rows below the height of the cards in them. */
  flex-shrink: 0;
  /* Do not add horizontal padding here - it misaligns grid cards vs `.statistics-header-row`.
       Shadow clearance comes from `.statistics-layout` padding; avoid `overflow:hidden` here
       or it clips card shadows at the grid box without matching the header inset. */
  overflow: visible;
}

/* `align-items: start`, not `stretch`: a card in a row was sized to the tallest card beside it,
   so Per Date and Per Section were stretched to the height of Unassigned Tables and the organizer
   scrolled roughly 1,300px of blank white to reach the bottom. Each card sizes to its own content;
   the one that spans both rows stretches for itself below. */
.statistics-body-grid--with-unassigned {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: auto auto;
  gap: 25px;
  align-items: start;
}

.statistics-body-grid--four-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto auto;
  gap: 25px;
  align-items: start;
}

.statistics-body-grid > .stat-card {
  min-height: 0;
}

/* An intrinsic height, so a list never depends on how tall the window happens to be. Past
   `max-height` it scrolls within its own card. There is no `min-height`: an empty list reserved
   11rem of nothing, which is what made a run with no applications four empty slabs. */
.statistics-body-grid > .stat-card .stat-list {
  flex: 1 1 auto;
  max-height: 20rem;
  overflow-y: auto;
  /* Inset so `.assignment-stat-list-item` box-shadows are not clipped by the scrollport */
  padding: 8px 10px;
}

.statistics-body-grid--four-cards .body-grid-date {
  grid-column: 1;
  grid-row: 1;
}

.statistics-body-grid--four-cards .body-grid-section {
  grid-column: 2;
  grid-row: 1;
}

.statistics-body-grid--four-cards .body-grid-tier {
  grid-column: 1;
  grid-row: 2;
}

.statistics-body-grid--four-cards .body-grid-table-choice {
  grid-column: 2;
  grid-row: 2;
}

.statistics-body-grid--with-unassigned .body-grid-date {
  grid-column: 1;
  grid-row: 1;
}

.statistics-body-grid--with-unassigned .body-grid-section {
  grid-column: 2;
  grid-row: 1;
}

.statistics-body-grid--with-unassigned .body-grid-tier {
  grid-column: 1;
  grid-row: 2;
}

.statistics-body-grid--with-unassigned .body-grid-table-choice {
  grid-column: 2;
  grid-row: 2;
}

.statistics-body-grid--with-unassigned .body-grid-unassigned-vendors {
  grid-column: 3;
  grid-row: 1;
}

.statistics-body-grid--with-unassigned .body-grid-unassigned-tables {
  grid-column: 3;
  grid-row: 2;
}

.statistics-body-grid--with-unassigned .body-grid-unassigned-vendors.body-grid-span-two-rows,
.statistics-body-grid--with-unassigned .body-grid-unassigned-tables.body-grid-span-two-rows {
  grid-row: 1 / span 2;
}

/* Match `.settings-container` / quick-nav: white panel + soft outer shadow */
.stat-note {
  margin: 0;
  font-size: var(--text-xs);
  line-height: 1.3;
}

.stat-empty {
  margin: 0;
  padding: 8px 10px;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.stat-card {
  background-color: white;
  border-radius: var(--radius-card);
  padding: 20px;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.stat-card.assignment-quick-nav {
  min-height: 0;
  justify-content: flex-start;
  padding: 36px 20px;
  gap: 0;
}

/* Full width beneath the grid: a log is a column of sentences, and squeezing it into a
   statistics cell would wrap every one of them. */
.placement-history-card {
  margin-top: 16px;
}

/* Above `.summary-card h3`, not below it. Both selectors are (0,1,1), so the later one wins on
   cascade order alone - and with this rule last, the summary card's heading took `--mm-black`
   over its green and rendered at 3.39:1 despite asking for white two rules down. */
.stat-card h3 {
  font-family: 'Merge One';
  font-size: var(--text-lg);
  color: var(--mm-black);
  margin: 0;
  border-bottom: 2px solid var(--mm-border);
  padding-bottom: 10px;
}

.summary-card {
  background: linear-gradient(135deg, var(--mm-green) 0%, var(--mm-green) 100%);
}

.summary-card h3,
.summary-card .stat-label,
.summary-card .stat-value {
  color: white;
}

/* Full white, not the muted-on-dark token: that token is tuned against `--mm-black` and reaches
   only 3.8:1 on this card's green, which is below AA for text this size. The size carries the
   hierarchy instead of the colour. */
.summary-card .stat-note {
  color: white;
}

.summary-card .stat-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.summary-card .stat-item {
  min-width: 0;
}

.summary-card .stat-label {
  font-size: var(--text-xs);
  text-align: center;
  overflow-wrap: break-word;
}

.summary-card .stat-value {
  font-size: clamp(18px, 2.2vw, 24px);
  line-height: 1.15;
  text-align: center;
  overflow-wrap: break-word;
}

.stat-row {
  display: flex;
  flex-direction: row;
  gap: 30px;
  justify-content: space-around;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 25px;
  width: 100%;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.stat-label {
  font-size: var(--text-md);
  color: var(--mm-black);
  opacity: 0.8;
}

.stat-value {
  /* Figures in a column need fixed-width digits (E15/F01/S03). Outfit's 0, 1 and 2 are different
     widths, so a right-aligned group shifts by a pixel or two per row and the column reads ragged
     down the list. */
  font-variant-numeric: tabular-nums;
  font-family: 'Merge One';
  font-size: var(--text-2xl);
  font-weight: 400;
  color: var(--mm-green);
}

.stat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.unassigned-card {
  min-height: 0;
  overflow: hidden;
}

/* Capped and scrolling in its own card. The grid used to lift the cap so this list could fill a
   stretched row; now that each card sizes to its own content, an uncapped list of 80 unassigned
   tables is a 1,900px card and the same long scroll in a different place. */
.unassigned-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
  /* Match `.stat-list`: inset so row box-shadows are not clipped by the scrollport */
  padding: 8px 10px;
}

.unassigned-item--openable {
  width: 100%;
  border: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.unassigned-item--openable:hover {
  border-left-color: var(--mm-green);
}

.unassigned-item {
  padding: 6px 12px;
  background-color: white;
  border-radius: var(--radius-control);
  border-left: 4px solid var(--mm-yellow);
  font-size: var(--text-sm);
  box-shadow: var(--shadow-card);
}

.unassigned-item--table {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.unassigned-text {
  color: var(--mm-black);
  word-break: break-word;
}

.unassigned-table-label {
  flex: 1;
  min-width: 0;
}

.unassigned-date-group {
  margin-bottom: 15px;
}

.unassigned-date-header {
  font-family: 'Merge One';
  font-size: var(--text-md);
  font-weight: 400;
  color: var(--mm-black);
  margin-bottom: 8px;
  padding-bottom: 5px;
  border-bottom: 2px solid var(--mm-border);
}

.unassigned-tables-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-left: 10px;
}

.no-data-message {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  font-size: var(--text-lg);
  color: var(--mm-text-muted);
}

h1 {
  text-align: center;
  font-size: var(--text-2xl);
  color: white;
}

h2 {
  font-family: 'Merge One';
  text-align: left;
  font-size: var(--text-xl);
  color: white;
}

.done-error {
  margin: 8px 0 0;
  color: var(--mm-red);
  font-size: var(--text-sm);
}

.assignment-actions-row {
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  /* `start`, not `center`: the right-hand action carries an explanation under it, and centring
     the two columns against each other is what put the buttons on different lines. */
  align-items: start;
  gap: 12px;
}

/* Width only. Type, height, radius and the disabled state are `.btn`'s (E17/F03/S02). */
.download-button {
  width: 180px;
}
</style>
