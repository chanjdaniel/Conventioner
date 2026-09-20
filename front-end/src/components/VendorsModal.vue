<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue';
import {
  type Application,
  type Market,
  type VendorAssignmentResult,
  type MarketDateObject,
} from '@/assets/types/datatypes';
import IconCloseRound from '@/components/icons/IconCloseRound.vue';
import { fetchMarketApplications } from '@/utils/applicantApi';
import { ESSENTIAL_KEY_PREFIX, FULL_NAME_KEY } from '@/utils/essentialFields';
import { getShortDate } from '@/utils/utils';
import { useModalRoot } from '@/utils/useModalRoot';

const props = defineProps<{
  open: boolean;
  market: Market | null;
}>();

/** Modal: the page behind it goes out of the tab order, not just out of reach of the mouse. */
const modalRoot = useModalRoot(() => props.open);

const emit = defineEmits<{
  close: [];
}>();

const loadError = ref<string | null>(null);
const applications = ref<Application[] | null>(null);

function assignmentHeaderLabel(marketDate: MarketDateObject): string {
  if (!marketDate.date) return 'Assignment';
  return `${getShortDate(marketDate.date)} assignment`;
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

async function loadVendors() {
  loadError.value = null;
  applications.value = null;
  const market = props.market;
  if (!market?.id) {
    loadError.value = 'No market loaded.';
    return;
  }

  try {
    const list = await fetchMarketApplications(market.id);
    if (Array.isArray(list) && list.length > 0) {
      applications.value = list;
      return;
    }
  } catch {
    loadError.value = 'Could not fetch this market&rsquo;s applications.';
    return;
  }

  loadError.value = 'No vendors have applied to this market yet.';
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      void loadVendors();
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

/**
 * The organizer's own questions, in form order. These were the included columns of an uploaded
 * spreadsheet; a vendor is an application now, so they come from the form that produced it.
 * Essential answers are left out: they restate the market plan rather than describing a vendor.
 */
const customFields = computed(() =>
  (props.market?.applicationForm?.fields ?? [])
    .filter((field) => !field.key.startsWith(ESSENTIAL_KEY_PREFIX))
    .slice()
    .sort((a, b) => a.order - b.order),
);

const columnHeaders = computed(() => {
  const s = setup.value;
  if (!s) return [] as string[];
  // Name and address, the way the assignment CSV this mirrors is written. The name comes off the
  // application's own answer rather than a lookup, because this grid already holds them.
  const headers: string[] = ['Name', 'Email'];
  for (const field of customFields.value) {
    headers.push(field.label || field.key);
  }
  for (const md of s.marketDates ?? []) {
    headers.push(assignmentHeaderLabel(md));
  }
  headers.push('Cost (not set)');
  return headers;
});

const marketDates = computed(() => setup.value?.marketDates ?? []);

function answerText(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

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

const bodyRows = computed(() => {
  const list = applications.value;
  const s = setup.value;
  if (!list || list.length === 0 || !s) return [] as string[][];

  const assignMap = assignmentByEmailAndDate.value;

  return list.map((application) => {
    const emailRaw = (application.applicantEmail ?? '').trim();
    const answers = (application.formData ?? {}) as Record<string, unknown>;
    const name = String(answers[FULL_NAME_KEY] ?? '').trim();
    const cells: string[] = [name, emailRaw];

    for (const field of customFields.value) {
      cells.push(answerText(answers[field.key]));
    }

    const rowAssign = emailRaw ? assignMap.get(emailRaw.toLowerCase()) : undefined;
    for (const md of marketDates.value) {
      // A placement is dated by the market date itself; a spreadsheet column heading no longer
      // stands in for it, so there is no alias to resolve.
      cells.push(rowAssign?.get(md.date) ?? '');
    }

    cells.push('');
    return cells;
  });
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
      ref="modalRoot"
      class="vendors-modal-root"
      :class="{ 'vendors-modal-root--open': open }"
      :aria-hidden="!open"
    >
      <div class="vendors-modal-background" @click="handleBackdropClick" />
      <div
        class="vendors-modal-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vendors-modal-title"
        @click.stop
      >
        <div class="vendors-modal-header">
          <div class="vendors-modal-header-side vendors-modal-header-side--left">
            <button
              type="button"
              class="vendors-modal-close"
              aria-label="Close"
              @click="emit('close')"
            >
              <IconCloseRound class="vendors-modal-close-icon" />
            </button>
          </div>
          <h2 id="vendors-modal-title" class="vendors-modal-title">Vendors</h2>
          <div class="vendors-modal-header-side vendors-modal-header-side--right">
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
            <div class="vendors-modal-table-outer">
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
                <div class="vendors-modal-rows" data-testid="vendors-modal-rows">
                  <div
                    v-for="(row, ri) in bodyRows"
                    :key="'r-' + ri"
                    class="vendors-modal-data-row"
                    data-testid="vendors-modal-row"
                    :style="gridTemplate"
                  >
                    <div
                      v-for="(cell, ci) in row"
                      :key="'c-' + ri + '-' + ci"
                      class="vendors-modal-cell"
                      data-testid="vendors-modal-cell"
                    >
                      {{ cell }}
                    </div>
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
  transition:
    opacity 0.15s ease,
    visibility 0.15s ease;
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
  width: min(94vw, 1120px);
  max-height: min(88vh, 820px);
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.28);
  overflow: hidden;
  border: 1px solid rgba(39, 35, 35, 0.18);
}

/* Figma frame 29:1178: balanced header so "Vendors" stays visually centered */
.vendors-modal-header {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 10px 16px 12px;
  background-color: var(--mm-black);
  color: #fff;
}

.vendors-modal-header-side {
  display: flex;
  align-items: center;
  min-width: 0;
}

.vendors-modal-header-side--left {
  justify-content: flex-start;
}

.vendors-modal-header-side--right {
  justify-content: flex-end;
}

.vendors-modal-close {
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
  color: #fff;
  cursor: pointer;
}

.vendors-modal-close:hover {
  background: rgba(255, 255, 255, 0.1);
}

.vendors-modal-close-icon {
  width: 22px;
  height: 22px;
}

.vendors-modal-title {
  margin: 0;
  font-family: 'Merge One', 'Outfit', sans-serif;
  font-size: 22px;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: #fff;
  text-align: center;
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
  width: min(220px, 38vw);
  padding: 9px 38px 9px 16px;
  border: none;
  border-radius: 999px;
  background: #fff;
  font-family: inherit;
  font-size: 14px;
  color: var(--mm-black);
  cursor: default;
  outline: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.vendors-modal-search::placeholder {
  color: rgba(39, 35, 35, 0.45);
}

.vendors-modal-search-icon {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: rgba(39, 35, 35, 0.45);
  pointer-events: none;
}

.vendors-modal-body {
  flex: 1;
  min-height: 0;
  padding: 20px 22px 24px;
  background: #fff;
  overflow: auto;
}

.vendors-modal-error,
.vendors-modal-empty {
  margin: 0;
  color: #555;
  font-size: 15px;
}

/* Outer list container: thin border like Figma vendor list panel */
.vendors-modal-table-outer {
  border: 1px solid rgba(39, 35, 35, 0.14);
  border-radius: 12px;
  background: #fff;
  padding: 14px 14px 16px;
  overflow-x: auto;
}

.vendors-modal-table-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: min-content;
}

.vendors-modal-header-row {
  display: grid;
  gap: 0;
  border: 1px solid rgba(39, 35, 35, 0.12);
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}

.vendors-modal-rows {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.vendors-modal-data-row {
  display: grid;
  gap: 0;
  border: 1px solid rgba(39, 35, 35, 0.12);
  border-radius: 12px;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
}

.vendors-modal-cell {
  padding: 12px 14px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.45;
  color: var(--mm-black);
  border-right: 1px solid rgba(39, 35, 35, 0.1);
  min-width: 0;
  overflow-wrap: anywhere;
}

.vendors-modal-cell:last-child {
  border-right: none;
}

.vendors-modal-cell--header {
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.01em;
  color: rgba(39, 35, 35, 0.88);
  background: #fafaf9;
}
</style>
