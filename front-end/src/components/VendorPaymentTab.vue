<script setup lang="ts">
/**
 * The drawer's Payment tab (E44/F01/S01): what one vendor owes for each table-day, the payments
 * recorded, and how the two compare, with both totals at its head.
 *
 * A line per table-day: its seat and what is owed for it, which the pricing calculates and which
 * follows the seat while nobody has set it by hand. A freed table keeps its line, marked, still
 * owed (Daniel, T92 Q26). "Record payment" is offered on the table's row for it; the organizers
 * alone read any of this, never the vendor (Q20.2).
 */
import { computed, ref, watch } from 'vue';
import RecordPaymentDialog from '@/components/RecordPaymentDialog.vue';
import { getFormattedTimestamp } from '@/utils/utils';
import { dateLabel } from '@/utils/vendorDetails';
import {
  balanceState,
  balanceText,
  loadAccount,
  methodLabel,
  money,
  seatText,
  type VendorAccount,
} from '@/utils/payments';

const props = defineProps<{
  marketId: string;
  email: string;
  /** Whether this person may record a payment: the table's "Record a payment" row. */
  canRecord: boolean;
}>();

const account = ref<VendorAccount | null>(null);
const isLoading = ref(false);
const loadError = ref('');
const recording = ref(false);

async function load(): Promise<void> {
  if (!props.marketId || !props.email) return;
  isLoading.value = true;
  loadError.value = '';
  try {
    account.value = await loadAccount(props.marketId, props.email);
  } catch {
    account.value = null;
    loadError.value = 'Their payments could not be loaded.';
  } finally {
    isLoading.value = false;
  }
}

watch(() => [props.marketId, props.email], load, { immediate: true });

function recorded(updated: VendorAccount): void {
  account.value = updated;
  recording.value = false;
}

const state = computed(() => (account.value ? balanceState(account.value) : 'settled'));
const CHIP = {
  owing: 'chip--attention',
  settled: 'chip--positive',
  overpaid: 'chip--informational',
};

/** What a line owes, as it reads: its amount, or that the market gives the seat no price. */
function owedText(cents: number | null): string {
  return cents == null || !account.value ? 'No price' : money(cents, account.value);
}

defineExpose({ reload: load });
</script>

<template>
  <section class="payment-tab" data-testid="payment-tab">
    <p v-if="isLoading && !account" class="payment-note">Loading…</p>
    <p v-else-if="loadError" class="payment-note">{{ loadError }}</p>

    <template v-else-if="account">
      <div class="payment-totals">
        <dl class="payment-figures">
          <div class="payment-figure">
            <dt>Owed</dt>
            <dd data-testid="payment-owed">{{ money(account.owedCents, account) }}</dd>
          </div>
          <div class="payment-figure">
            <dt>Paid</dt>
            <dd data-testid="payment-paid">{{ money(account.paidCents, account) }}</dd>
          </div>
        </dl>
        <span
          class="chip"
          :class="account.owedCents || account.paidCents ? CHIP[state] : 'chip--neutral'"
          :data-state="state"
          data-testid="payment-balance"
        >
          {{ balanceText(account) }}
        </span>
      </div>

      <div class="payment-group">
        <h3 class="payment-heading">Table-days</h3>
        <p v-if="account.lines.length === 0" class="payment-note">
          No table yet, so nothing is owed.
        </p>
        <ul v-else class="payment-list">
          <li
            v-for="line in account.lines"
            :key="line.date"
            class="payment-line"
            :class="{ 'payment-line--freed': line.freed }"
            :data-date="line.date"
            data-testid="payment-line"
          >
            <div class="payment-line-main">
              <span class="payment-line-date">{{ dateLabel(line.date) }}</span>
              <span class="payment-line-seat">{{ seatText(line) }}</span>
              <span v-if="line.freed" class="chip chip--neutral" data-testid="payment-line-freed">
                Table freed
              </span>
            </div>
            <span class="payment-amount" data-testid="payment-line-owed">
              {{ owedText(line.owedCents) }}
            </span>
          </li>
        </ul>
      </div>

      <div class="payment-group">
        <div class="payment-group-head">
          <h3 class="payment-heading">Payments</h3>
          <button
            v-if="canRecord"
            type="button"
            class="btn btn--secondary btn--compact"
            data-testid="payment-record"
            @click="recording = true"
          >
            Record payment
          </button>
        </div>
        <p v-if="account.payments.length === 0" class="payment-note">No payments recorded.</p>
        <ul v-else class="payment-list">
          <li
            v-for="payment in account.payments"
            :key="payment.id"
            class="payment-entry"
            data-testid="payment-entry"
          >
            <div class="payment-line-main">
              <span class="payment-entry-what">
                {{ methodLabel(payment.method) }}, paid {{ dateLabel(payment.paidOn) }}
              </span>
              <span v-if="payment.note" class="payment-entry-note">{{ payment.note }}</span>
              <span class="payment-entry-who" data-testid="payment-entry-who">
                Recorded by {{ payment.recordedBy }},
                <span class="payment-entry-when">{{
                  getFormattedTimestamp(payment.recordedAt) || payment.recordedAt
                }}</span>
              </span>
            </div>
            <span class="payment-amount">{{ money(payment.cents, account) }}</span>
          </li>
        </ul>
      </div>
    </template>

    <RecordPaymentDialog
      :open="recording"
      :marketId="marketId"
      :email="email"
      :currency="account?.currency"
      @close="recording = false"
      @saved="recorded"
    />
  </section>
</template>

<style scoped>
.payment-tab {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.payment-note {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

/* The two totals, and how they compare: what an organizer opens the tab to read. */
.payment-totals {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3) var(--space-4);
}

.payment-figures {
  display: flex;
  gap: var(--space-6);
  margin: 0;
}

.payment-figure dt {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.payment-figure dd {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  color: var(--mm-black);
}

.payment-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* The heading, with "Record payment" at its end, as the Submission's carries "Update info". */
.payment-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.payment-heading {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  color: var(--mm-green);
}

.payment-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.payment-line,
.payment-entry {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--mm-border);
}

.payment-line:last-child,
.payment-entry:last-child {
  border-bottom: none;
}

.payment-line-main {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-hairline);
  min-width: 0;
}

.payment-line-date,
.payment-entry-what {
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.payment-line-seat,
.payment-entry-who {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

/* "Oct 30, 2026 at 3:27 PM" holds together: "PM" alone on a line reads as a stray word. */
.payment-entry-when {
  white-space: nowrap;
}

.payment-entry-note {
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.payment-line-main .chip {
  margin-top: var(--space-1);
}

.payment-amount {
  flex-shrink: 0;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  color: var(--mm-black);
}

/* Still owed, so the amount stays as it was; only the seat reads as gone. */
.payment-line--freed .payment-line-seat {
  text-decoration: line-through;
}
</style>
