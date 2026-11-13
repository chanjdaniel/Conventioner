<script lang="ts">
/**
 * How often the roster reads itself again while the page is in view (T318): the door's question is
 * "who is here now", so more often than the review lists' half minute. At the real size, about 200
 * seats across a market's days, a read is about 55 KB.
 */
export const REREAD_MS = 15_000;
</script>

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
 *
 * In Market Days, whoever may check vendors in opens the door code here, full screen, for the
 * device that stands at the entrance or a printed poster (ADR 0022).
 *
 * The roster stays fresh by itself (T318): a vendor who scans themselves in, or a second
 * organizer's check-in, shows within `REREAD_MS` with no tap, and at once when the tab comes back
 * into view or the browser comes back online.
 *
 * Each row says where its vendor stands (T318), as the server serves it: expected, here, here at
 * another table than the one they hold now, or here with no table that day, listed under the
 * day's seats so a free never hides an arrival. The tally and the toggles count seats only, as the
 * Stats tab does. Check in is offered on today and past days, never on a day to come.
 *
 * A paper roster is the door's fallback when the venue's network or the back end fails (T318):
 * "Print roster" prints every vendor of the chosen date by table, whatever the filters on screen
 * say (`DoorRosterPrint`), and in Market Days a note asks for it on each day still to be run.
 */
import { MarketAction, mayTake } from '@/utils/marketActions';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { api, getApiErrorMessage } from '@/utils/api';
import { MarketPhase } from '@/assets/types/datatypes';
import { getShortDate, getTimestampTime } from '@/utils/utils';
import { tableInWords } from '@/utils/placementChange';
import { vendorMatches, type VendorNames } from '@/utils/vendorIdentity';
import MarketFrame from '@/components/MarketFrame.vue';
import VendorDrawer from '@/components/VendorDrawer.vue';
import VendorNameButton from '@/components/VendorNameButton.vue';
import VendorNotes from '@/components/VendorNotes.vue';
import ListFreshness from '@/components/ListFreshness.vue';
import ReadFailed from '@/components/ReadFailed.vue';
import DoorCodeScreen from '@/components/DoorCodeScreen.vue';
import DoorRosterPrint, { type PrintedRow } from '@/components/DoorRosterPrint.vue';
import { offersDoorCode } from '@/utils/doorCode';
import { useVendorDetails } from '@/utils/vendorDetails';
import { useVendorDrawer } from '@/utils/vendorDrawer';
import { useVendorNotes } from '@/utils/vendorNotes';
import { calendarToday } from '@/utils/marketGuide';
import { useOpenMarket } from '@/utils/openMarket';
import { signedInEmail } from '@/utils/signedIn';

/**
 * Where a vendor stands at the door on a date: a seat and no check-in (`expected`), a check-in made
 * at the seat they hold (`here`), one made at another table (`here_elsewhere`), or a check-in and no
 * seat that day (`here_without_seat`).
 */
type RosterState = 'expected' | 'here' | 'here_elsewhere' | 'here_without_seat';

interface RosterRow {
  date: string;
  vendorEmail: string;
  vendorName: string;
  /** The seat held that day; null on a `here_without_seat` row. */
  tableCode: string | null;
  tableChoice: string | null;
  section: string | null;
  location: string | null;
  state: RosterState;
  /** The table the check-in was made at, or null with none. */
  checkedInTableCode: string | null;
  checkedInAt: string | null;
  checkedInBy: string | null;
  /** How a vendor checked themselves in: `door_code`, on their vendor page (ADR 0022). */
  checkedInVia?: string | null;
}

type Show = 'all' | 'not-yet' | 'here';

const route = useRoute();
const router = useRouter();

const marketId = computed(() => String(route.params.marketId ?? ''));
const { market } = useOpenMarket(marketId);

