<script setup lang="ts">
/**
 * The door on market day (E29/F01): one market date at a time, every vendor the assignment places
 * that day, who has come and who has not - and, for an editor, a check-in of their own.
 *
 * It listed only the vendors who had checked in, by email, with a column per date someone did, so
 * on a day of 80 vendors the organizer at the door could not say who was missing (known gap 3).
 * The roster is served off the stored assignment, the same rows check-in records against.
 *
 * Laptop first, and it must work on a phone: the door is sometimes a person standing up.
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { api, getApiErrorMessage } from '@/utils/api';
import { MarketPhase } from '@/assets/types/datatypes';
import { getShortDate, getTimestampTime } from '@/utils/utils';
import { tableInWords } from '@/utils/placementChange';
import { vendorMatches, type VendorNames } from '@/utils/vendorIdentity';
import MarketFrame from '@/components/MarketFrame.vue';
import VendorIdentity from '@/components/VendorIdentity.vue';
import { useOpenMarket } from '@/utils/openMarket';

interface RosterRow {
  date: string;
  vendorEmail: string;
  vendorName: string;
  tableCode: string;
  tableChoice: string;
  section: string;
  location: string;
  checkedInAt: string | null;
  checkedInBy: string | null;
}

type Show = 'all' | 'not-yet' | 'here';

const route = useRoute();
const router = useRouter();

const marketId = computed(() => String(route.params.marketId ?? ''));
const { market } = useOpenMarket(marketId);

const dates = ref<string[]>([]);
const roster = ref<RosterRow[]>([]);
const errorMessage = ref('');
const isLoading = ref(false);
const show = ref<Show>('all');
const search = ref('');
/** The row whose write is in flight, so its button cannot be pressed twice. */
const busyRow = ref('');

function calendarToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * The date the page opens on: today when it is a market date, else the next one, else the last -
 * the door means today, and before the market the first day is the one being prepared for.
 */
const selectedDate = computed(() => {
  const asked = String(route.query.date ?? '');
  if (dates.value.includes(asked)) return asked;
  const today = calendarToday();
  return dates.value.find((d) => d >= today) ?? dates.value[dates.value.length - 1] ?? '';
});

function chooseDate(date: string) {
  void router.replace({ query: { ...route.query, date } });
}

const signedInAs = computed(() => {
  try {
    const parsed = JSON.parse(localStorage.getItem('user') || 'null') as unknown;
    return typeof parsed === 'string' ? parsed.toLowerCase() : '';
  } catch {
    return '';
  }
});

const names = computed<VendorNames>(() => {
  const out: Record<string, string> = {};
  for (const row of roster.value) if (row.vendorName) out[row.vendorEmail] = row.vendorName;
  return out;
});

/** An editor may check vendors in while the market is running; the server is the authority. */
const canCheckIn = computed(
  () => market.value?.phase === MarketPhase.MarketDays && !market.value?.readOnlyReason,
);

function tally(date: string) {
  const day = roster.value.filter((row) => row.date === date);
  return { expected: day.length, here: day.filter((row) => row.checkedInAt).length };
}

const today = computed(() => tally(selectedDate.value));

const shown = computed(() => {
  const term = search.value.trim();
  return roster.value.filter((row) => {
    if (row.date !== selectedDate.value) return false;
    if (show.value === 'not-yet' && row.checkedInAt) return false;
    if (show.value === 'here' && !row.checkedInAt) return false;
    if (!term) return true;
    if (row.tableCode.toLowerCase().includes(term.toLowerCase())) return true;
    return vendorMatches(term, row.vendorEmail, names.value);
  });
});

function status(row: RosterRow): string {
  if (!row.checkedInAt) return 'Not yet';
  const at = getTimestampTime(row.checkedInAt);
  if (!row.checkedInBy) return at;
  return `${at} by ${row.checkedInBy.toLowerCase() === signedInAs.value ? 'you' : row.checkedInBy}`;
}

function rowKey(row: RosterRow): string {
  return `${row.date}|${row.vendorEmail}`;
}

function whoFor(row: RosterRow): string {
  return row.vendorName || row.vendorEmail;
}

async function loadAttendance(): Promise<void> {
  errorMessage.value = '';
  if (!marketId.value) return;
  isLoading.value = roster.value.length === 0;
  try {
    const { data } = await api.get<{ dates: string[]; roster: RosterRow[] }>(
      `/markets/${encodeURIComponent(marketId.value)}/attendance`,
    );
    dates.value = data.dates ?? [];
    roster.value = data.roster ?? [];
  } catch (err: unknown) {
    errorMessage.value = getApiErrorMessage(err, 'Attendance could not be loaded.');
  } finally {
    isLoading.value = false;
  }
}

/** A write is followed by a re-read, never a patch: the roster says what the server holds. */
async function write(row: RosterRow, method: 'post' | 'delete') {
  busyRow.value = rowKey(row);
  errorMessage.value = '';
  const url = `/markets/${encodeURIComponent(marketId.value)}/attendance`;
  const body = { vendorEmail: row.vendorEmail, date: row.date };
  try {
    if (method === 'post') await api.post(url, body);
    else await api.delete(url, { data: body });
    await loadAttendance();
  } catch (err: unknown) {
    errorMessage.value = getApiErrorMessage(
      err,
      method === 'post' ? 'That check-in was not recorded.' : 'That check-in was not undone.',
    );
  } finally {
    busyRow.value = '';
  }
}

