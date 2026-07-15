<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { api } from '@/utils/api';

interface MarketTableRow {
  date: string;
  assignment: string[];
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

const route = useRoute();
const router = useRouter();

const marketId = computed(() => String(route.params.marketId ?? ''));
const allRows = ref<MarketTableRow[]>([]);
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
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
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
  const assignment = row.assignment;

  if (!assignment || assignment.length === 0) {
    return { label: 'empty', leftEmail: null, rightEmail: null, isFull };
  }

  if (isFull) {
    const email = assignment[0] ?? null;
    return { label: 'assigned', leftEmail: email, rightEmail: email, isFull };
  }

  const left = assignment[0] ?? null;
  const right = assignment[1] ?? null;
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

function clearFilter(name: 'date' | 'section' | 'tier' | 'choice'): void {
  const nextQuery = { ...route.query };
  delete nextQuery[name];
  router.replace({ query: nextQuery });
}

function clearAllFilters(): void {
  router.replace({ query: {} });
}

function choiceFilterLabel(filter: ChoiceFilter): string {
  if (filter === 'full') return 'Full Tables';
  if (filter === 'half') return 'Half Tables';
  return '';
}

function goBack(): void {
  router.push('/assignment-results');
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
    const resp = await api.get<MarketTableRow[]>(
      `/markets/${encodeURIComponent(marketId.value)}/tables`,
    );
    allRows.value = Array.isArray(resp.data) ? resp.data : [];
  } catch (err: unknown) {
    const data =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data
        : undefined;
    errorMessage.value = data?.error || 'Failed to load tables.';
    allRows.value = [];
  } finally {
    isLoading.value = false;
  }
}

watch(() => marketId.value, loadTables);

onMounted(loadTables);
</script>

<template>
  <div class="tables-view">
    <div class="tables-card">
      <header class="tables-header">
        <h1>Tables</h1>
      </header>

      <div class="tables-body">
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

        <div v-if="isLoading" class="status-message">Loading tables…</div>

        <template v-else-if="allRows.length === 0 && !errorMessage">
          <div class="empty-state">
            <p>No tables found for this market.</p>
          </div>
        </template>

        <template v-else-if="allRows.length > 0">
          <div class="filter-bar">
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
              <span class="count-badge count-badge--assigned"
                >{{ statusCounts.assigned }} assigned</span
              >
              <span class="count-badge count-badge--partial"
                >{{ statusCounts.partial }} partial</span
              >
              <span class="count-badge count-badge--empty">{{ statusCounts.empty }} empty</span>
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
                  <span class="section-heading-name">Section {{ sectionGroup.section }}</span>
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

                    <div class="table-row-assignment">
                      <template v-if="rowStatus(row).label === 'empty'">
                        <span class="assignment-empty">— Unassigned —</span>
                      </template>
                      <template v-else-if="rowStatus(row).isFull">
                        <span class="assignment-email assignment-email--full">{{
                          rowStatus(row).leftEmail
                        }}</span>
                      </template>
                      <template v-else>
                        <div class="half-slot">
                          <span class="half-slot-label">Left</span>
                          <span
                            class="assignment-email"
                            :class="{ 'assignment-email--vacant': !rowStatus(row).leftEmail }"
                          >
                            {{ rowStatus(row).leftEmail || '— vacant —' }}
                          </span>
                        </div>
                        <div class="half-slot">
                          <span class="half-slot-label">Right</span>
                          <span
                            class="assignment-email"
                            :class="{ 'assignment-email--vacant': !rowStatus(row).rightEmail }"
                          >
                            {{ rowStatus(row).rightEmail || '— vacant —' }}
                          </span>
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

      <div class="actions-row">
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
  </div>
</template>

<style scoped>
.tables-view {
  width: 100%;
  min-height: 100vh;
  padding: 40px 20px;
  display: flex;
  justify-content: center;
  background-color: #f6f7f9;
}

.tables-card {
  width: 100%;
  max-width: 1100px;
  background-color: white;
  box-shadow: 0px 0px 4px 5px rgba(0, 0, 0, 0.15);
  border-radius: 10px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 60vh;
}

.tables-header {
  background-color: var(--mm-black);
  padding: 18px 24px;
}

.tables-header h1 {
  margin: 0;
  color: white;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 26px;
  text-align: center;
}

.tables-body {
  padding: 24px;
  font-family: 'Outfit Regular', sans-serif;
  color: var(--mm-black);
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
}

.filter-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  background-color: white;
  padding: 12px 0;
  border-bottom: 1px solid var(--mm-grey);
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
  font-size: 14px;
  color: var(--mm-black);
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background-color: var(--mm-beige);
  border: 1px solid var(--mm-grey);
  border-radius: 20px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
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
  font-size: 16px;
  line-height: 1;
  color: var(--mm-black);
  font-weight: bold;
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
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
}

.counts-primary {
  font-family: 'Merge One', sans-serif;
  font-size: 15px;
  color: var(--mm-black);
}

.count-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 13px;
  font-family: 'Outfit Regular', sans-serif;
}

.count-badge--assigned {
  background-color: var(--mm-green);
  color: white;
}

.count-badge--partial {
  background-color: var(--mm-yellow);
  color: var(--mm-black);
}

.count-badge--empty {
  background-color: var(--mm-beige);
  color: var(--mm-black);
  border: 1px solid var(--mm-grey);
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
  font-size: 22px;
  color: var(--mm-black);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.date-heading-count {
  font-size: 14px;
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
  font-size: 16px;
  color: var(--mm-black);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.section-heading-name {
  font-size: 17px;
}

.section-heading-meta {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  padding: 2px 8px;
  background-color: var(--mm-beige);
  border-radius: 10px;
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
  border-radius: 8px;
  border-left: 4px solid var(--mm-green);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.06),
    0 2px 4px rgba(0, 0, 0, 0.06),
    0 6px 14px rgba(0, 0, 0, 0.07);
}

.table-row--partial {
  border-left-color: var(--mm-yellow);
}

.table-row--empty {
  border-left-color: var(--mm-yellow);
  background-color: #fffbe6;
}

.table-row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.table-code {
  font-family: 'Merge One', sans-serif;
  font-size: 20px;
  color: var(--mm-black);
  letter-spacing: 0.5px;
}

.choice-badge {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 10px;
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
  border: 1px solid var(--mm-grey);
}

.meta-tag {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
  color: var(--mm-black);
  opacity: 0.65;
}

.table-row-assignment {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding-top: 4px;
  border-top: 1px dashed var(--mm-grey);
}

.assignment-email {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
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
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
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

.half-slot-label {
  font-family: 'Merge One', sans-serif;
  font-size: 11px;
  text-transform: uppercase;
  color: var(--mm-black);
  opacity: 0.55;
  letter-spacing: 0.6px;
}

.actions-row {
  padding: 16px 24px;
  display: flex;
  justify-content: flex-start;
  border-top: 1px solid #eceff1;
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
  color: #c62828;
  font-size: 14px;
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
    font-size: 18px;
  }

  .table-row-head {
    gap: 8px;
  }

  .table-code {
    font-size: 18px;
  }
}
</style>