const dates = ref<string[]>([]);
const roster = ref<RosterRow[]>([]);
const errorMessage = ref('');
/** The roster's first read that failed, which Try again reads once more (E38/F11/S01). */
const readError = ref('');
const isLoading = ref(false);
/** When the roster was last read from the server, in milliseconds, or null before the first. */
const readAt = ref<number | null>(null);
/** A Refresh in flight, so its button cannot be pressed twice. */
const refreshing = ref(false);
/** A read after the first that failed: the rows stay, and this says they are old. */
const refreshError = ref('');
const show = ref<Show>('all');
const search = ref('');
/**
 * The rows whose write is in flight, each held busy on its own, so a queue at the door moves: taps
 * on several rows all go through. Replaced on each change, so Vue sees it.
 */
const busyRows = ref<ReadonlySet<string>>(new Set());

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

const signedInAs = computed(() => (signedInEmail() ?? '').toLowerCase());

const names = computed<VendorNames>(() => {
  const out: Record<string, string> = {};
  for (const row of roster.value) if (row.vendorName) out[row.vendorEmail] = row.vendorName;
  return out;
});

/** Whoever the table lets check vendors in may, while the market is running; the server is the
 *  authority. */
const canCheckIn = computed(
  () =>
    market.value?.phase === MarketPhase.MarketDays && mayTake(market.value, MarketAction.CheckIn),
);

/** The door code's screen, offered on the same answer as a check-in. */
const offersTheDoorCode = computed(() => offersDoorCode(market.value));
const showingDoorCode = ref(false);

function hasSeat(row: RosterRow): boolean {
  return row.state !== 'here_without_seat';
}

/** A date's seats, and those checked in: a vendor here with no table that day is not counted. */
function tally(date: string) {
  const day = roster.value.filter((row) => row.date === date && hasSeat(row));
  return { expected: day.length, here: day.filter((row) => row.checkedInAt).length };
}

const today = computed(() => tally(selectedDate.value));

/**
 * Whether the chosen day is over: it has passed, or the market is archived. A vendor who never
 * checked in then did not come, and "Not yet" said otherwise of every one of them (E30/F01/S02).
 */
const dayIsOver = computed(
  () =>
    market.value?.phase === MarketPhase.Archived ||
    (!!selectedDate.value && selectedDate.value < calendarToday()),
);
const notHere = computed(() => (dayIsOver.value ? 'Did not come' : 'Not yet'));

/** Check in is offered on today and past days: a mis-tapped day to come is not an arrival. */
const checkInOpen = computed(() => !!selectedDate.value && selectedDate.value <= calendarToday());

const shownToday = computed(() => {
  const term = search.value.trim().toLowerCase();
  return roster.value.filter((row) => {
    if (row.date !== selectedDate.value) return false;
    if (show.value === 'not-yet' && row.checkedInAt) return false;
    if (show.value === 'here' && !row.checkedInAt) return false;
    if (!term) return true;
    if ((row.tableCode ?? '').toLowerCase().includes(term)) return true;
    return vendorMatches(term, row.vendorEmail, names.value);
  });
});
const shown = computed(() => shownToday.value.filter(hasSeat));
/** Checked in on the chosen date with no table that day, under the seats, by the same filters. */
const shownWithoutSeat = computed(() => shownToday.value.filter((row) => !hasSeat(row)));
const withoutSeatToday = computed(
  () => roster.value.filter((row) => row.date === selectedDate.value && !hasSeat(row)).length,
);
const unseatedHeading = computed(
  () => `Checked in, with no table on this date (${withoutSeatToday.value})`,
);

/** The seats, then who is here with none, under a heading of its own. */
const lists = computed(() =>
  [
    { key: 'seated', heading: '', rows: shown.value },
    { key: 'unseated', heading: unseatedHeading.value, rows: shownWithoutSeat.value },
  ].filter((list) => list.rows.length > 0),
);

/**
 * The chosen date's every row for the printed roster, whatever the Show toggle and the search say:
 * paper with a filter on would leave the door without the vendors it hid.
 */
