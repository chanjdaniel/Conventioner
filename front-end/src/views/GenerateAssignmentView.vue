<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';

import {
  type AssignmentStatistics,
  type Market,
  type UnassignedTableEntry,
  MarketPhase,
} from '@/assets/types/datatypes';
import AssignmentStatListItem from '@/components/AssignmentStatListItem.vue';
import VendorsModal from '@/components/VendorsModal.vue';
import IconSettings from '@/components/icons/IconSettings.vue';
import IconTables from '@/components/icons/IconTables.vue';
import IconVendors from '@/components/icons/IconVendors.vue';
import { api } from '@/utils/api';
import { parseMarketFromApi } from '@/utils/market';
import { marketNameToKebabSlug } from '@/utils/marketSlug';

const router = useRouter();

const assignmentStatistics = ref<AssignmentStatistics | null>(null);
const market = ref<Market | null>(null);
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
  dateDisplay: string;
}

interface UnassignedTableDateGroup {
  dateRaw: string;
  dateDisplay: string;
  rows: UnassignedTableDisplayRow[];
}

function formatDisplayDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
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
          dateDisplay,
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

const NO_EMAIL_HINT =
  '(no email — check Assignment Options column mapping matches the column names in Manage Columns)';

function displayUnassignedEntry(vendor: unknown): string {
  if (vendor == null) return '(unknown)';
  if (typeof vendor === 'string') {
    return vendor.trim() || NO_EMAIL_HINT;
  }
  const o = vendor as { email?: string; name?: string };
  const t = o.email || o.name;
  if (t && String(t).trim()) return String(t);
  return NO_EMAIL_HINT;
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
  const raw = localStorage.getItem('market');
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as unknown;
    market.value = parseMarketFromApi(parsed);
    assignmentStatistics.value = null;
    const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
    if (!market.value?.id || !userEmail) return;

    api
      .get(`/markets/${encodeURIComponent(market.value.id)}/assignment-statistics`)
      .then((response) => {
        assignmentStatistics.value = response.data as AssignmentStatistics;
      })
      .catch(() => {
        assignmentStatistics.value = null;
      });
  } catch {
    market.value = null;
  }
});

const openVendorsModal = () => {
  showVendorsModal.value = true;
};

const closeVendorsModal = () => {
  showVendorsModal.value = false;
};

