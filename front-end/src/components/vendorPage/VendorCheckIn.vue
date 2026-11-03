<script setup lang="ts">
/**
 * The vendor's check-in, on their own page (ADR 0022).
 *
 * On a market day their seat today is on top with "Check in", and their other days below; once
 * checked in it says when, with "Undo" for a mis-tap. A check-in takes the market's door code: the
 * QR code at the entrance opens this page with it, and the page checks them in for today, after
 * signing them in when it has to; a vendor whose camera will not read it types the code here.
 * Once the market has ended the section is the record: each seat, and when they checked in.
 *
 * "Today" is the vendor's own calendar day, read again whenever the page comes back into view: a
 * phone left open at a door overnight must not keep marking yesterday.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useApplicationStore } from '@/stores/application';
import { calendarToday } from '@/utils/marketGuide';
import { seatLine } from '@/utils/applicantOutcome';
import { getFormattedDate, getTimestampTime } from '@/utils/utils';
import {
  checkInSection,
  normalizedDoorCode,
  scannedCodeRefusal,
  type CheckInSection,
} from '@/utils/vendorPage';
import type { ApplicantSeat } from '@/assets/types/datatypes';
import { tableInWords } from '@/utils/placementChange';

const props = defineProps<{ marketSlug: string }>();

const store = useApplicationStore();

const today = ref(calendarToday());
function readToday() {
  today.value = calendarToday();
}

const section = computed<CheckInSection>(() =>
  store.page
    ? checkInSection(store.page, store.application, today.value)
    : { mode: 'none', today: null, others: [] },
);

const typed = ref('');
const busy = ref(false);
const error = ref<string | null>(null);
/** What a scanned code came to when it checked nobody in: said once, above the section. */
const notice = ref<string | null>(null);

const typedIsWhole = computed(() => normalizedDoorCode(typed.value).length === 6);

async function checkIn(code: string, scanned: boolean) {
  const seat = section.value.today;
  if (!seat) return;
  busy.value = true;
  error.value = null;
  const result = await store.checkIn(seat.date, code);
  busy.value = false;
  if (result.ok) {
    typed.value = '';
    return;
  }
  // A sign-in that ran out takes the page back to the sign-in; a scanned code waits through it.
  if (result.signedOut && scanned) store.holdDoorCode(props.marketSlug, code);
  error.value = result.message;
}

async function checkInTyped() {
  readToday();
  if (!typedIsWhole.value || busy.value) return;
  await checkIn(typed.value, false);
}

async function undo() {
  const seat = section.value.today;
  if (!seat) return;
  busy.value = true;
  error.value = null;
  const result = await store.undoCheckIn(seat.date);
  busy.value = false;
  if (!result.ok) error.value = result.message;
}

/** A door code scanned at the entrance, used once, for today. */
async function useScannedCode() {
  // Signed out (a sign-in that ran out mid-check-in), the code waits for the next sign-in.
  if (!store.isAuthenticatedFor(props.marketSlug)) return;
  const code = store.takeDoorCode(props.marketSlug);
  if (!code || !store.page) return;
  readToday();
  notice.value = scannedCodeRefusal(store.page, store.application, today.value);
  if (notice.value || section.value.today?.checkedInAt) return;
  await checkIn(code, true);
}

watch(
  () => store.heldDoorCode,
  () => void useScannedCode(),
);

function onVisible() {
  if (document.visibilityState === 'visible') readToday();
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisible);
  void useScannedCode();
});
onUnmounted(() => document.removeEventListener('visibilitychange', onVisible));

function dayOf(seat: ApplicantSeat): string {
  return getFormattedDate(seat.date) ?? seat.date;
}

function tableOf(seat: ApplicantSeat): string {
  return [tableInWords(seat.tableCode, seat.tableChoice), seat.location].filter(Boolean).join(', ');
}
</script>

