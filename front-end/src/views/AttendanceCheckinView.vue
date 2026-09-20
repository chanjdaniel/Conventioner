<script setup lang="ts">
/**
 * The vendor-facing check-in page: the one surface a stranger meets, used one-handed at a door.
 *
 * Three things it did not do. It did not name the market until after a lookup, so a vendor handed
 * a QR code had to type their address to find out whether they were in the right place. It offered
 * an identical "Check in" button for every market date with nothing marking today, so on a two-day
 * market one mis-tap recorded them present on a day they were not. And there was no undo.
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

import { api } from '@/utils/api';
import { getFormattedDate, getFormattedTimestamp } from '@/utils/utils';

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
  /** Empty for an application written before names existed; the page then shows the address. */
  vendorName: string;
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
const undoingDate = ref<string | null>(null);

/** Named from the slug alone, so the page says where the vendor is before they do anything. */
const marketName = ref('');

onMounted(async () => {
  if (!marketSlug.value) return;
  try {
    const resp = await api.get<{ marketName: string }>(
      `/public/markets/${encodeURIComponent(marketSlug.value)}/check-in`,
    );
    marketName.value = resp.data.marketName ?? '';
  } catch {
    // A market that does not answer is not worth an error here: the lookup below says so, in the
    // one message a vendor at a door can act on.
    marketName.value = '';
  }
});

/**
 * Today, as a calendar day in the reader's own timezone.
 *
 * A market date is a calendar day, and so is "today" for someone standing at the door - the
 * comparison has to be made in their day, not in UTC.
 *
 * A ref re-read on every lookup, not a computed: a computed with no reactive dependency is
 * evaluated once and cached for the life of the page, and this page is the one that sits open on
 * a phone at a door all day. Across midnight it would keep marking yesterday as today.
 */
function calendarToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const today = ref(calendarToday());

/** Is today one of the days this vendor is placed on? Decides whether anything is primary. */
const todayIsAMarketDay = computed(() =>
  (summary.value?.assignments ?? []).some((row) => row.date === today.value),
);

function formatDate(d: string): string {
  return getFormattedDate(d) ?? d;
}

function formatTimestamp(iso: string | null): string {
  return getFormattedTimestamp(iso);
}

async function fetchSummary(): Promise<void> {
  lookupError.value = '';
  checkinError.value = '';
  today.value = calendarToday();
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
    const status =
      err && typeof err === 'object' && 'response' in err
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
    await api.post(`/public/markets/${encodeURIComponent(marketSlug.value)}/attendance/checkin`, {
      vendorEmail: summary.value.vendorEmail,
      date,
    });
    await fetchSummary();
  } catch (err: unknown) {
    const data =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data
        : undefined;
    checkinError.value = data?.error || 'Failed to check in. Please try again.';
  } finally {
    checkingInDate.value = null;
  }
}

async function undoCheckIn(date: string): Promise<void> {
  if (!summary.value) return;
  checkinError.value = '';
  undoingDate.value = date;
  try {
    await api.delete(`/public/markets/${encodeURIComponent(marketSlug.value)}/attendance/checkin`, {
      data: { vendorEmail: summary.value.vendorEmail, date },
    });
    await fetchSummary();
  } catch (err: unknown) {
    const data =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data
        : undefined;
    checkinError.value = data?.error || 'Failed to undo the check-in. Please try again.';
  } finally {
    undoingDate.value = null;
  }
}
</script>

<template>
  <div class="attendance-view">
    <div class="attendance-card" data-testid="attendance-checkin-card">
      <header class="attendance-header">
        <p class="attendance-eyebrow">Vendor check-in</p>
        <h1 data-testid="attendance-checkin-market-name">
          {{ marketName || summary?.marketName || 'Vendor Check-in' }}
        </h1>
      </header>
      <div class="attendance-body">
        <form class="lookup-form" @submit.prevent="fetchSummary">
          <label for="vendor-email">Your email</label>
          <p class="field-help">Use the address you applied with.</p>
          <div class="lookup-row">
            <input
              id="vendor-email"
              v-model="email"
              type="email"
              placeholder="you@example.com"
              autocomplete="email"
              data-testid="attendance-checkin-email-input"
            />
            <!-- Primary until it has been used, then secondary: once a result is on screen the
                 action that matters is checking in, and a spent control should not go on wearing
                 the only green on a page someone is holding at a door (E15/F02/S04). -->
            <button
              type="submit"
              :class="summary ? 'secondary-button' : 'primary-button'"
              :disabled="isLoading"
              data-testid="attendance-checkin-lookup-button"
            >
              {{ isLoading ? 'Looking up…' : 'Look up' }}
            </button>
          </div>
          <p v-if="lookupError" class="error-text">{{ lookupError }}</p>
        </form>

        <div v-if="summary" class="assignments-list">
          <!-- Who the product thinks looked themselves up. The address is always shown beside the
               name: it is what this lookup matched on, and it is how a vendor spots that they
               typed someone else's. -->
          <p class="looked-up-as" data-testid="attendance-checkin-vendor">
            <strong>{{ summary.vendorName || summary.vendorEmail }}</strong>
            <span v-if="summary.vendorName" class="looked-up-email">{{ summary.vendorEmail }}</span>
          </p>
          <p v-if="checkinError" class="error-text">{{ checkinError }}</p>
          <!-- Today is the one a vendor at the door means. It is not merely styled differently:
               every other day's button is secondary, so a mis-tap takes a deliberate press on a
               control that does not look like the primary one. -->
          <p v-if="!todayIsAMarketDay" class="not-today-note" data-testid="attendance-not-today">
            Today is not one of your days at this market. You can still check in for a day below.
          </p>
          <article
            v-for="row in summary.assignments"
            :key="row.date + row.tableCode"
            class="assignment-card"
            :class="{ 'assignment-card--today': row.date === today }"
            :data-testid="
              row.date === today ? 'attendance-today-card' : 'attendance-other-day-card'
            "
          >
            <div class="assignment-date">
              <span>{{ formatDate(row.date) }}</span>
              <span v-if="row.date === today" class="today-pill">Today</span>
            </div>
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
                :class="row.date === today ? 'primary-button' : 'secondary-button'"
                :disabled="checkingInDate === row.date"
                @click="checkIn(row.date)"
                data-testid="attendance-checkin-checkin-button"
              >
                {{ checkingInDate === row.date ? 'Checking in…' : 'Check in' }}
              </button>
              <template v-else>
                <span class="checked-in-pill" data-testid="attendance-checkin-confirmation-pill">
                  Checked in &#10003; {{ formatTimestamp(row.checkedInAt) }}
                </span>
                <!-- A mis-tap on a two-day market recorded a vendor present on a day they were
                     not, and there was no way back. -->
                <button
                  type="button"
                  class="undo-button"
                  :disabled="undoingDate === row.date"
                  @click="undoCheckIn(row.date)"
                  data-testid="attendance-checkin-undo-button"
                >
                  {{ undoingDate === row.date ? 'Undoing…' : 'Undo' }}
                </button>
              </template>
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
  /* Sized from the flex parent, not the viewport: `.router-view` is already flex:1 inside a 100vh
     column, so `min-height: 100vh` here double-counted the 5vh banner and left a page holding
     350px of content scrolling 54px on every load (E14/F02/S01). The same bug was fixed in
     `VendorsView.vue`, which carries the same note; this view was missed at the time. */
  height: 100%;
  min-height: 0;
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
  background-color: var(--mm-black);
  padding: 18px 24px;
}

