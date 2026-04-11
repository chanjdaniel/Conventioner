<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue';
import { type Market, type VendorAssignmentResult, type MarketDateObject } from '@/assets/types/datatypes';
import IconCloseRound from '@/components/icons/IconCloseRound.vue';
import { api } from '@/utils/api';

const props = defineProps<{
    open: boolean;
    market: Market | null;
}>();

const emit = defineEmits<{
    close: [];
}>();

const loadError = ref<string | null>(null);
const dataRows = ref<string[][] | null>(null);

function assignmentHeaderLabel(marketDate: MarketDateObject): string {
    const d = new Date(marketDate.date + 'T12:00:00');
    if (Number.isNaN(d.getTime())) {
        return 'Assignment';
    }
    const short = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${short} assignment`;
}

function normalizeVendorAssignment(raw: Record<string, unknown>): VendorAssignmentResult {
    return {
        email: String(raw.email ?? ''),
        date: String(raw.date ?? ''),
        tableCode: String(raw.tableCode ?? raw.table_code ?? ''),
        tableChoice: String(raw.tableChoice ?? raw.table_choice ?? ''),
        section: String(raw.section ?? ''),
        tier: String(raw.tier ?? ''),
        location: String(raw.location ?? ''),
    };
}

function parseUploadToGrid(uploadRaw: unknown): string[][] | null {
    if (!uploadRaw || typeof uploadRaw !== 'object') return null;
    const u = uploadRaw as { data?: { meta?: { fields?: string[] }; data?: Record<string, unknown>[] } };
    const fields = u.data?.meta?.fields;
    const rows = u.data?.data;
    if (!Array.isArray(fields) || fields.length === 0 || !Array.isArray(rows)) return null;
    const header = fields.map((f) => String(f));
    const body: string[][] = rows.map((obj) =>
        fields.map((f) => {
            const v = obj[f];
            return v == null ? '' : String(v);
        }),
    );
    return [header, ...body];
}

async function loadSourceData() {
    loadError.value = null;
    dataRows.value = null;
    const market = props.market;
    if (!market?.id) {
        loadError.value = 'No market loaded.';
        return;
    }

    const userEmail = JSON.parse(localStorage.getItem('user') || 'null');

    try {
        const res = await api.get(`/source-data/${encodeURIComponent(market.id)}`, {
            headers: { 'X-Owner-Email': userEmail },
        });
        const rows = res.data?.data;
        if (Array.isArray(rows) && rows.length > 0) {
            dataRows.value = rows.map((row: unknown) =>
                Array.isArray(row) ? row.map((c) => (c == null ? '' : String(c))) : [],
            );
            return;
        }
    } catch {
        // try localStorage upload
    }

    const uploadJson = localStorage.getItem('upload');
    if (uploadJson) {
        try {
            const parsed = JSON.parse(uploadJson) as unknown;
            const asArray = Array.isArray(parsed) ? parsed[0] : parsed;
            const grid = parseUploadToGrid(asArray);
            if (grid && grid.length > 1) {
                dataRows.value = grid;
                return;
            }
        } catch {
            loadError.value = 'Could not read vendor data.';
            return;
        }
    }

    loadError.value = 'No vendor source data found. Upload CSV when creating the market or ensure it is saved on the server.';
}

watch(
    () => props.open,
    (isOpen) => {
        if (isOpen) {
            void loadSourceData();
        }
    },
);

function handleBackdropClick() {
    emit('close');
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && props.open) {
        emit('close');
    }
}

watch(
    () => props.open,
    (isOpen) => {
        if (isOpen) {
            window.addEventListener('keydown', handleKeydown);
        } else {
            window.removeEventListener('keydown', handleKeydown);
        }
    },
);

onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown);
});

const setup = computed(() => props.market?.setupObject ?? null);

const includedIndices = computed(() => {
    const s = setup.value;
    if (!s?.colNames?.length) return [] as number[];
    const out: number[] = [];
    for (let i = 0; i < s.colNames.length; i++) {
        if (s.colInclude[i]) out.push(i);
    }
    return out;
});

const columnHeaders = computed(() => {
    const s = setup.value;
    if (!s) return [] as string[];
    const headers: string[] = [];
    for (const i of includedIndices.value) {
        headers.push(s.colNames[i] ?? '');
    }
    for (const md of s.marketDates ?? []) {
        headers.push(assignmentHeaderLabel(md));
    }
    headers.push('Cost');
    return headers;
});

const emailColIdx = computed(() => {
    const idx = setup.value?.assignmentOptions?.emailColNameIdx;
    return typeof idx === 'number' && idx >= 0 ? idx : null;
});

const marketDates = computed(() => setup.value?.marketDates ?? []);

const colNames = computed(() => setup.value?.colNames ?? []);

function vendorAssignmentsList(m: Market | null): unknown[] {
    if (!m?.assignmentObject) return [];
    const ao = m.assignmentObject as unknown as Record<string, unknown>;
    const list = ao.vendorAssignments ?? ao.vendor_assignments;
    return Array.isArray(list) ? list : [];
}

/** Map: email -> (dateColName -> assignment string) */
const assignmentByEmailAndDate = computed(() => {
    const map = new Map<string, Map<string, string>>();
    const raw = vendorAssignmentsList(props.market);
    if (raw.length === 0) return map;
    for (const item of raw) {
        const va = normalizeVendorAssignment(item as Record<string, unknown>);
        const email = va.email.trim().toLowerCase();
        if (!email) continue;
        const key = va.date;
        const display = `${va.tableCode} - ${va.tableChoice}`.trim();
        const line = display === '-' ? '' : display;
        if (!map.has(email)) map.set(email, new Map());
        map.get(email)!.set(key, line);
    }
    return map;
});

function dateKeyForMarketDate(md: MarketDateObject): string {
    const ext = md as MarketDateObject & { col_name?: string };
    if (ext.col_name) return ext.col_name;
    const names = colNames.value;
    const idx = md.colNameIdx ?? (md as { col_name_idx?: number }).col_name_idx;
    if (typeof idx === 'number' && idx >= 0 && idx < names.length) {
        return names[idx] ?? '';
    }
    return '';
}

const bodyRows = computed(() => {
    const rows = dataRows.value;
    const s = setup.value;
    if (!rows || rows.length < 2 || !s) return [] as string[][];

    const inc = includedIndices.value;
    const emailIdx = emailColIdx.value;
    const dates = marketDates.value;
    const assignMap = assignmentByEmailAndDate.value;

    const result: string[][] = [];
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const cells: string[] = [];

        for (const j of inc) {
            cells.push(j < row.length ? row[j] ?? '' : '');
        }

        const emailRaw = emailIdx != null && emailIdx < row.length ? String(row[emailIdx] ?? '').trim() : '';
        const emailLower = emailRaw.toLowerCase();
        const rowAssign = emailLower ? assignMap.get(emailLower) : undefined;

        for (const md of dates) {
            const dk = dateKeyForMarketDate(md);
            let cell = '';
            if (rowAssign && dk) {
                cell = rowAssign.get(dk) ?? '';
            }
            cells.push(cell);
        }

        cells.push('—');
        result.push(cells);
    }
    return result;
});

const gridTemplate = computed(() => {
    const n = columnHeaders.value.length;
    if (n === 0) return '';
    return `grid-template-columns: repeat(${n}, minmax(100px, 1fr));`;
});
</script>

<template>
    <Teleport to="body">
        <div
            class="vendors-modal-root"
            :class="{ 'vendors-modal-root--open': open }"
            aria-hidden="true"
        >
            <div class="vendors-modal-background" @click="handleBackdropClick" />
            <div class="vendors-modal-window" role="dialog" aria-modal="true" aria-labelledby="vendors-modal-title" @click.stop>
                <div class="vendors-modal-header">
                    <button type="button" class="vendors-modal-close" aria-label="Close" @click="emit('close')">
                        <IconCloseRound class="vendors-modal-close-icon" />
                    </button>
                    <h2 id="vendors-modal-title" class="vendors-modal-title">Vendors</h2>
                    <div class="vendors-modal-search-wrap">
                        <label class="vendors-modal-search-label">
                            <span class="vendors-modal-search-sr">Search</span>
                            <input
                                class="vendors-modal-search"
                                type="search"
                                readonly
                                tabindex="-1"
                                placeholder="Search"
                                aria-disabled="true"
                            />
                            <svg
                                class="vendors-modal-search-icon"
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                                aria-hidden="true"
                            >
                                <path
                                    d="M11 19a8 8 0 100-16 8 8 0 000 16zm9 2l-4-4"
                                    stroke="currentColor"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                />
                            </svg>
                        </label>
                    </div>
                </div>

                <div class="vendors-modal-body">
                    <p v-if="loadError" class="vendors-modal-error">{{ loadError }}</p>
                    <template v-else-if="columnHeaders.length > 0">
                        <div class="vendors-modal-table-wrap">
                            <div class="vendors-modal-header-row" :style="gridTemplate">
                                <div
                                    v-for="(h, i) in columnHeaders"
                                    :key="'h-' + i"
                                    class="vendors-modal-cell vendors-modal-cell--header"
                                >
                                    {{ h }}
                                </div>
                            </div>
                            <div class="vendors-modal-rows">
                                <div
                                    v-for="(row, ri) in bodyRows"
                                    :key="'r-' + ri"
                                    class="vendors-modal-data-row"
                                    :style="gridTemplate"
                                >
                                    <div
                                        v-for="(cell, ci) in row"
                                        :key="'c-' + ri + '-' + ci"
                                        class="vendors-modal-cell"
                                    >
                                        {{ cell }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </template>
                    <p v-else class="vendors-modal-empty">No columns configured for vendors.</p>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.vendors-modal-root {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    visibility: hidden;
    opacity: 0;
    transition: opacity 0.15s ease, visibility 0.15s ease;
}

.vendors-modal-root--open {
    pointer-events: auto;
    visibility: visible;
    opacity: 1;
}

.vendors-modal-background {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 0;
}

.vendors-modal-window {
    position: relative;
    z-index: 1;
    width: min(96vw, 1100px);
    max-height: min(85vh, 800px);
    display: flex;
    flex-direction: column;
    background: white;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
    overflow: hidden;
    border: 1px solid var(--mm-grey, #ccc);
}

.vendors-modal-header {
    position: relative;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    min-height: 52px;
    padding: 0 12px 0 8px;
    background-color: var(--mm-black);
    color: white;
}

.vendors-modal-close {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: white;
    cursor: pointer;
    z-index: 2;
}

.vendors-modal-close:hover {
    background: rgba(255, 255, 255, 0.12);
}

.vendors-modal-close-icon {
    width: 22px;
    height: 22px;
}

.vendors-modal-title {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    font-family: 'Merge One', sans-serif;
    font-size: 22px;
    font-weight: 400;
    color: white;
    pointer-events: none;
    z-index: 1;
}

.vendors-modal-search-wrap {
    margin-left: auto;
    z-index: 2;
}

.vendors-modal-search-label {
    position: relative;
    display: flex;
    align-items: center;
}

.vendors-modal-search-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
}

.vendors-modal-search {
    width: 200px;
    max-width: 36vw;
    padding: 8px 36px 8px 14px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 999px;
    background: white;
    font-size: 14px;
    color: var(--mm-black);
    cursor: default;
    outline: none;
}

.vendors-modal-search::placeholder {
    color: #888;
}

.vendors-modal-search-icon {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: #555;
    pointer-events: none;
}

.vendors-modal-body {
    flex: 1;
    min-height: 0;
    padding: 16px 18px 20px;
    background: white;
    overflow: auto;
}

.vendors-modal-error,
.vendors-modal-empty {
    margin: 0;
    color: #555;
    font-size: 15px;
}

.vendors-modal-table-wrap {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: min-content;
}

.vendors-modal-header-row {
    display: grid;
    gap: 0;
    border: 1px solid #d8d8d8;
    border-radius: 8px;
    background: #fafafa;
    overflow: hidden;
}

.vendors-modal-rows {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.vendors-modal-data-row {
    display: grid;
    gap: 0;
    border: 1px solid #d8d8d8;
    border-radius: 10px;
    background: white;
    overflow: hidden;
}

.vendors-modal-cell {
    padding: 10px 12px;
    font-size: 14px;
    color: var(--mm-black);
    border-right: 1px solid #e5e5e5;
    min-width: 0;
    overflow-wrap: anywhere;
}

.vendors-modal-cell:last-child {
    border-right: none;
}

.vendors-modal-cell--header {
    font-weight: 600;
    font-size: 13px;
    color: #333;
}
</style>
