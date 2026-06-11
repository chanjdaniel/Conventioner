<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';

import { api } from '@/utils/api';

interface AssignmentRow {
    date: string;
    tableCode: string;
    tableChoice: string;
    section: string;
    tier: string;
    location: string;
    checkedInAt: string | null;
}

interface SummaryResponse {
    marketName: string;
    marketSlug: string;
    vendorEmail: string;
    assignments: AssignmentRow[];
}

const route = useRoute();
const marketSlug = computed(() => String(route.params.marketSlug ?? ''));

const email = ref('');
const summary = ref<SummaryResponse | null>(null);
const lookupError = ref('');
const isLoading = ref(false);
const checkinError = ref('');
const checkingInDate = ref<string | null>(null);

function formatDate(d: string): string {
    const parsed = new Date(`${d}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return d;
    return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTimestamp(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
}

async function fetchSummary(): Promise<void> {
    lookupError.value = '';
    checkinError.value = '';
    if (!email.value.trim()) {
        lookupError.value = 'Please enter your email.';
        return;
    }
    if (!marketSlug.value) {
        lookupError.value = 'Missing market in URL.';
        return;
    }
    isLoading.value = true;
    try {
        const resp = await api.get<SummaryResponse>(
            `/public/markets/${encodeURIComponent(marketSlug.value)}/vendors/${encodeURIComponent(email.value.trim())}/assignments`,
        );
        summary.value = resp.data;
    } catch (err: unknown) {
        summary.value = null;
        const status = err && typeof err === 'object' && 'response' in err
            ? (err as { response?: { status?: number; data?: { error?: string } } }).response
            : undefined;
        if (status?.status === 404) {
            lookupError.value = status.data?.error || 'No assignment found for this email.';
        } else {
            lookupError.value = status?.data?.error || 'Unable to look up assignment. Please try again.';
        }
    } finally {
        isLoading.value = false;
    }
}

async function checkIn(date: string): Promise<void> {
    if (!summary.value) return;
    checkinError.value = '';
    checkingInDate.value = date;
    try {
        await api.post(
            `/public/markets/${encodeURIComponent(marketSlug.value)}/attendance/checkin`,
            { vendorEmail: summary.value.vendorEmail, date },
        );
        await fetchSummary();
    } catch (err: unknown) {
        const data = err && typeof err === 'object' && 'response' in err
            ? (err as { response?: { data?: { error?: string } } }).response?.data
            : undefined;
        checkinError.value = data?.error || 'Failed to check in. Please try again.';
    } finally {
        checkingInDate.value = null;
    }
}
</script>

<template>
    <div class="attendance-view">
        <div class="attendance-card">
            <header class="attendance-header">
                <h1>{{ summary ? `Check in for ${summary.marketName}` : 'Vendor Check-in' }}</h1>
            </header>
            <div class="attendance-body">
                <form class="lookup-form" @submit.prevent="fetchSummary">
                    <label for="vendor-email">Your email</label>
                    <div class="lookup-row">
                        <input
                            id="vendor-email"
                            v-model="email"
                            type="email"
                            placeholder="you@example.com"
                            autocomplete="email"
                        />
                        <button type="submit" class="primary-button" :disabled="isLoading">
                            {{ isLoading ? 'Looking up…' : 'Look up' }}
                        </button>
                    </div>
                    <p v-if="lookupError" class="error-text">{{ lookupError }}</p>
                </form>

                <div v-if="summary" class="assignments-list">
                    <p v-if="checkinError" class="error-text">{{ checkinError }}</p>
                    <article
                        v-for="row in summary.assignments"
                        :key="row.date + row.tableCode"
                        class="assignment-card"
                    >
                        <div class="assignment-date">{{ formatDate(row.date) }}</div>
                        <div class="assignment-meta">
                            <div><strong>Table:</strong> {{ row.tableCode }} ({{ row.tableChoice }})</div>
                            <div><strong>Section:</strong> {{ row.section }}</div>
                            <div><strong>Tier:</strong> {{ row.tier }}</div>
                            <div><strong>Location:</strong> {{ row.location }}</div>
                        </div>
                        <div class="assignment-action">
                            <button
                                v-if="!row.checkedInAt"
                                type="button"
                                class="primary-button"
                                :disabled="checkingInDate === row.date"
                                @click="checkIn(row.date)"
                            >
                                {{ checkingInDate === row.date ? 'Checking in…' : 'Check in' }}
                            </button>
                            <span v-else class="checked-in-pill">
                                Checked in &#10003; at {{ formatTimestamp(row.checkedInAt) }}
                            </span>
                        </div>
                    </article>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.attendance-view {
    width: 100%;
    min-height: 100vh;
    padding: 40px 20px;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    background-color: #f6f7f9;
}

.attendance-card {
    width: 100%;
    max-width: 720px;
    background-color: white;
    box-shadow: 0px 0px 4px 5px rgba(0, 0, 0, 0.15);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.attendance-header {
    background-color: var(--mm-black, #2a2a2a);
    padding: 18px 24px;
}

.attendance-header h1 {
    margin: 0;
    color: white;
    font-family: 'Outfit Regular', sans-serif;
    font-size: 26px;
    text-align: center;
}

.attendance-body {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
}

.lookup-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.lookup-form label {
    font-family: 'Outfit Regular', sans-serif;
    font-size: 14px;
    color: var(--mm-black, #2a2a2a);
}

.lookup-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
}

.lookup-row input {
    flex: 1;
    min-width: 200px;
    padding: 10px 12px;
    font-family: 'Outfit Regular', sans-serif;
    font-size: 16px;
    border: 1px solid #cfd3d8;
    border-radius: 6px;
}

.primary-button {
    background: var(--mm-green, #4cae9c);
    color: white;
    border: none;
    border-radius: 5px;
    padding: 0 16px;
    height: 40px;
    font-family: 'Merge One', sans-serif;
    font-size: 16px;
    cursor: pointer;
    transition: opacity 0.15s ease-in-out;
}

.primary-button:hover:not(:disabled) {
    opacity: 0.9;
}

.primary-button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}

.error-text {
    margin: 0;
    color: #c62828;
    font-size: 14px;
    font-family: 'Outfit Regular', sans-serif;
}

.assignments-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.assignment-card {
    border: 1px solid #e1e4e8;
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.assignment-date {
    font-family: 'Merge One', sans-serif;
    font-size: 18px;
    color: var(--mm-green, #4cae9c);
}

.assignment-meta {
    font-family: 'Outfit Regular', sans-serif;
    font-size: 15px;
    color: var(--mm-black, #2a2a2a);
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 16px;
}

.assignment-action {
    display: flex;
    justify-content: flex-end;
}

.checked-in-pill {
    background: #e7f5ee;
    color: #1e7a4f;
    padding: 6px 12px;
    border-radius: 999px;
    font-family: 'Outfit Regular', sans-serif;
    font-size: 14px;
}
</style>
