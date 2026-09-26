<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { marketPath } from '@/utils/market';
import { withoutQueryKey } from '@/utils/routeQuery';
import { useRoute, useRouter } from 'vue-router';

import { api } from '@/utils/api';
import { fetchMarketApplications } from '@/utils/applicantApi';
import { useOpenMarket } from '@/utils/openMarket';
import MarketArrival from '@/components/MarketArrival.vue';
import { ESSENTIAL_KEY_PREFIX } from '@/utils/essentialFields';
import { useEscapeToClose } from '@/utils/useEscapeToClose';
import { useInertBehind } from '@/utils/useInertBehind';
import VendorDateCard from '@/components/VendorDateCard.vue';
import {
  overrideIndex,
  reasonIndex,
  type OverriddenPlacement,
  type PlacementOverride,
  type PlacementReason,
  type UnplacedDate,
} from '@/utils/placementReason';
import type { Application, MarketDateObject } from '@/assets/types/datatypes';
import { getFormattedDate } from '@/utils/utils';
import {
  vendorHeadline,
  vendorMatches,
  vendorName,
  type VendorNames,
} from '@/utils/vendorIdentity';
import VendorIdentity from '@/components/VendorIdentity.vue';
import PlacementHistory from '@/components/PlacementHistory.vue';
import MarketFrame from '@/components/MarketFrame.vue';

interface AssignmentStatisticsResponse {
  totalVendors?: number;
  totalAssignedVendors?: number;
  unassignedVendors?: unknown[];
  unassigned_vendors?: unknown[];
  unplacedDates?: UnplacedDate[];
  overriddenPlacements?: OverriddenPlacement[];
}

interface MarketTableRowResponse {
  date: string;
  assignment: string[];
  location: string;
  section: string;
  tableChoice: string;
  tableCode: string;
  tier: string;
}

interface VendorTableAssignment {
  tableCode: string;
  tableChoice: string;
  section: string;
  tier: string;
  location: string;
}

interface VendorRow {
  rowIndex: number;
  email: string;
  displayEmail: string;
  assignmentsByDate: Map<string, VendorTableAssignment>;
  isAssigned: boolean;
  assignedDateCount: number;
  /** The organizer's own questions, keyed by field key. Essential answers are shown separately. */
  answers: Record<string, unknown>;
}

const router = useRouter();
const route = useRoute();

/**
 * The market in the route, from the one store (E21/F02/S04). This screen used to read it out of
 * `localStorage`, because `/vendors` carried no id.
 */
const marketId = computed(() => String(route.params.marketId ?? ''));
const { market, status: marketStatus, refresh: refreshMarket } = useOpenMarket(marketId);
const applications = ref<Application[]>([]);
const tableRows = ref<MarketTableRowResponse[]>([]);
const vendorNames = ref<VendorNames>({});
/** Email + date to the reason there is no table, from the statistics (E12/F01/S01). */
const unplacedReasons = ref<Map<string, PlacementReason>>(new Map());
const placementOverrides = ref<Map<string, PlacementOverride[]>>(new Map());
const unassignedEmails = ref<Set<string>>(new Set());

const isLoading = ref(false);
const loadError = ref('');
const filterText = ref('');
const selectedRowIndex = ref<number | null>(null);

function extractEmail(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  const obj = raw as { email?: unknown; vendorEmail?: unknown; vendor_email?: unknown };
  const candidate = obj.email ?? obj.vendorEmail ?? obj.vendor_email;
  if (typeof candidate === 'string') return candidate.trim();
  return '';
}

function readUserEmail(): string | null {
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: { error?: string } } }).response;
    if (resp?.data?.error) return resp.data.error;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

