<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { api } from '@/utils/api';
import { parseMarketFromApi } from '@/utils/market';
import type { Market, MarketDateObject } from '@/assets/types/datatypes';

interface SourceDataResponse {
    data: unknown[][];
}

interface AssignmentStatisticsResponse {
    totalVendors?: number;
    totalAssignedVendors?: number;
    unassignedVendors?: unknown[];
    unassigned_vendors?: unknown[];
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
    cells: string[];
}

const router = useRouter();

const market = ref<Market | null>(null);
const sourceRows = ref<string[][]>([]);
const tableRows = ref<MarketTableRowResponse[]>([]);
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
        const [sourceResp, statsResp, tablesResp] = await Promise.all([
            api.get<SourceDataResponse>(`/source-data/${marketId}`),
            api.get<AssignmentStatisticsResponse>(
                `/markets/${marketId}/assignment-statistics`,
            ),
            api.get<MarketTableRowResponse[]>(`/markets/${marketId}/tables`),
        ]);

        const rawRows = Array.isArray(sourceResp.data?.data) ? sourceResp.data.data : [];
        sourceRows.value = rawRows.map((row) =>
            Array.isArray(row) ? row.map((c) => (c == null ? '' : String(c))) : [],
        );

        const statsList = statsResp.data?.unassignedVendors ?? statsResp.data?.unassigned_vendors ?? [];
        const unassigned = new Set<string>();
        for (const item of statsList) {
            const email = extractEmail(item).toLowerCase();
            if (email) unassigned.add(email);
        }
        unassignedEmails.value = unassigned;

        tableRows.value = Array.isArray(tablesResp.data) ? tablesResp.data : [];
    } catch (err: unknown) {
        loadError.value = extractErrorMessage(err, 'Failed to load vendors.');
        sourceRows.value = [];
        tableRows.value = [];
        unassignedEmails.value = new Set();
    } finally {
        isLoading.value = false;
    }
}

onMounted(loadVendors);

const setup = computed(() => market.value?.setupObject ?? null);
const colNames = computed(() => setup.value?.colNames ?? []);
const colInclude = computed(() => setup.value?.colInclude ?? []);
const marketDates = computed<MarketDateObject[]>(() => setup.value?.marketDates ?? []);

const emailColIdx = computed(() => {
    const idx = setup.value?.assignmentOptions?.emailColNameIdx;
    return typeof idx === 'number' && idx >= 0 ? idx : null;
});

const includedColIndices = computed(() => {
    const include = colInclude.value;
    const names = colNames.value;
    const out: number[] = [];
    for (let i = 0; i < names.length; i++) {
        if (include[i]) out.push(i);
    }
    return out;
});