function printedRow(row: RosterRow): PrintedRow {
  return {
    key: rowKey(row),
    email: row.vendorEmail,
    name: row.vendorName,
    table: whereTheySit(row),
    here: row.checkedInAt ? status(row) : null,
  };
}
const printedDay = computed(() => roster.value.filter((row) => row.date === selectedDate.value));
const printedSeated = computed(() => printedDay.value.filter(hasSeat).map(printedRow));
const printedUnseated = computed(() =>
  printedDay.value.filter((row) => !hasSeat(row)).map(printedRow),
);

/**
 * Asks for a printed roster in Market Days on each day still to be run: on a day that has passed,
 * or a market archived, paper is too late.
 */
const asksForPaper = computed(
  () =>
    market.value?.phase === MarketPhase.MarketDays &&
    !!selectedDate.value &&
    selectedDate.value >= calendarToday(),
);

function printRoster(): void {
  window.print();
}

function status(row: RosterRow): string {
  if (!row.checkedInAt) return notHere.value;
  const at = getTimestampTime(row.checkedInAt);
  const arrived = arrival(row, at);
  // Here, but at a table they no longer hold: say which, so they are sent to their new one.
  if (row.state === 'here_elsewhere') return `${arrived}, at table ${row.checkedInTableCode}`;
  return arrived;
}

function arrival(row: RosterRow, at: string): string {
  // The vendor's own, with the door code they scanned or typed at the entrance.
  if (row.checkedInVia === 'door_code') return `Scanned in at ${at}`;
  if (!row.checkedInBy) return at;
  return `${at} by ${row.checkedInBy.toLowerCase() === signedInAs.value ? 'you' : row.checkedInBy}`;
}

/** Here at the seat they hold reads positive; anything else asks the door's attention. */
function statusTone(row: RosterRow): string {
  return row.state === 'here' ? 'chip--positive' : 'chip--attention';
}

function whereTheySit(row: RosterRow): string {
  return row.tableCode ? `Table ${tableInWords(row.tableCode, row.tableChoice ?? '')}` : 'No table';
}

function rowKey(row: RosterRow): string {
  return `${row.date}|${row.vendorEmail}`;
}

function whoFor(row: RosterRow): string {
  return row.vendorName || row.vendorEmail;
}

/**
 * One counter orders every read and write's answer. A read takes a number as it is asked, and its
 * answer lands only if nothing newer was asked or landed since: two reads in flight can answer in
 * either order, and the older landing last showed a vendor just checked in as not here.
 */
let asked = 0;
/** Reads in flight, so the clock never asks for a second while one is out. */
let reading = 0;
/** The page was left: nothing reads again, and nothing in flight lands. */
let left = false;
const COULD_NOT_UPDATE = 'Could not update. The roster is as it was last read.';

/**
 * Read the roster. Before the first read lands, a failure is the page that could not be read, with
 * Try again; after it, a failure keeps the rows and says they are old. A dropped answer changes
 * nothing on screen, its error included.
 */
async function read(): Promise<void> {
  if (!marketId.value || left) return;
  const mine = ++asked;
  const forMarket = marketId.value;
  reading += 1;
  isLoading.value = readAt.value === null && !readError.value;
  try {
    const { data } = await api.get<{ dates: string[]; roster: RosterRow[] }>(
      `/markets/${encodeURIComponent(forMarket)}/attendance`,
    );
    if (mine !== asked) return;
    dates.value = data.dates ?? [];
    roster.value = data.roster ?? [];
    readAt.value = Date.now();
    readError.value = '';
    refreshError.value = '';
  } catch (err: unknown) {
    if (mine !== asked) return;
    if (readAt.value === null) {
      readError.value = getApiErrorMessage(err, 'Attendance could not be loaded.');
    } else {
      refreshError.value = COULD_NOT_UPDATE;
    }
  } finally {
    reading -= 1;
    if (mine === asked) isLoading.value = false;
  }
}

/** Try again, after the first read failed: the page says it is loading again. */
function retry(): void {
  readError.value = '';
  void read();
}

/** Refresh, at once: a re-read, which keeps the rows if it fails. */
async function refresh(): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await read();
  } finally {
    refreshing.value = false;
  }
}

