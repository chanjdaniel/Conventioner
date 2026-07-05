<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { api } from '@/utils/api';
import type { VendorAttendance } from '@/assets/types/datatypes';

const route = useRoute();
const router = useRouter();

const marketId = computed(() => String(route.params.marketId ?? ''));
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
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
}

function formatHeaderDate(d: string): string {
    const parsed = new Date(`${d}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return d;
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
        const data = err && typeof err === 'object' && 'response' in err
            ? (err as { response?: { data?: { error?: string } } }).response?.data
            : undefined;
        errorMessage.value = data?.error || 'Failed to load attendance.';
    } finally {
        isLoading.value = false;
    }
}

function goBack(): void {
    router.push('/assignment-results');
}

onMounted(loadAttendance);
</script>

<template>
    <div class="attendance-status-view">
        <div class="attendance-status-card">
            <header class="attendance-status-header">
                <h1>Attendance Status</h1>
            </header>
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
                                <td class="vendor-cell">{{ vendor }}</td>
                                <td v-for="d in dates" :key="d">{{ cellFor(vendor, d) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="actions-row">
                <button type="button" class="primary-button" @click="goBack" data-testid="attendance-status-back-button">Back</button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.attendance-status-view {
    width: 100%;
    min-height: 100vh;
    padding: 40px 20px;
    display: flex;
    justify-content: center;
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
}

.attendance-status-header {
    background-color: var(--mm-black, #2a2a2a);
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
    font-family: 'Outfit Regular', sans-serif;
    color: var(--mm-black, #2a2a2a);
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
    background: var(--mm-green, #4cae9c);
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
    color: #7f8791;
    padding: 30px 0;
}
</style>