<template>
  <p v-if="notice" class="check-in-notice" role="status" data-testid="vendor-check-in-notice">
    {{ notice }}
  </p>

  <section
    v-if="section.mode === 'door'"
    class="check-in"
    aria-labelledby="vendor-check-in-title"
    data-testid="vendor-check-in"
  >
    <h2 id="vendor-check-in-title" class="check-in-title">Check-in</h2>

    <article v-if="section.today" class="seat seat--today" data-testid="vendor-check-in-today">
      <p class="seat-day"><span class="chip chip--informational">Today</span></p>
      <p class="seat-date">{{ dayOf(section.today) }}</p>
      <p class="seat-table">{{ tableOf(section.today) }}</p>

      <div v-if="section.today.checkedInAt" class="seat-done">
        <span class="chip chip--positive" data-testid="vendor-check-in-done">
          Checked in at {{ getTimestampTime(section.today.checkedInAt) }}
        </span>
        <button
          type="button"
          class="btn btn--secondary"
          :disabled="busy"
          data-testid="vendor-check-in-undo-btn"
          @click="undo"
        >
          {{ busy ? 'Undoing…' : 'Undo' }}
        </button>
      </div>

      <p v-else-if="busy && !typed" class="seat-busy" data-testid="vendor-check-in-busy">
        Checking you in…
      </p>

      <form
        v-else
        class="seat-form"
        data-testid="vendor-check-in-form"
        @submit.prevent="checkInTyped"
      >
        <div class="seat-field">
          <label class="field-label" for="vendor-check-in-code">Door code</label>
          <input
            id="vendor-check-in-code"
            v-model="typed"
            class="field"
            type="text"
            inputmode="text"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
            maxlength="9"
            placeholder="K7M 4QP"
            aria-describedby="vendor-check-in-code-help"
            data-testid="vendor-check-in-code-input"
          />
          <p id="vendor-check-in-code-help" class="seat-help">
            Type the code under the QR code at the door.
          </p>
        </div>
        <button
          type="submit"
          class="btn btn--primary"
          :disabled="busy || !typedIsWhole"
          data-testid="vendor-check-in-btn"
        >
          {{ busy ? 'Checking in…' : 'Check in' }}
        </button>
      </form>

      <p v-if="error" class="seat-error" role="alert" data-testid="vendor-check-in-error">
        {{ error }}
      </p>
    </article>

    <ul v-if="section.others.length" class="seat-list" data-testid="vendor-check-in-other-days">
      <li v-for="seat in section.others" :key="seat.date">
        {{ seatLine(seat) }}
        <span v-if="seat.checkedInAt" class="seat-when">
          (checked in at {{ getTimestampTime(seat.checkedInAt) }})
        </span>
      </li>
    </ul>
  </section>

  <section
    v-else-if="section.mode === 'record'"
    class="check-in"
    aria-labelledby="vendor-check-in-record-title"
    data-testid="vendor-check-in-record"
  >
    <h2 id="vendor-check-in-record-title" class="check-in-title">Where you sat</h2>
    <p class="check-in-ended">This market has ended.</p>
    <ul class="seat-list">
      <li
        v-for="seat in section.others"
        :key="seat.date"
        class="seat-record"
        data-testid="vendor-check-in-record-seat"
      >
        {{ seatLine(seat) }}
        <span class="seat-when">
          {{
            seat.checkedInAt
              ? `Checked in at ${getTimestampTime(seat.checkedInAt)}`
              : 'Not checked in'
          }}
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.check-in {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.check-in-title {
  font-family: 'Merge One';
  font-size: var(--text-lg);
  color: var(--mm-black);
  margin: 0;
}

/* Today's seat is the one a vendor at the door acts on, so it is the one in a card. */
.seat {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-6);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
}

.seat p {
  margin: 0;
}

.seat-date {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--mm-black);
}

.seat-table {
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.seat-done {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-2);
}

.seat-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-top: var(--space-2);
}

.seat-field {
  display: flex;
  flex-direction: column;
}

.seat-help {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.check-in-ended {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.seat-busy {
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.seat-error {
  font-size: var(--text-sm);
  color: var(--mm-red);
}

.seat-list {
  margin: 0;
  padding-left: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.seat-when {
  color: var(--mm-text-muted);
}

/* In the record, when they came sits on its own line under where they sat. */
.seat-record .seat-when {
  display: block;
}

/* Worded and drawn as the page's other notices. */
.check-in-notice {
  margin: 0;
  background: var(--mm-chip-informational);
  border: 1px solid var(--mm-blue);
  border-radius: var(--radius-control);
  padding: var(--space-4);
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--mm-blue);
}
</style>
