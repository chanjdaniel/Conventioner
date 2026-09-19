<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { api } from '@/utils/api';
import { fetchMarketApplications } from '@/utils/applicantApi';
import { parseMarketFromApi } from '@/utils/market';
import { ESSENTIAL_KEY_PREFIX } from '@/utils/essentialFields';
import { useEscapeToClose } from '@/utils/useEscapeToClose';
import NoMarketLoaded from '@/components/NoMarketLoaded.vue';
import VendorDateCard from '@/components/VendorDateCard.vue';
import {
  overrideIndex,
  reasonIndex,
  type OverriddenPlacement,
  type PlacementOverride,
  type PlacementReason,
  type UnplacedDate,
} from '@/utils/placementReason';
import type { Application, Market, MarketDateObject } from '@/assets/types/datatypes';
import { getFormattedDate } from '@/utils/utils';
import {
  vendorHeadline,
  vendorMatches,
  vendorName,
  type VendorNames,
} from '@/utils/vendorIdentity';
import VendorIdentity from '@/components/VendorIdentity.vue';
import PlacementHistory from '@/components/PlacementHistory.vue';
import PhaseRail from '@/components/PhaseRail.vue';

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

function readMarketFromStorage(): Market | null {
  const raw = localStorage.getItem('market');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parseMarketFromApi(parsed);
  } catch {
    return null;
  }
}

/**
 * Read at setup, not on mount: the page renders "no market is open" when there is none, and a
 * value that only arrives a tick later would flash that message on every page that does have one.
 */