watch(marketId, loadAttendance, { immediate: true });
</script>

<template>
  <MarketFrame :market="market" @retry="loadAttendance">
    <div class="door">
      <p v-if="errorMessage" class="door-error" role="alert">{{ errorMessage }}</p>
      <p v-if="isLoading" class="door-note">Loading…</p>
      <p v-else-if="dates.length === 0" class="door-note">This market has no dates yet.</p>
      <template v-else>
        <nav class="door-dates" aria-label="Market date">
          <button
            v-for="date in dates"
            :key="date"
            type="button"
            class="btn btn--secondary btn--compact door-date"
            :aria-pressed="date === selectedDate"
            :data-testid="`attendance-date-${date}`"
            @click="chooseDate(date)"
          >
            {{ getShortDate(date) }}
            <span class="door-date-count">{{ tally(date).here }}/{{ tally(date).expected }}</span>
          </button>
        </nav>

        <div class="door-bar">
          <h2 class="door-summary" data-testid="attendance-summary">
            {{ today.here }} of {{ today.expected }} checked in
          </h2>
          <div class="door-show" role="group" aria-label="Show">
            <button
              type="button"
              class="btn btn--secondary btn--compact"
              :aria-pressed="show === 'all'"
              data-testid="attendance-show-all"
              @click="show = 'all'"
            >
              All {{ today.expected }}
            </button>
            <button
              type="button"
              class="btn btn--secondary btn--compact"
              :aria-pressed="show === 'not-yet'"
              data-testid="attendance-show-not-yet"
              @click="show = 'not-yet'"
            >
              Not yet {{ today.expected - today.here }}
            </button>
            <button
              type="button"
              class="btn btn--secondary btn--compact"
              :aria-pressed="show === 'here'"
              data-testid="attendance-show-here"
              @click="show = 'here'"
            >
              Checked in {{ today.here }}
            </button>
          </div>
          <input
            v-model="search"
            type="search"
            class="field door-search"
            aria-label="Find a vendor"
            placeholder="Name, email or table"
            data-testid="attendance-search"
          />
        </div>

        <p v-if="today.expected === 0" class="door-note">Nobody is placed on this date.</p>
        <p v-else-if="shown.length === 0" class="door-note">Nobody here matches.</p>
        <ul v-else class="door-list">
          <li
            v-for="row in shown"
            :key="rowKey(row)"
            class="door-row"
            data-testid="attendance-row"
            :data-vendor="row.vendorEmail"
          >
            <span class="door-table">Table {{ tableInWords(row.tableCode, row.tableChoice) }}</span>
            <VendorIdentity class="door-who" :email="row.vendorEmail" :names="names" />
            <span
              class="chip door-status"
              :class="row.checkedInAt ? 'chip--positive' : 'chip--attention'"
              data-testid="attendance-row-status"
              >{{ status(row) }}</span
            >
            <span v-if="canCheckIn" class="door-action">
              <button
                v-if="!row.checkedInAt"
                type="button"
                class="btn btn--primary btn--compact"
                :disabled="busyRow === rowKey(row)"
                :aria-label="`Check in ${whoFor(row)}`"
                data-testid="attendance-check-in"
                @click="write(row, 'post')"
              >
                Check in
              </button>
              <button
                v-else
                type="button"
                class="btn btn--secondary btn--compact"
                :disabled="busyRow === rowKey(row)"
                :aria-label="`Undo ${whoFor(row)}'s check-in`"
                data-testid="attendance-undo"
                @click="write(row, 'delete')"
              >
                Undo
              </button>
            </span>
          </li>
        </ul>
      </template>
    </div>
  </MarketFrame>
</template>

<style scoped>
.door {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6);
  color: var(--mm-black);
}

.door-dates,
.door-show {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.door-date-count {
  /* Figures in a column need fixed-width digits (E15/F01/S03). The button's own ink, not muted:
     muted grey is 4.26 on the chosen date's green ground, below AA. */
  font-variant-numeric: tabular-nums;
}

.door-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3) var(--space-4);
}

.door-summary {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.door-search {
  flex: 1 1 240px;
  min-width: 0;
}

.door-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.door-row {
  display: grid;
  grid-template-columns: minmax(0, 14rem) minmax(0, 1fr) auto 7rem;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
}

.door-table {
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.door-who {
  min-width: 0;
}

.door-status {
  justify-self: start;
  white-space: nowrap;
}

.door-action {
  justify-self: end;
}

.door-note {
  margin: 0;
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.door-error {
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-sm);
}

/* A phone at the door: the vendor on top, where they sit and whether they came beneath, and the
   button within a thumb's reach on the right. */
@media (width <= 640px) {
  .door {
    padding: var(--space-4) 0;
  }

  .door-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'who action'
      'table status';
    gap: var(--space-2) var(--space-3);
  }

  .door-who {
    grid-area: who;
  }

  .door-table {
    grid-area: table;
  }

  .door-status {
    grid-area: status;
    justify-self: end;
  }

  .door-action {
    grid-area: action;
  }
}
</style>