/** Another market's roster is never shown under this one's, nor its time or its failure. */
function openMarket(): void {
  dates.value = [];
  roster.value = [];
  readAt.value = null;
  readError.value = '';
  refreshError.value = '';
  errorMessage.value = '';
  busyRows.value = new Set();
  void read();
}

/**
 * Read again every `REREAD_MS` while the page is in view, and at once when it comes back into view
 * or the browser comes back online, so "who is missing" is true when it is asked. Hidden, it reads
 * nothing: a phone in a pocket spends no battery or data on it.
 */
let rereading: ReturnType<typeof setInterval> | null = null;
function tick(): void {
  if (document.visibilityState === 'visible' && reading === 0) void read();
}
function backInView(): void {
  if (document.visibilityState === 'visible') void read();
}
onMounted(() => {
  rereading = setInterval(tick, REREAD_MS);
  document.addEventListener('visibilitychange', backInView);
  window.addEventListener('online', backInView);
});
onUnmounted(() => {
  if (rereading) clearInterval(rereading);
  document.removeEventListener('visibilitychange', backInView);
  window.removeEventListener('online', backInView);
  left = true;
  asked += 1;
});

function holdBusy(key: string, busy: boolean): void {
  const rows = new Set(busyRows.value);
  if (busy) rows.add(key);
  else rows.delete(key);
  busyRows.value = rows;
}

/**
 * The row shows the server's answer at once, and a re-read follows: a slow re-read never leaves
 * the organizer wondering whether it worked. The answer counts as newer than every read in flight,
 * so none of them, asked before it, undoes it. A check-in is here at the seat the row holds; an
 * undo leaves a seat expected, and a row with no seat has nothing left to show.
 */
async function write(row: RosterRow, method: 'post' | 'delete') {
  const key = rowKey(row);
  holdBusy(key, true);
  errorMessage.value = '';
  const forMarket = marketId.value;
  const url = `/markets/${encodeURIComponent(forMarket)}/attendance`;
  const body = { vendorEmail: row.vendorEmail, date: row.date };
  try {
    let arrived: Pick<
      RosterRow,
      'state' | 'checkedInTableCode' | 'checkedInAt' | 'checkedInBy' | 'checkedInVia'
    >;
    if (method === 'post') {
      const { data } = await api.post<{ checkedInAt: string }>(url, body);
      arrived = {
        state: 'here',
        checkedInTableCode: row.tableCode,
        checkedInAt: data.checkedInAt,
        checkedInBy: signedInEmail(),
        checkedInVia: null,
      };
    } else {
      await api.delete(url, { data: body });
      arrived = {
        state: 'expected',
        checkedInTableCode: null,
        checkedInAt: null,
        checkedInBy: null,
        checkedInVia: null,
      };
    }
    if (forMarket !== marketId.value) return;
    asked += 1;
    roster.value = roster.value.flatMap((one) => {
      if (rowKey(one) !== key) return [one];
      if (!hasSeat(one) && method === 'delete') return [];
      return [{ ...one, ...arrived }];
    });
    void read();
  } catch (err: unknown) {
    errorMessage.value = getApiErrorMessage(
      err,
      method === 'post' ? 'That check-in was not recorded.' : 'That check-in was not undone.',
    );
  } finally {
    holdBusy(key, false);
  }
}

/** What each vendor asked for and what the organizers noted, for the door (E31/F04/S04). */
const { load: loadNotes, entryFor } = useVendorNotes(marketId);
/** Whoever the table lets write notes writes them; anyone with a role reads them. */
const canWriteNotes = computed(() => mayTake(market.value, MarketAction.WriteVendorNotes));

/**
 * A vendor's name opens their drawer (E35/F01/S02): who they are, what they asked for, where else
 * they sit. It never checks anyone in. A row shows notes only once there are some, so a first note
 * is written there, and the row reads it back when the drawer says one changed.
 */
const details = useVendorDetails(marketId, market);
const drawer = useVendorDrawer();