const assignmentsByEmail = computed(() => {
    const map = new Map<string, Map<string, VendorTableAssignment>>();
    for (const row of tableRows.value) {
        if (!Array.isArray(row.assignment)) continue;
        for (const email of row.assignment) {
            const key = String(email ?? '').trim().toLowerCase();
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

const vendors = computed<VendorRow[]>(() => {
    const rows = sourceRows.value;
    if (rows.length < 2) return [];

    const emailIdx = emailColIdx.value;
    const unassigned = unassignedEmails.value;
    const byEmail = assignmentsByEmail.value;

    const result: VendorRow[] = [];
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r] ?? [];
        const emailRaw =
            emailIdx != null && emailIdx < row.length ? String(row[emailIdx] ?? '').trim() : '';
        const emailLower = emailRaw.toLowerCase();
        const assignmentsByDate = emailLower
            ? byEmail.get(emailLower) ?? new Map<string, VendorTableAssignment>()
            : new Map<string, VendorTableAssignment>();

        const isAssigned = emailLower
            ? !unassigned.has(emailLower) && assignmentsByDate.size > 0
            : assignmentsByDate.size > 0;

        result.push({
            rowIndex: r,
            email: emailLower,
            displayEmail: emailRaw || `Row ${r}`,
            assignmentsByDate,
            isAssigned,
            assignedDateCount: assignmentsByDate.size,
            cells: row,
        });
    }
    return result;
});

const filteredVendors = computed(() => {
    const term = filterText.value.trim().toLowerCase();
    if (!term) return vendors.value;
    return vendors.value.filter((v) => v.displayEmail.toLowerCase().includes(term));
});

const totalVendorCount = computed(() => vendors.value.length);
const assignedVendorCount = computed(() => vendors.value.filter((v) => v.isAssigned).length);
const totalDateCount = computed(() => marketDates.value.length);

const selectedVendor = computed(() => {
    if (selectedRowIndex.value == null) return null;
    return vendors.value.find((v) => v.rowIndex === selectedRowIndex.value) ?? null;
});

const detailFields = computed(() => {
    const vendor = selectedVendor.value;
    if (!vendor) return [];
    const names = colNames.value;
    const emailIdx = emailColIdx.value;
    const fields: { label: string; value: string }[] = [];
    for (const i of includedColIndices.value) {
        if (i === emailIdx) continue;
        const label = names[i] ?? `Column ${i + 1}`;
        const value = i < vendor.cells.length ? vendor.cells[i] : '';
        fields.push({ label, value: value || '—' });
    }
    return fields;
});

function formatDateLabel(date: string): string {
    const parsed = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return date;
    return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function assignmentSummary(assignment: VendorTableAssignment | undefined): string {
    if (!assignment) return '—';
    const parts: string[] = [];
    const codePart = assignment.tableCode || '—';
    const choice = assignment.tableChoice ? ` (${assignment.tableChoice})` : '';
    parts.push(`${codePart}${choice}`);
    const meta = [assignment.section, assignment.tier, assignment.location]
        .filter((s) => !!s && s.trim().length > 0)
        .join(', ');
    if (meta) parts.push(meta);
    return parts.join(' — ');
}

function selectVendor(rowIndex: number): void {
    selectedRowIndex.value = rowIndex;
}

function closeDetail(): void {
    selectedRowIndex.value = null;
}

function handleBack(): void {
    if (market.value?.id) {
        router.push('/assignment-results');
    } else {
        router.push('/dashboard');
    }
}

function goToDashboard(): void {
    router.push('/dashboard');
}
</script>

<template>
    <div class="vendors-view">
        <div class="vendors-card">
            <header class="vendors-header">
                <h1>{{ market ? `Vendors — ${market.name}` : 'Vendors' }}</h1>
            </header>

            <div class="vendors-body">
                <div v-if="!market" class="empty-state">
                    <p>No market loaded. Go back to the dashboard to choose one.</p>
                    <button type="button" class="primary-button" @click="goToDashboard">
                        Back to Dashboard
                    </button>
                </div>

                <template v-else>
                    <div class="vendors-toolbar">
                        <label class="filter-label" for="vendor-filter">Search vendors</label>
                        <input
                            id="vendor-filter"
                            v-model="filterText"
                            type="search"
                            placeholder="Filter by email…"
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

                    <div
                        v-else-if="filteredVendors.length === 0"
                        class="empty-state empty-state--inline"
                    >
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
                                <span class="vendor-email">{{ vendor.displayEmail }}</span>
                                <span class="vendor-meta">
                                    <span
                                        class="vendor-badge"
                                        :class="vendor.isAssigned ? 'vendor-badge--assigned' : 'vendor-badge--unassigned'"
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
                <button type="button" class="primary-button" @click="handleBack" data-testid="vendors-back-button">Back</button>
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
                        <h2 class="detail-title">{{ selectedVendor.displayEmail }}</h2>
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
                        <li
                            v-for="date in marketDates"
                            :key="date.date"
                            class="assignment-item"
                            :data-date="date.date"
                            data-testid="vendors-detail-assignment-item"
                        >
                            <div class="assignment-date">{{ formatDateLabel(date.date) }}</div>
                            <div class="assignment-detail">
                                {{ assignmentSummary(selectedVendor.assignmentsByDate.get(date.date)) }}
                            </div>
                        </li>
                    </ul>
                </section>
            </div>
        </aside>
    </div>
</template>

<style scoped>
.vendors-view {
    width: 100%;
    min-height: 100vh;
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
}

.vendors-header {
    background-color: var(--mm-black, #272323);
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
    min-height: 320px;
    font-family: 'Outfit Regular', sans-serif;
    color: var(--mm-black, #272323);
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
    color: var(--mm-black, #272323);
    opacity: 0.75;
}

.filter-input {
    width: 100%;
    padding: 10px 12px;
    font-family: 'Outfit Regular', sans-serif;
    font-size: 15px;
    border: 1px solid #cfd3d8;
    border-radius: 6px;
    transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
}

.filter-input:focus {
    outline: none;
    border-color: var(--mm-green, #49B096);
    box-shadow: 0 0 0 3px rgba(73, 176, 150, 0.18);
}

.summary-line {
    font-family: 'Outfit Regular', sans-serif;
    font-size: 14px;
    color: var(--mm-black, #272323);
    opacity: 0.8;
    white-space: nowrap;
}

.summary-strong {
    font-family: 'Merge One', sans-serif;
    font-size: 15px;
    color: var(--mm-green, #49B096);
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
    color: var(--mm-black, #272323);
    opacity: 0.75;
    font-family: 'Outfit Regular', sans-serif;
}

.spinner {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 3px solid var(--mm-grey, rgba(39, 35, 35, 0.25));
    border-top-color: var(--mm-green, #49B096);
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
    color: #7f8791;
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
    max-height: 60vh;
    overflow-y: auto;
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
    color: var(--mm-black, #272323);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    transition:
        border-color 0.15s ease-in-out,
        box-shadow 0.15s ease-in-out,
        transform 0.05s ease-in-out;
}

.vendor-row-button:hover {
    border-color: var(--mm-green, #49B096);
    box-shadow: 0 2px 8px rgba(73, 176, 150, 0.18);
}

.vendor-row-button:active {
    transform: translateY(1px);
}

.vendor-row--active .vendor-row-button {
    border-color: var(--mm-green, #49B096);
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
    color: #7f8791;
    white-space: nowrap;
}

.vendors-actions {
    padding: 16px 24px;
    border-top: 1px solid #eceff1;
    display: flex;
    justify-content: flex-start;
}

.primary-button {
    background: var(--mm-green, #49B096);
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
    transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out;
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
    background: var(--mm-black, #272323);
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
    color: var(--mm-black, #272323);
    padding-bottom: 8px;
    border-bottom: 2px solid var(--mm-grey, rgba(39, 35, 35, 0.25));
}

.detail-grid {
    margin: 0;
    display: grid;
    grid-template-columns: minmax(120px, 0.6fr) 1fr;
    gap: 8px 16px;
    font-family: 'Outfit Regular', sans-serif;
    font-size: 14px;
    color: var(--mm-black, #272323);
}

.detail-grid dt {
    font-family: 'Merge One', sans-serif;
    font-size: 13px;
    color: var(--mm-black, #272323);
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
    color: #7f8791;
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
    border-left: 4px solid var(--mm-green, #49B096);
    border-radius: 8px;
    padding: 12px 14px;
    background: white;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.assignment-date {
    font-family: 'Merge One', sans-serif;
    font-size: 15px;
    color: var(--mm-green, #49B096);
    margin-bottom: 4px;
}

.assignment-detail {
    font-family: 'Outfit Regular', sans-serif;
    font-size: 14px;
    color: var(--mm-black, #272323);
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
