<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

import { api } from '@/utils/api';
import type { VendorAttendance } from '@/assets/types/datatypes';
import { getShortDate, getTimestampTime } from '@/utils/utils';
import MarketFrame from '@/components/MarketFrame.vue';
import { useOpenMarket } from '@/utils/openMarket';
import MarketArrival from '@/components/MarketArrival.vue';

const route = useRoute();

const marketId = computed(() => String(route.params.marketId ?? ''));
/** The lifecycle band below this screen's header (E10/F01/S01). */
const { market, status: marketStatus, refresh: refreshMarket } = useOpenMarket(marketId);

/** A failed arrival retries both halves: the market the rail draws, and this screen's own rows. */
function retryArrival(): void {
  void refreshMarket();
  void loadAttendance();
}
const attendance = ref<VendorAttendance[]>([]);
const errorMessage = ref('');
const isLoading = ref(false);

const dates = computed(() => {
  const set = new Set<string>();
  for (const a of attendance.value) set.add(a.date);
  return Array.from(set).sort();
});

const vendors = computed(() => {
  const set = new Set<string>();
  for (const a of attendance.value) set.add(a.vendorEmail);
  return Array.from(set).sort();
});

const lookup = computed(() => {
  const map = new Map<string, string>();
  for (const a of attendance.value) {
    map.set(`${a.vendorEmail}|${a.date}`, a.checkedInAt);
  }
  return map;
});

function cellFor(vendor: string, date: string): string {
  const value = lookup.value.get(`${vendor}|${date}`);
  if (!value) return '-';
  // The column already names the day; the cell answers what time they arrived.
  return getTimestampTime(value);
}

function formatHeaderDate(d: string): string {
  return getShortDate(d);
}

async function loadAttendance(): Promise<void> {
  errorMessage.value = '';
  if (!marketId.value) {
    errorMessage.value = 'Missing market id.';
    return;
  }
  const userEmail = JSON.parse(localStorage.getItem('user') || 'null');
  if (!userEmail) {
    errorMessage.value = 'You must be signed in.';
    return;
  }
  isLoading.value = true;
  try {
    const resp = await api.get<{ attendance: VendorAttendance[] }>(
      `/markets/${encodeURIComponent(marketId.value)}/attendance`,
    );
    attendance.value = resp.data.attendance || [];
  } catch (err: unknown) {
    const data =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data
        : undefined;
    errorMessage.value = data?.error || 'Failed to load attendance.';
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadAttendance);
</script>

<template>
  <div class="attendance-status-view">
    <MarketFrame class="attendance-status-card" :market="market">
      <MarketArrival v-if="!market" :status="marketStatus" @retry="retryArrival" />
      <div v-if="marketStatus !== 'missing'" class="attendance-status-body">
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
        <p v-if="isLoading">Loading…</p>
        <div v-else-if="attendance.length === 0" class="empty-state">
          <p>No check-ins recorded yet.</p>
        </div>
        <div v-else class="table-wrapper">
          <table class="attendance-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th v-for="d in dates" :key="d">{{ formatHeaderDate(d) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="vendor in vendors" :key="vendor">
                <td class="vendor-cell" data-testid="attendance-status-vendor-cell">
                  {{ vendor }}
                </td>
                <td
                  v-for="d in dates"
                  :key="d"
                  :data-date="d"
                  data-testid="attendance-status-date-cell"
                >
                  {{ cellFor(vendor, d) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </MarketFrame>
  </div>
</template>

<style scoped>
.attendance-status-view {
  width: 100%;
  padding: 0 var(--space-4) var(--space-4);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background-color: var(--mm-beige);
}

.attendance-status-card {
  /* The page scrolls, not the card (E21/F04/S02): the frame pins the title and the rail under the
     banner, and a sticky element inside an `overflow` ancestor stops sticking. This used to cap the
     card at the viewport and scroll a body inside it. */
  border-radius: var(--radius-card);
}

.attendance-status-body {
  padding: 24px;
  min-height: 200px;
  color: var(--mm-black);
}

.table-wrapper {
  overflow-x: auto;
}

.attendance-table {
  width: 100%;
  border-collapse: collapse;
}

.attendance-table th,
.attendance-table td {
  border: 1px solid var(--mm-border);
  padding: 10px 12px;
  text-align: left;
  font-size: var(--text-sm);
}

.attendance-table th {
  background-color: var(--mm-beige);
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
}

.vendor-cell {
  font-weight: 600;
}

.error-text {
  margin: 0 0 12px;
  color: var(--mm-red);
  font-size: var(--text-sm);
}

.empty-state {
  text-align: center;
  color: var(--mm-text-muted);
  padding: 30px 0;
}
</style>