async function loadVendors(): Promise<void> {
  loadError.value = '';
  const id = marketId.value;
  if (!id) return;

  const userEmail = readUserEmail();
  if (!userEmail) {
    loadError.value = 'You must be signed in.';
    return;
  }

  const encoded = encodeURIComponent(id);
  isLoading.value = true;

  try {
    const [applicationList, statsResp, tablesResp] = await Promise.all([
      fetchMarketApplications(id),
      api.get<AssignmentStatisticsResponse>(`/markets/${encoded}/assignment-statistics`),
      api.get<{ rows: MarketTableRowResponse[]; vendorNames: VendorNames }>(
        `/markets/${encoded}/tables`,
      ),
    ]);

    applications.value = Array.isArray(applicationList) ? applicationList : [];

    unplacedReasons.value = reasonIndex(statsResp.data?.unplacedDates ?? []);
    placementOverrides.value = overrideIndex(statsResp.data?.overriddenPlacements ?? []);

    const statsList = statsResp.data?.unassignedVendors ?? statsResp.data?.unassigned_vendors ?? [];
    const unassigned = new Set<string>();
    for (const item of statsList) {
      const email = extractEmail(item).toLowerCase();
      if (email) unassigned.add(email);
    }
    unassignedEmails.value = unassigned;

    tableRows.value = Array.isArray(tablesResp.data?.rows) ? tablesResp.data.rows : [];
    vendorNames.value = tablesResp.data?.vendorNames ?? {};
  } catch (err: unknown) {
    loadError.value = extractErrorMessage(err, 'Failed to load vendors.');
    applications.value = [];
    tableRows.value = [];
    vendorNames.value = {};
    unplacedReasons.value = new Map();
    unassignedEmails.value = new Set();
  } finally {
    isLoading.value = false;
  }
}

/**
 * Open the vendor the URL names, once the list is loaded.
 *
 * The payoff screen's Unassigned Vendors panel links here (E12/F02/S02): an entry that merely
 * reported an address was the finding. Silently ignored when that address is not in this market's
 * list, which is what a stale link looks like.
 */
function openVendorFromRoute() {
  const asked = String(route.query.vendor ?? '')
    .trim()
    .toLowerCase();
  if (!asked) return;
  const row = vendors.value.find((v) => v.email === asked);
  if (row) selectedRowIndex.value = row.rowIndex;
}

watch(
  marketId,
  async () => {
    await loadVendors();
    openVendorFromRoute();
  },
  { immediate: true },
);

/** A failed arrival retries both halves: the market the rail draws, and this screen's own list. */
function retryArrival(): void {
  void refreshMarket();
  void loadVendors();
}

const setup = computed(() => market.value?.setupObject ?? null);
const marketDates = computed<MarketDateObject[]>(() => setup.value?.marketDates ?? []);

/**
 * The organizer's own questions, in the order their form asks them.
 *
 * This list used to be the included columns of an uploaded spreadsheet. A vendor is an
 * application now, so the questions come from the form that produced it, and the essential
 * answers are deliberately left out: they are the market plan restated, and they have their own
 * presentation elsewhere.
 */
const customFields = computed(() =>
  (market.value?.applicationForm?.fields ?? [])
    .filter((field) => !field.key.startsWith(ESSENTIAL_KEY_PREFIX))
    .slice()
    .sort((a, b) => a.order - b.order),
);

const assignmentsByEmail = computed(() => {
  const map = new Map<string, Map<string, VendorTableAssignment>>();
  for (const row of tableRows.value) {
    if (!Array.isArray(row.assignment)) continue;
    for (const email of row.assignment) {
      const key = String(email ?? '')
        .trim()
        .toLowerCase();
      if (!key) continue;
      let inner = map.get(key);
      if (!inner) {
        inner = new Map();
        map.set(key, inner);
      }
      inner.set(row.date, {
        tableCode: row.tableCode,
        tableChoice: row.tableChoice,
        section: row.section,
        tier: row.tier,
        location: row.location,
      });
    }
  }
  return map;
});