watch(marketId, openMarket, { immediate: true });
</script>

<template>
  <MarketFrame :market="market" @retry="retry">
    <div class="door">
      <ReadFailed v-if="readError" name="attendance" :message="readError" @retry="retry" />
      <p v-if="errorMessage" class="door-error" role="alert">{{ errorMessage }}</p>
      <p v-if="isLoading" class="door-note">Loading…</p>
      <!-- Said of a roster that was read: under a failed read there is nothing to say it of. -->
      <p v-else-if="dates.length === 0 && !readError" class="door-note">
        This market has no dates yet.
      </p>
      <template v-else-if="dates.length">
        <div class="door-top">
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
          <!-- When the roster was read, then Print roster and the door code: together at the row's
               end, or the end of a line of their own when the dates fill theirs. -->
          <div class="door-tools">
            <ListFreshness
              class="door-freshness"
              testid="attendance"
              :readAt="readAt"
              :refreshing="refreshing"
              :failed="refreshError"
              @refresh="refresh"
            />
            <span class="door-papers">
              <button
                type="button"
                class="btn btn--secondary btn--compact"
                data-testid="attendance-print"
                @click="printRoster"
              >
                Print roster
              </button>
              <button
                v-if="offersTheDoorCode"
                type="button"
                class="btn btn--secondary btn--compact"
                data-testid="attendance-door-code"
                @click="showingDoorCode = true"
              >
                Door code
              </button>
            </span>
          </div>
        </div>

        <p v-if="asksForPaper" class="note" data-testid="attendance-print-note">
          If the venue's network fails, a printed roster still works. Print this day's roster before
          the doors open.
        </p>

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
              {{ notHere }} {{ today.expected - today.here }}
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
            name="attendance-search"
            class="field door-search"
            aria-label="Find a vendor"
            placeholder="Name, email or table"
            data-testid="attendance-search"
          />
        </div>

        <p v-if="today.expected === 0 && withoutSeatToday === 0" class="door-note">
          Nobody is assigned on this date.
        </p>
        <p v-else-if="lists.length === 0" class="door-note">Nobody here matches.</p>
        <template v-for="list in lists" :key="list.key">
          <h3 v-if="list.heading" class="door-heading" data-testid="attendance-unseated-heading">
            {{ list.heading }}
          </h3>
          <ul class="door-list" :data-testid="`attendance-list-${list.key}`">
            <li
              v-for="row in list.rows"
              :key="rowKey(row)"
              class="door-row"
              :class="{ 'door-row--read': !canCheckIn }"
              data-testid="attendance-row"
              :data-vendor="row.vendorEmail"
            >
              <VendorNameButton
                class="door-who"
                :email="row.vendorEmail"
                :names="names"
                testid="attendance-vendor"
                @open="drawer.open(row.vendorEmail)"
              />
              <!-- Where they sit and whether they came, one line under the vendor's on a phone, so
                   neither widens the column the action stands in (E38/F15/S04). -->
              <span class="door-place">
                <span class="door-table" data-testid="attendance-row-table">{{
                  whereTheySit(row)
                }}</span>
                <span
                  class="chip door-status"
                  :class="statusTone(row)"
                  data-testid="attendance-row-status"
                  >{{ status(row) }}</span
                >
              </span>
              <span v-if="canCheckIn" class="door-action">
                <button
                  v-if="!row.checkedInAt && checkInOpen"
                  type="button"
                  class="btn btn--primary btn--compact"
                  :disabled="busyRows.has(rowKey(row))"
                  :aria-label="`Check in ${whoFor(row)}`"
                  data-testid="attendance-check-in"
                  @click="write(row, 'post')"
                >
                  Check in
                </button>
                <button
                  v-else-if="row.checkedInAt"
                  type="button"
                  class="btn btn--secondary btn--compact"
                  :disabled="busyRows.has(rowKey(row))"
                  :aria-label="`Undo ${whoFor(row)}'s check-in`"
                  data-testid="attendance-undo"
                  @click="write(row, 'delete')"
                >
                  Undo
                </button>
              </span>
              <VendorNotes
                class="door-notes"
                :marketId="marketId"
                :email="row.vendorEmail"
                :entry="entryFor(row.vendorEmail)"
                :canWrite="canWriteNotes"
                onlyWhenNoted
                :testid="`attendance-notes-${row.vendorEmail}`"
                @changed="loadNotes"
              />
            </li>
          </ul>
        </template>
      </template>
    </div>
    <VendorDrawer
      :market="market"
      :details="details"
      :email="drawer.email.value"
      :tab="drawer.tab.value"
      @close="drawer.close()"
      @update:tab="drawer.setTab"
      @notesChanged="loadNotes"
    />
    <DoorRosterPrint
      v-if="dates.length && market"
      :marketName="market.name"
      :date="selectedDate"
      :expected="today.expected"
      :seated="printedSeated"
      :unseated="printedUnseated"
      :unseatedHeading="unseatedHeading"
    />
    <DoorCodeScreen
      v-if="showingDoorCode && market"
      :marketId="marketId"
      :marketName="market.name"
      @close="showingDoorCode = false"
    />
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