.attendance-eyebrow {
  margin: 0 0 2px;
  color: var(--mm-text-muted-on-dark);
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  text-align: center;
}

.attendance-header h1 {
  margin: 0;
  color: white;
  font-size: var(--text-xl);
  text-align: center;
  overflow-wrap: anywhere;
}

.field-help {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.not-today-note {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-yellow);
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
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.lookup-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.lookup-row input {
  flex: 1;
  min-width: 200px;
  /* Matches `.primary-button` beside it. Left to its padding and line box the field came out 42px
     against the button's 40, so the button's bottom edge sat 2px proud of the field's own
     (E15/F01/S03). */
  height: 40px;
  padding: 0 12px;
  font-size: var(--text-md);
  border: 1px solid #cfd3d8;
  border-radius: 6px;
}

.primary-button {
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: 5px;
  padding: 0 16px;
  height: 40px;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-md);
  cursor: pointer;
  transition: opacity 0.15s ease-in-out;
}

.primary-button:hover:not(:disabled) {
  opacity: 0.9;
}

.primary-button:disabled,
.secondary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Every day that is not today. Reachable, but it does not look like the thing to press. */
.secondary-button {
  background: white;
  color: var(--mm-black);
  border: 1px solid var(--mm-border);
  border-radius: 5px;
  padding: 0 16px;
  height: 40px;
  font-size: var(--text-sm);
  cursor: pointer;
}

.secondary-button:hover:not(:disabled) {
  border-color: var(--mm-black);
}

.undo-button {
  background: none;
  border: none;
  padding: 6px 8px;
  font-size: var(--text-sm);
  color: var(--mm-text-link);
  text-decoration: underline;
  cursor: pointer;
}

.error-text {
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-sm);
}

.assignments-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.looked-up-as {
  margin: 0;
  display: flex;
  flex-direction: column;
  font-size: var(--text-md);
  color: var(--mm-black);
}

.looked-up-email {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.assignment-card {
  border: 1px solid #e1e4e8;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: var(--shadow-card);
}

.assignment-card--today {
  border-color: var(--mm-green);
  border-width: 2px;
  box-shadow: var(--shadow-card);
}

.assignment-date {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  color: var(--mm-green);
}

.today-pill {
  background: var(--mm-green);
  color: white;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.assignment-meta {
  font-size: var(--text-sm);
  color: var(--mm-black);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 16px;
}

.assignment-action {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.checked-in-pill {
  background: #e7f5ee;
  color: #1e7a4f;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: var(--text-sm);
}

/* Check-in is laptop-primary, but it is the one surface a volunteer may hold at a door, so it has
   to work one-handed (E08/F03). Below this width the two-up detail grid and the input-beside-button
   row both stop fitting: the email truncates mid-address, which is the one field someone types. */
@media (max-width: 520px) {
  .attendance-view {
    padding: 12px;
  }

  .attendance-body {
    padding: 16px;
    gap: 16px;
  }

  .lookup-row {
    flex-direction: column;
    align-items: stretch;
  }

  .lookup-row input {
    min-width: 0;
    font-size: var(--text-md); /* iOS zooms the page in on a focused input below 16px. */
  }

  .lookup-row .primary-button,
  .assignment-action .primary-button,
  .assignment-action .secondary-button {
    width: 100%;
    min-height: 44px; /* A comfortable touch target. */
  }

  .assignment-action .undo-button {
    min-height: 44px;
    width: 100%;
  }

  .assignment-meta {
    grid-template-columns: 1fr;
  }

  .assignment-action {
    justify-content: stretch;
  }
}
</style>