const vendors = computed<VendorRow[]>(() =>
  applications.value.map((application, index) => {
    const emailRaw = (application.applicantEmail ?? '').trim();
    const emailLower = emailRaw.toLowerCase();
    const assignmentsByDate = emailLower
      ? (assignmentsByEmail.value.get(emailLower) ?? new Map<string, VendorTableAssignment>())
      : new Map<string, VendorTableAssignment>();

    return {
      rowIndex: index,
      email: emailLower,
      displayEmail: emailRaw || `Applicant ${index + 1}`,
      assignmentsByDate,
      isAssigned: !unassignedEmails.value.has(emailLower) && assignmentsByDate.size > 0,
      assignedDateCount: assignmentsByDate.size,
      answers: (application.formData ?? {}) as Record<string, unknown>,
    };
  }),
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

const filteredVendors = computed(() => {
  const shown = onlyUnassigned.value ? vendors.value.filter((v) => !v.isAssigned) : vendors.value;
  const term = filterText.value.trim();
  if (!term) return shown;
  // Name AND address. The box used to read "Filter by email" and match only that, which on a
  // market of 232 vendors meant knowing someone's address to find them by name.
  return shown.filter((v) => vendorMatches(term, v.email, vendorNames.value));
});

const totalVendorCount = computed(() => vendors.value.length);
const assignedVendorCount = computed(() => vendors.value.filter((v) => v.isAssigned).length);
const totalDateCount = computed(() => marketDates.value.length);

const selectedVendor = computed(() => {
  if (selectedRowIndex.value == null) return null;
  return vendors.value.find((v) => v.rowIndex === selectedRowIndex.value) ?? null;
});

function answerText(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

const detailFields = computed(() => {
  const vendor = selectedVendor.value;
  if (!vendor) return [];
  return customFields.value.map((field) => ({
    label: field.label || field.key,
    value: answerText(vendor.answers[field.key]) || 'Not answered',
  }));
});

function formatDateLabel(date: string): string {
  return getFormattedDate(date) ?? date;
}

function assignmentSummary(assignment: VendorTableAssignment | undefined): string {
  if (!assignment) return 'Not assigned';
  const parts: string[] = [];
  const codePart = assignment.tableCode || 'No table';
  const choice = assignment.tableChoice ? ` (${assignment.tableChoice})` : '';
  parts.push(`${codePart}${choice}`);
  const meta = [assignment.section, assignment.tier, assignment.location]
    .filter((s) => !!s && s.trim().length > 0)
    .join(', ');
  if (meta) parts.push(meta);
  return parts.join(' - ');
}

/** Where they were placed on this date, or null - which is what makes the card's state. */
function placementOn(row: VendorRow, date: string): string | null {
  const assignment = row.assignmentsByDate.get(date);
  return assignment ? assignmentSummary(assignment) : null;
}

/**
 * Why they hold no table that day, as the server computed it against the current plan and
 * assignment. Absent for a date they were placed on, which is how the card knows.
 */
function reasonFor(email: string, date: string): PlacementReason | undefined {
  return unplacedReasons.value.get(`${email.trim().toLowerCase()}|${date}`);
}

/** What their placement that day overrides, when it was made by hand and contradicts them. */
function overridesFor(email: string, date: string): PlacementOverride[] | undefined {
  return placementOverrides.value.get(`${email.trim().toLowerCase()}|${date}`);
}

/**
 * The Result page's tables, filtered to the day the organizer would be placing them on.
 *
 * This is the story that makes those filters reachable: `dateFilter` and its three neighbours
 * were computed from `route.query` and set by nothing, so a complete filter system existed that
 * no organizer could invoke (`E11/F03/S02`). The vendor rides along, naming whose placement the
 * organizer came to change.
 */
function resultLinkFor(date: string): string | null {
  const id = market.value?.id;
  const vendor = selectedVendor.value?.email;
  if (!id || !vendor) return null;
  const query = new URLSearchParams({ date, vendor });
  return `${marketPath(id, 'result')}?${query.toString()}`;
}

function goToResult(date: string): void {
  const href = resultLinkFor(date);
  if (href) router.push(href);
}

/**
 * The open vendor is part of the page's address (E22/F04/S02), so a link, a refresh or the browser's
 * Back returns to that vendor's panel. It is what the old Tables screen's Back button did by hand
 * before the market's pages became tabs and the Back buttons went.
 */
function selectVendor(rowIndex: number): void {
  selectedRowIndex.value = rowIndex;
  const email = vendors.value.find((v) => v.rowIndex === rowIndex)?.email;
  if (email && route.query.vendor !== email) {
    void router.replace({ query: { ...route.query, vendor: email } });
  }
}

function closeDetail(): void {
  selectedRowIndex.value = null;
  if (route.query.vendor) void router.replace({ query: withoutQueryKey(route.query, 'vendor') });
}

// Back and Forward move between addresses without remounting, so the panel follows the address.
watch(
  () => route.query.vendor,
  (vendor) => {
    if (vendor) openVendorFromRoute();
    else selectedRowIndex.value = null;
  },
);

useEscapeToClose(() => selectedVendor.value !== null, closeDetail);

/**
 * The drawer is modal, so the rest of the page is out of play while it is open - to the keyboard as
 * well as to the mouse. The scrim only ever stopped the mouse (E14/F02/S02).
 */
const detailOverlay = ref<HTMLElement | null>(null);
const detailPanel = ref<HTMLElement | null>(null);
useInertBehind(
  () => selectedVendor.value !== null,
  () => [detailOverlay.value, detailPanel.value],
);
</script>

<template>
  <div class="vendors-view">
    <MarketFrame class="vendors-card" :market="market">
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
          <div class="summary-line">
            <span class="summary-strong">{{ assignedVendorCount }}</span>
            of
            <span class="summary-strong">{{ totalVendorCount }}</span>
            vendors assigned
          </div>
        </div>
      </template>

      <div class="vendors-body">
        <MarketArrival v-if="!market" :status="marketStatus" @retry="retryArrival" />

        <template v-else>
          <p v-if="loadError" class="error-text">{{ loadError }}</p>

          <div v-if="isLoading" class="loading-state">
            <div class="spinner" aria-hidden="true" />
            <span>Loading vendors…</span>
          </div>

          <div v-else-if="filteredVendors.length === 0" class="empty-state empty-state--inline">
            <p v-if="totalVendorCount === 0">No vendors found.</p>
            <p v-else-if="onlyUnassigned && !filterText.trim()">Every vendor has a table.</p>
            <p v-else>No vendors match "{{ filterText }}".</p>
          </div>

          <ul v-else class="vendor-list">
            <li
              v-for="vendor in filteredVendors"
              :key="vendor.rowIndex"
              class="vendor-row"
              :class="{ 'vendor-row--active': vendor.rowIndex === selectedRowIndex }"
            >
              <button
                type="button"
                class="vendor-row-button"
                @click="selectVendor(vendor.rowIndex)"
                data-testid="vendors-list-item"
              >
                <VendorIdentity
                  class="vendor-email"
                  :email="vendor.displayEmail"
                  :names="vendorNames"
                />
                <span class="vendor-meta">
                  <span
                    class="vendor-badge"
                    :class="
                      vendor.isAssigned ? 'vendor-badge--assigned' : 'vendor-badge--unassigned'
                    "
                  >
                    {{ vendor.isAssigned ? 'Assigned' : 'Unassigned' }}
                  </span>
                  <span class="vendor-date-count">
                    {{ vendor.assignedDateCount }} / {{ totalDateCount }} dates
                  </span>
                </span>
              </button>
            </li>
          </ul>
        </template>
      </div>
    </MarketFrame>

    <div
      ref="detailOverlay"
      class="detail-overlay"
      data-testid="vendors-detail-overlay"
      :class="{ 'detail-overlay--open': selectedVendor !== null }"
      @click="closeDetail"
    />

    <aside
      ref="detailPanel"
      class="detail-panel"
      data-testid="vendors-detail-panel"
      :class="{ 'detail-panel--open': selectedVendor !== null }"
      role="dialog"
      aria-modal="true"
      :aria-hidden="selectedVendor === null"
      @click.stop
    >
      <div v-if="selectedVendor" class="detail-content">
        <div class="detail-header">
          <div class="detail-title-wrap">
            <span class="detail-eyebrow">Vendor detail</span>
            <h2 class="detail-title">{{ vendorHeadline(selectedVendor.email, vendorNames) }}</h2>
            <!-- The address always, beneath the name: it is what ties this panel to a check-in,
                 a CSV row and an application, and two vendors can share a name. -->
            <p
              v-if="vendorName(selectedVendor.email, vendorNames)"
              class="detail-subtitle"
              data-testid="vendors-detail-email"
            >
              {{ selectedVendor.displayEmail }}
            </p>
          </div>
          <button
            type="button"
            class="detail-close"
            aria-label="Close vendor detail"
            @click="closeDetail"
            data-testid="vendors-detail-close"
          >
            &times;
          </button>
        </div>

        <section v-if="detailFields.length > 0" class="detail-section">
          <h3 class="detail-section-title">Submission</h3>
          <dl class="detail-grid">
            <template v-for="field in detailFields" :key="field.label">
              <dt>{{ field.label }}</dt>
              <dd>{{ field.value }}</dd>
            </template>
          </dl>
        </section>

        <section class="detail-section">
          <h3 class="detail-section-title">Assignments</h3>
          <div v-if="marketDates.length === 0" class="detail-empty">
            No market dates configured.
          </div>
          <ul v-else class="assignment-list">
            <VendorDateCard
              v-for="date in marketDates"
              :key="date.date"
              :data-date="date.date"
              :label="formatDateLabel(date.date)"
              :placement="placementOn(selectedVendor, date.date)"
              :reason="reasonFor(selectedVendor.email, date.date)"
              :overrides="overridesFor(selectedVendor.email, date.date)"
              :placeHref="resultLinkFor(date.date)"
              @place="goToResult(date.date)"
            />
          </ul>
        </section>

        <!-- Who moved this vendor, and when. A placement that differs from what the solver
             produced is a fact someone will later ask about (E11/F04/S01). -->
        <section class="detail-section">
          <h3 class="detail-section-title">Placement history</h3>
          <PlacementHistory
            v-if="market?.id"
            :marketId="market.id"
            :vendor="selectedVendor.email"
          />
        </section>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.vendors-view {
  width: 100%;
  padding: 0 var(--space-4) var(--space-4);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background-color: var(--mm-beige);
  position: relative;
}

.vendors-card {
  /* The page scrolls, not the card (E21/F04/S02): the frame pins the title, the rail and the search
     under the banner, and a sticky element inside an `overflow` ancestor stops sticking. This used
     to cap the card at the viewport and scroll a body inside it. */
  border-radius: var(--radius-card);
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
}

.detail-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  opacity: 0;
  visibility: hidden;
  z-index: 50;
  transition:
    opacity 0.2s ease-in-out,
    visibility 0.2s ease-in-out;
}

.detail-overlay--open {
  opacity: 1;
  visibility: visible;
}

.detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  height: 100vh;
  width: min(480px, 92vw);
  background: white;
  box-shadow: var(--shadow-card);
  transform: translateX(100%);
  transition: transform 0.25s ease-in-out;
  z-index: 60;
  display: flex;
  flex-direction: column;
}