const handleBack = () => {
  router.push('/market-setup');
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
  const parsed = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const doneError = ref('');
const downloadError = ref('');
const isDownloading = ref(false);
const discordError = ref('');
const discordToast = ref('');
const isPostingDiscord = ref(false);

const hasDiscordWebhook = computed(() => {
  const url = market.value?.discordWebhookUrl;
  return typeof url === 'string' && url.trim().length > 0;
});

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

const handleSendToDiscord = async () => {
  discordError.value = '';
  discordToast.value = '';
  if (!market.value?.id) {
    discordError.value = 'No market loaded.';
    return;
  }
  if (!hasDiscordWebhook.value) {
    discordError.value = 'No Discord webhook configured for this market.';
    return;
  }
  const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
  if (!userEmail) {
    discordError.value = 'You must be signed in to send to Discord.';
    return;
  }
  isPostingDiscord.value = true;
  try {
    await api.post(`/markets/${encodeURIComponent(market.value.id)}/discord/notify-assignment`, {});
    discordToast.value = 'Posted to Discord';
    setTimeout(() => {
      discordToast.value = '';
    }, 3000);
  } catch (err: unknown) {
    let message = 'Failed to post to Discord.';
    const response =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response
        : undefined;
    const errVal = response?.data?.error;
    if (typeof errVal === 'string' && errVal) message = errVal;
    discordError.value = message;
  } finally {
    isPostingDiscord.value = false;
  }
};

const handleDone = async () => {
  doneError.value = '';
  const raw = localStorage.getItem('market');
  if (!raw) {
    doneError.value = 'No market loaded.';
    return;
  }
  let market: Market;
  try {
    market = JSON.parse(raw) as Market;
  } catch {
    doneError.value = 'Invalid market data.';
    return;
  }
  try {
    const response = await api.post(`/markets/${encodeURIComponent(market.id)}/transition`, {
      toPhase: 'archived',
    });
    // Update localStorage with the new phase so future reads reflect the advance.
    market = { ...market, phase: response.data.phase as MarketPhase };
    localStorage.setItem('market', JSON.stringify(market));
    // Also persist via PUT so the full market body stays in sync (isDraft is server-derived now).
    await api.put(`/markets/${encodeURIComponent(market.id)}`, market);
    const slug = marketNameToKebabSlug(market.name);
    if (slug) {
      router.push(`/${slug}`);
    } else {
      router.push('/market-setup');
    }
  } catch (err: unknown) {
    const response =
      err && typeof err === 'object' && 'response' in err
        ? (
            err as {
              response?: {
                status?: number;
                data?: { error?: string; blockers?: Array<{ message: string }> };
              };
            }
          ).response
        : undefined;
    if (response?.status === 409 && response.data?.blockers) {
      doneError.value = response.data.blockers.map((b: { message: string }) => b.message).join(' ');
    } else {
      const msg = response?.data?.error;
      doneError.value = msg || 'Failed to publish market.';
    }
  }
};
</script>

<template>
  <VendorsModal :open="showVendorsModal" :market="market" @close="closeVendorsModal" />
  <div class="generate-assignment-view">
    <div class="generate-assignment-window">
      <div class="generate-assignment-container">
        <div class="generate-assignment-header">
          <h1>Assignment Results</h1>
        </div>
        <div class="generate-assignment-body">
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
                    <span class="stat-label">Satisfaction Score</span>
                    <span class="stat-value"
                      >{{ (assignmentStatistics.satisfactionScore * 100).toFixed(1) }}%</span
                    >
                  </div>
                </div>
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
                    <IconSettings class="assignment-quick-nav-icon" />
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
                    :label="`Section ${section}`"
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
                <div class="stat-list">
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
                    <div
                      v-for="(vendor, index) in unassignedVendorList"
                      :key="index"
                      class="unassigned-item"
                    >
                      <span class="unassigned-text">{{ displayUnassignedEntry(vendor) }}</span>
                    </div>
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
                          <span class="unassigned-text unassigned-table-label"
                            >{{ row.tableCode }} - {{ row.tableChoice }}</span
                          >
                          <span class="unassigned-table-date">{{ row.dateDisplay }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>
          <div v-else class="no-data-message">
            <p>No assignment statistics available.</p>
          </div>
        </div>
      </div>
      <p v-if="doneError" class="done-error">{{ doneError }}</p>
      <p v-if="downloadError" class="done-error">{{ downloadError }}</p>
      <p v-if="discordError" class="done-error" data-testid="assignment-results-discord-error">
        {{ discordError }}
      </p>
      <p v-if="discordToast" class="discord-toast" data-testid="assignment-results-discord-toast">
        {{ discordToast }}
      </p>
      <div class="assignment-actions-row">
        <div>
          <button
            class="done-button"
            @click="handleBack"
            data-testid="assignment-results-back-button"
          >
            Back
          </button>
        </div>
        <div>
          <button
            class="done-button download-button"
            :disabled="isDownloading || !assignmentStatistics"
            @click="handleDownloadCsv"
            data-testid="assignment-results-download-csv-button"
          >
            {{ isDownloading ? 'Downloading…' : 'Download CSV' }}
          </button>
        </div>
        <div>
          <button
            class="done-button discord-button"
            :disabled="isPostingDiscord || !assignmentStatistics || !hasDiscordWebhook"
            :title="
              hasDiscordWebhook ? '' : 'Configure a Discord webhook URL in Market Setup to enable.'
            "
            @click="handleSendToDiscord"
            data-testid="assignment-results-send-discord-button"
          >
            {{ isPostingDiscord ? 'Sending…' : 'Send to Discord' }}
          </button>
        </div>
        <div>
          <button
            class="done-button"
            @click="handleDone"
            data-testid="assignment-results-done-button"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.generate-assignment-view {
  width: 100%;
  min-width: 1000px;
  flex: 1;
  min-height: 0;

  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

/* Match `.market-setup-body` on Market Setup (Assignment Priority / Assignment options): 80% × 80% centered card.
   Do not set overflow:hidden here — it clips the white card's box-shadow (same shadow as `.settings-container`). */
.generate-assignment-window {
  width: 80%;
  height: 80%;
  max-height: 80%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.generate-assignment-container {
  align-self: stretch;
  flex: 1;
  min-height: 0;
  background-color: white;
  box-shadow: 0px 0px 4px 5px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.generate-assignment-header {
  align-self: stretch;
  height: 50px;
  background-color: var(--mm-black);
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
}

.generate-assignment-body {
  align-self: stretch;
  flex-grow: 1;
  /* Extra top/side inset so centered box-shadows (e.g. quick-nav) are not clipped by overflow */
  padding: 36px 36px 30px 36px;
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
  flex: 1;
  min-height: 0;
  width: 100%;
  /* Inset so stat-card / quick-nav box-shadows stay inside the overflow clip (large spread needs ≥~16px) */
  padding: 18px;
  overflow: hidden;
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
  border-right: 1.75px solid #2723237c;
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
  box-shadow: 0px -1.5px 5px 1.5px var(--hover-grey);
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
  font-size: 18px;
  color: var(--mm-black);
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.statistics-body-grid {
  min-height: 0;
  /* Do not add horizontal padding here — it misaligns grid cards vs `.statistics-header-row`.
       Shadow clearance comes from `.statistics-layout` padding; avoid `overflow:hidden` here
       or it clips card shadows at the grid box without matching the header inset. */
  overflow: visible;
}

.statistics-body-grid--with-unassigned {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 25px;
  flex: 1;
  align-items: stretch;
}

.statistics-body-grid--four-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 25px;
  flex: 1;
  min-height: 0;
  align-items: stretch;
}

.statistics-body-grid > .stat-card {
  min-height: 0;
}

.statistics-body-grid > .stat-card .stat-list {
  flex: 1;
  min-height: 0;
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
.stat-card {
  background-color: white;
  border-radius: 10px;
  padding: 20px;
  box-shadow: 0px 0px 4px 5px rgba(0, 0, 0, 0.25);
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

.summary-card {
  background: linear-gradient(135deg, var(--mm-green) 0%, #3a9d82 100%);
}

.summary-card h3,
.summary-card .stat-label,
.summary-card .stat-value {
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
  font-size: 13px;
  text-align: center;
  overflow-wrap: anywhere;
}

.summary-card .stat-value {
  font-size: clamp(18px, 2.2vw, 24px);
  line-height: 1.15;
  text-align: center;
  overflow-wrap: anywhere;
}

.stat-card h3 {
  font-family: 'Merge One';
  font-size: 22px;
  color: var(--mm-black);
  margin: 0;
  border-bottom: 2px solid var(--mm-grey);
  padding-bottom: 10px;
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
  font-family: 'Outfit Regular';
  font-size: 16px;
  color: var(--mm-black);
  opacity: 0.8;
}

.stat-value {
  font-family: 'Merge One';
  font-size: 36px;
  font-weight: bold;
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

.statistics-body-grid .unassigned-card .unassigned-list {
  flex: 1;
  min-height: 0;
  max-height: none;
  overflow-y: auto;
}

.unassigned-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
  /* Match `.stat-list`: inset so row box-shadows are not clipped by the scrollport */
  padding: 8px 10px;
}

.unassigned-item {
  padding: 6px 12px;
  background-color: white;
  border-radius: 6px;
  border-left: 4px solid var(--mm-yellow);
  font-family: 'Outfit Regular';
  font-size: 15px;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.07),
    0 2px 4px rgba(0, 0, 0, 0.07),
    0 6px 14px rgba(0, 0, 0, 0.08);
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

.unassigned-table-date {
  flex-shrink: 0;
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: #7f8791;
  text-align: right;
  white-space: nowrap;
  line-height: 1.3;
}

.unassigned-date-group {
  margin-bottom: 15px;
}

.unassigned-date-header {
  font-family: 'Merge One';
  font-size: 16px;
  font-weight: bold;
  color: var(--mm-black);
  margin-bottom: 8px;
  padding-bottom: 5px;
  border-bottom: 2px solid var(--mm-grey);
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
  font-family: 'Outfit Regular';
  font-size: 18px;
  color: var(--mm-grey);
}

h1 {
  font-family: 'Outfit Regular';
  text-align: center;
  font-size: 30px;
  color: white;
}

h2 {
  font-family: 'Merge One';
  text-align: left;
  font-size: 26px;
  color: white;
}

.done-error {
  margin: 8px 0 0;
  color: #c62828;
  font-size: 14px;
}

.assignment-actions-row {
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.done-button {
  margin-top: 15px;
  width: 100px;
  height: 35px;

  background: var(--mm-green);
  border-radius: 5px;
  border: none;

  font-family: 'Merge One';
  font-style: normal;
  font-weight: 400;
  font-size: 20px;
  line-height: 15px;
  text-align: center;

  color: #ffffff;
  cursor: pointer;
  transition:
    opacity 0.15s ease-in-out,
    background-color 0.15s ease-in-out;
}

.done-button:hover:not(:disabled) {
  opacity: 0.9;
}

.done-button:disabled {
  background: var(--mm-grey, #b0b0b0);
  cursor: not-allowed;
  opacity: 0.6;
}

.download-button {
  width: 180px;
  font-size: 18px;
}

.discord-button {
  width: 200px;
  font-size: 18px;
  background: #5865f2;
}

.discord-button:hover:not(:disabled) {
  opacity: 0.9;
}

.discord-toast {
  margin: 8px 0 0;
  color: #2e7d32;
  font-size: 14px;
}
</style>