.door-top {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
}

/* At the row's end, and at the end of its own line when the dates fill theirs. */
.door-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-inline-start: auto;
}

/* The time, Refresh and a failed read's line are the group's own items, so that line goes under
   the row, whole, rather than between Refresh and the buttons after it, where on a phone it pushed
   Door code onto a line of its own. */
.door-freshness {
  display: contents;
}

.door-freshness :deep(.freshness-error) {
  flex-basis: 100%;
  order: 1;
  text-align: end;
}

/* Print roster and Door code, a step apart from Refresh, which belongs to the time before it. They
   wrap as one: on a phone Door code went to a line alone under Print roster. */
.door-papers {
  display: flex;
  gap: var(--space-2);
  margin-inline-start: var(--space-2);
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

.door-heading {
  margin: var(--space-2) 0 0;
  font-size: var(--text-md);
  font-weight: 600;
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

/* Someone offered no check-in has no action column, so their status ends the row: an empty 7rem
   left each chip standing short of the edge with nothing beside it (E38/F15/S04). */
.door-row--read {
  grid-template-columns: minmax(0, 14rem) minmax(0, 1fr) auto;
}

/* Under the row, the width of it: notes are read standing at the door, not squeezed into a cell. */
.door-notes {
  grid-column: 1 / -1;
  grid-row: 2;
}

/* At a desk the table and the status are cells of the row, the table first: the vendor comes first
   in the markup, for a phone, so each cell is placed. */
.door-place {
  display: contents;
}

.door-table {
  grid-column: 1;
  grid-row: 1;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.door-who {
  grid-column: 2;
  grid-row: 1;
  justify-self: start;
  min-width: 0;
}

.door-status {
  grid-column: 3;
  grid-row: 1;
  justify-self: start;
  white-space: nowrap;
}

.door-action {
  grid-column: 4;
  grid-row: 1;
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
   button within a thumb's reach on the right. Where they sit and whether they came share a line of
   their own, the status at its end, or under it when both do not fit: in the action's column a wide
   status ("9:44 AM by ...") squeezed the vendor's line and broke the address mid-word. The gutter
   narrows but stays on both sides: without it the rows ran to the card's edges. */
@media (width <= 640px) {
  .door {
    padding: var(--space-4);
  }

  .door-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'who action'
      'place place'
      'notes notes';
    gap: var(--space-2) var(--space-3);
  }

  /* Nothing beside the vendor, so their line is the row's width. */
  .door-row--read {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'who'
      'place'
      'notes';
  }

  .door-who {
    grid-area: who;
  }

  .door-place {
    grid-area: place;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }

  .door-table {
    min-width: 0;
  }

  .door-status {
    margin-inline-start: auto;
  }

  .door-action {
    grid-area: action;
  }

  .door-notes {
    grid-area: notes;
  }
}
</style>
