<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { api } from '@/utils/api';
import type { VendorAttendance } from '@/assets/types/datatypes';
import { getShortDate, getTimestampTime } from '@/utils/utils';
import PhaseRail from '@/components/PhaseRail.vue';
import { useRailMarket } from '@/utils/railMarket';

const route = useRoute();
const router = useRouter();

const marketId = computed(() => String(route.params.marketId ?? ''));
/** The lifecycle band below this screen's header (E10/F01/S01). */
const { market: railMarket, adopt: adoptRailMarket } = useRailMarket(marketId);
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

function goBack(): void {
  router.push({ path: '/market-setup', query: { tab: 'assignment' } });
}

onMounted(loadAttendance);
</script>

<template>
  <div class="attendance-status-view">
    <div class="attendance-status-card">
      <header class="attendance-status-header">
        <h1>Attendance Status</h1>
      </header>

      <PhaseRail :market="railMarket" @phase-advanced="adoptRailMarket" />
      <div class="attendance-status-body">
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
      <div class="actions-row">
        <button
          type="button"
          class="primary-button"
          @click="goBack"
          data-testid="attendance-status-back-button"
        >
          Back
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.attendance-status-view {
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
  background-color: #f6f7f9;
}

.attendance-status-card {
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

.attendance-status-header {
  background-color: var(--mm-black);
  padding: 18px 24px;
}

.attendance-status-header h1 {
  margin: 0;
  color: white;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 26px;
  text-align: center;
}

.attendance-status-body {
  padding: 24px;
  min-height: 200px;
  overflow-y: auto;
  font-family: 'Outfit Regular', sans-serif;
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
  border: 1px solid #e1e4e8;
  padding: 10px 12px;
  text-align: left;
  font-size: 14px;
}

.attendance-table th {
  background-color: #f0f2f4;
  font-family: 'Merge One', sans-serif;
  font-size: 14px;
}

.vendor-cell {
  font-family: 'Outfit Regular', sans-serif;
  font-weight: 600;
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
}

.primary-button:hover:not(:disabled) {
  opacity: 0.9;
}

.error-text {
  margin: 0 0 12px;
  color: #c62828;
  font-size: 14px;
}

.empty-state {
  text-align: center;
  color: var(--mm-text-muted);
  padding: 30px 0;
}
</style>