const market = ref<Market | null>(readMarketFromStorage());
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
  const loaded = readMarketFromStorage();
  market.value = loaded;
  if (!loaded?.id) return;

  const userEmail = readUserEmail();
  if (!userEmail) {
    loadError.value = 'You must be signed in.';
    return;
  }

  const marketId = encodeURIComponent(loaded.id);
  isLoading.value = true;

  try {
    const [applicationList, statsResp, tablesResp] = await Promise.all([
      fetchMarketApplications(loaded.id),
      api.get<AssignmentStatisticsResponse>(`/markets/${marketId}/assignment-statistics`),
      api.get<{ rows: MarketTableRowResponse[]; vendorNames: VendorNames }>(
        `/markets/${marketId}/tables`,
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

onMounted(async () => {
  await loadVendors();
  openVendorFromRoute();
});

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

const filteredVendors = computed(() => {
  const term = filterText.value.trim();
  if (!term) return vendors.value;
  // Name AND address. The box used to read "Filter by email" and match only that, which on a
  // market of 232 vendors meant knowing someone's address to find them by name.
  return vendors.value.filter((v) => vendorMatches(term, v.email, vendorNames.value));
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
 * The Tables view, filtered to the day the organizer would be placing them on.
 *
 * This is the story that makes those filters reachable: `dateFilter` and its three neighbours
 * were computed from `route.query` and set by nothing, so a complete filter system existed that
 * no organizer could invoke (`E11/F03/S02`). The vendor rides along so the Tables view can send
 * them back to this panel rather than to the results tab.
 */
function tablesLinkFor(date: string): string | null {
  const id = market.value?.id;
  const vendor = selectedVendor.value?.email;
  if (!id || !vendor) return null;
  const query = new URLSearchParams({ date, vendor });
  return `/markets/${encodeURIComponent(id)}/tables?${query.toString()}`;
}

function goToTables(date: string): void {
  const href = tablesLinkFor(date);
  if (href) router.push(href);
}

function selectVendor(rowIndex: number): void {
  selectedRowIndex.value = rowIndex;
}

function closeDetail(): void {
  selectedRowIndex.value = null;
}

useEscapeToClose(() => selectedVendor.value !== null, closeDetail);

function handleBack(): void {
  if (market.value?.id) {
    router.push({ path: '/market-setup', query: { tab: 'assignment' } });
  } else {
    router.push('/dashboard');
  }
}
</script>

<template>
  <div class="vendors-view">
    <div class="vendors-card">
      <header class="vendors-header">
        <h1>{{ market ? `Vendors: ${market.name}` : 'Vendors' }}</h1>
      </header>

      <PhaseRail :market="market" @phase-advanced="(m) => (market = m)" />

      <div class="vendors-body">
        <NoMarketLoaded v-if="!market" shows="the vendors" />

        <template v-else>
          <div class="vendors-toolbar">
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
            <div class="summary-line">
              <span class="summary-strong">{{ assignedVendorCount }}</span>
              of
              <span class="summary-strong">{{ totalVendorCount }}</span>
              vendors assigned
            </div>
          </div>

          <p v-if="loadError" class="error-text">{{ loadError }}</p>

          <div v-if="isLoading" class="loading-state">
            <div class="spinner" aria-hidden="true" />
            <span>Loading vendors…</span>
          </div>

          <div v-else-if="filteredVendors.length === 0" class="empty-state empty-state--inline">
            <p v-if="totalVendorCount === 0">No vendors found.</p>
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

      <div class="vendors-actions">
        <button
          type="button"
          class="primary-button"
          @click="handleBack"
          data-testid="vendors-back-button"
        >
          Back
        </button>
      </div>
    </div>

    <div
      class="detail-overlay"
      :class="{ 'detail-overlay--open': selectedVendor !== null }"
      @click="closeDetail"
    />

    <aside
      class="detail-panel"
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
              :placeHref="tablesLinkFor(date.date)"
              @place="goToTables(date.date)"
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
  /* Sized from the flex parent, not the viewport: .router-view is already flex:1 inside a
     100vh column, so `min-height: 100vh` here double-counted the 5vh banner and left the page
     scrolling 45px behind a list that was scrolling too. */
  height: 100%;
  min-height: 0;
  padding: 40px 20px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background-color: #f6f7f9;
  position: relative;
}

.vendors-card {
  width: 100%;
  max-width: 1100px;
  background-color: white;
  box-shadow: 0px 0px 4px 5px rgba(0, 0, 0, 0.15);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 100%;
}

.vendors-header {
  background-color: var(--mm-black);
  padding: 18px 24px;
}

.vendors-header h1 {
  margin: 0;
  color: white;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 26px;
  text-align: center;
  word-break: break-word;
}

.vendors-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  font-family: 'Outfit Regular', sans-serif;
  color: var(--mm-black);
}

.vendors-toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  background-color: white;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 4px 0 12px;
  border-bottom: 1px solid #eceff1;
}

.filter-label {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-black);
  opacity: 0.75;
}

.filter-input {
  width: 100%;
  padding: 10px 12px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 15px;
  border: 1px solid #cfd3d8;
  border-radius: 6px;
  transition:
    border-color 0.15s ease-in-out,
    box-shadow 0.15s ease-in-out;
}

.filter-input:focus {
  outline: none;
  border-color: var(--mm-green);
  box-shadow: 0 0 0 3px rgba(73, 176, 150, 0.18);
}

.summary-line {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-black);
  opacity: 0.8;
  white-space: nowrap;
}

.summary-strong {
  font-family: 'Merge One', sans-serif;
  font-size: 15px;
  color: var(--mm-green);
  margin: 0 2px;
}

.error-text {
  margin: 0;
  color: #c62828;
  font-size: 14px;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 0;
  color: var(--mm-black);
  opacity: 0.75;
  font-family: 'Outfit Regular', sans-serif;
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
  font-family: 'Outfit Regular', sans-serif;
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
  border: 1px solid #e1e4e8;
  border-radius: 8px;
  background: white;
  cursor: pointer;
  text-align: left;
  font-family: 'Outfit Regular', sans-serif;
  color: var(--mm-black);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  transition:
    border-color 0.15s ease-in-out,
    box-shadow 0.15s ease-in-out,
    transform 0.05s ease-in-out;
}

.vendor-row-button:hover {
  border-color: var(--mm-green);
  box-shadow: 0 2px 8px rgba(73, 176, 150, 0.18);
}

.vendor-row-button:active {
  transform: translateY(1px);
}

.vendor-row--active .vendor-row-button {
  border-color: var(--mm-green);
  box-shadow: 0 0 0 2px rgba(73, 176, 150, 0.35);
}

.vendor-email {
  font-size: 15px;
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
  border-radius: 999px;
  font-family: 'Merge One', sans-serif;
  font-size: 12px;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.vendor-badge--assigned {
  background: rgba(73, 176, 150, 0.16);
  color: #1e7a4f;
}

.vendor-badge--unassigned {
  background: rgba(228, 166, 41, 0.18);
  color: #8a5a00;
}

.vendor-date-count {
  font-size: 13px;
  color: var(--mm-text-muted);
  white-space: nowrap;
}

.vendors-actions {
  padding: 16px 24px;
  border-top: 1px solid #eceff1;
  display: flex;
  justify-content: flex-start;
}

.primary-button {
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: 5px;
  padding: 0 18px;
  height: 38px;
  font-family: 'Merge One', sans-serif;
  font-size: 16px;
  cursor: pointer;
  transition: opacity 0.15s ease-in-out;
}

.primary-button:hover:not(:disabled) {
  opacity: 0.9;
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
  box-shadow: -6px 0 24px rgba(0, 0, 0, 0.18);
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
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.7;
}

.detail-title {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: 22px;
  color: white;
  overflow-wrap: anywhere;
}

/* The panel head is dark, so the muted-on-dark token rather than the on-white one. */
.detail-subtitle {
  margin: 2px 0 0;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: var(--mm-text-muted-on-dark);
  overflow-wrap: anywhere;
}

.detail-close {
  background: transparent;
  border: none;
  color: white;
  font-size: 30px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 6px;
  transition: background-color 0.15s ease-in-out;
}

.detail-close:hover {
  background: rgba(255, 255, 255, 0.12);
}

.detail-section {
  padding: 20px 22px;
  border-bottom: 1px solid #eceff1;
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
  font-size: 16px;
  color: var(--mm-black);
  padding-bottom: 8px;
  border-bottom: 2px solid var(--mm-border);
}

.detail-grid {
  margin: 0;
  display: grid;
  grid-template-columns: minmax(120px, 0.6fr) 1fr;
  gap: 8px 16px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-black);
}

.detail-grid dt {
  font-family: 'Merge One', sans-serif;
  font-size: 13px;
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
  font-family: 'Outfit Regular', sans-serif;
  color: var(--mm-text-muted);
  font-size: 14px;
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
  border: 1px solid #e1e4e8;
  border-left: 4px solid var(--mm-green);
  border-radius: 8px;
  padding: 12px 14px;
  background: white;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.assignment-date {
  font-family: 'Merge One', sans-serif;
  font-size: 15px;
  color: var(--mm-green);
  margin-bottom: 4px;
}

.assignment-detail {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
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