.detail-panel--open {
  transform: translateX(0);
}

.detail-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.detail-header {
  position: sticky;
  top: 0;
  background: var(--mm-black);
  color: white;
  padding: 20px 22px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  z-index: 1;
}

.detail-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.detail-eyebrow {
  font-size: var(--text-xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.7;
}

.detail-title {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  color: white;
  overflow-wrap: anywhere;
}

/* The panel head is dark, so the muted-on-dark token rather than the on-white one. */
.detail-subtitle {
  margin: 2px 0 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted-on-dark);
  overflow-wrap: anywhere;
}

.detail-close {
  background: transparent;
  border: none;
  color: white;
  font-size: var(--text-2xl);
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
  border-radius: var(--radius-control);
  transition: background-color 0.15s ease-in-out;
}

.detail-close:hover {
  background: rgba(255, 255, 255, 0.12);
}

.detail-section {
  padding: 20px 22px;
  border-bottom: 1px solid var(--mm-border);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-section:last-child {
  border-bottom: none;
}

.detail-section-title {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-md);
  color: var(--mm-black);
  padding-bottom: 8px;
  border-bottom: 2px solid var(--mm-border);
}

.detail-grid {
  margin: 0;
  display: grid;
  grid-template-columns: minmax(120px, 0.6fr) 1fr;
  gap: 8px 16px;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.detail-grid dt {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-xs);
  color: var(--mm-black);
  opacity: 0.75;
  align-self: start;
  padding-top: 2px;
}

.detail-grid dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.detail-empty {
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.assignment-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.assignment-item {
  border: 1px solid var(--mm-border);
  border-left: 4px solid var(--mm-green);
  border-radius: var(--radius-card);
  padding: 12px 14px;
  background: white;
  box-shadow: var(--shadow-card);
}

.assignment-date {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  color: var(--mm-green);
  margin-bottom: 4px;
}

.assignment-detail {
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
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
