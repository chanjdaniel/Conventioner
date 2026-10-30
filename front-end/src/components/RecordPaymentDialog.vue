<script setup lang="ts">
/**
 * Recording one payment a vendor made (E44/F01/S01): the amount, e-transfer or cash, the day it was
 * paid, and an optional note (Daniel, T92 Q15). Who recorded it and when the server keeps.
 *
 * The same fields record a refund once the money is given back, and edit an entry already there
 * (E44/F01/S02, an Admin's): Save is the confirmation, the dialog saying what it will do.
 */
import { computed, ref, watch } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import { getApiErrorMessage } from '@/utils/api';
import {
  PAYMENT_METHODS,
  editPayment,
  recordPayment,
  recordRefund,
  today,
  type NewPayment,
  type Payment,
  type PaymentMethod,
  type VendorAccount,
} from '@/utils/payments';
import { centsFromText, priceText } from '@/utils/pricing';

const props = defineProps<{
  open: boolean;
  marketId: string;
  email: string;
  /** The market's currency code, shown beside the amount; omitted on a market that prices nothing. */
  currency?: string | null;
  /** A payment, a refund, or the entry given in `entry`, edited. */
  mode?: 'payment' | 'refund' | 'edit';
  entry?: Payment | null;
}>();
const emit = defineEmits<{ close: []; saved: [account: VendorAccount] }>();

const amount = ref('');
const method = ref<PaymentMethod>('e-transfer');
const paidOn = ref(today());
const note = ref('');
const error = ref('');
const busy = ref(false);

const isRefund = computed(
  () => props.mode === 'refund' || (props.mode === 'edit' && props.entry?.kind === 'refund'),
);
const title = computed(() => {
  if (props.mode === 'edit') return isRefund.value ? 'Edit refund' : 'Edit payment';
  return isRefund.value ? 'Record refund' : 'Record payment';
});
const confirmLabel = computed(() => {
  if (busy.value) return props.mode === 'edit' ? 'Saving…' : 'Recording…';
  return props.mode === 'edit' ? 'Save' : title.value;
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const entry = props.mode === 'edit' ? props.entry : null;
    amount.value = entry ? priceText(Math.abs(entry.cents)) : '';
    method.value = entry?.method ?? 'e-transfer';
    paidOn.value = entry?.paidOn ?? today();
    note.value = entry?.note ?? '';
    error.value = '';
  },
  { immediate: true },
);

/** The amount as cents, once it is one: a payment is never nothing. */
const cents = computed(() => {
  const typed = centsFromText(amount.value);
  return typed ? typed : null;
});
const amountError = computed(() =>
  amount.value.trim() && cents.value === null ? 'Type an amount, such as 35 or 35.50.' : '',
);
const ready = computed(() => cents.value !== null && !!paidOn.value && !busy.value);

function send(fields: NewPayment): Promise<VendorAccount> {
  if (props.mode === 'edit' && props.entry) {
    return editPayment(props.marketId, props.entry.id, fields);
  }
  return isRefund.value
    ? recordRefund(props.marketId, props.email, fields)
    : recordPayment(props.marketId, props.email, fields);
}

async function save(): Promise<void> {
  if (!ready.value || cents.value === null) return;
  busy.value = true;
  error.value = '';
  try {
    emit(
      'saved',
      await send({
        cents: cents.value,
        method: method.value,
        paidOn: paidOn.value,
        note: note.value.trim(),
      }),
    );
  } catch (err: unknown) {
    error.value = getApiErrorMessage(
      err,
      props.mode === 'edit' ? 'The change could not be saved.' : 'It could not be recorded.',
    );
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog
    :open="open"
    :title="title"
    testid="record-payment"
    anchored
    :confirm-label="confirmLabel"
    :confirm-disabled="!ready"
    :error="error"
    @close="emit('close')"
    @submit="save"
  >
    <p v-if="isRefund && mode !== 'edit'" class="record-payment-intro">
      Record a refund once the money is given back: it comes off what they paid.
    </p>
    <div class="record-payment-fields">
      <label class="record-payment-field">
        <span class="field-label">Amount{{ currency ? ` (${currency})` : '' }}</span>
        <input
          id="record-payment-amount"
          v-model="amount"
          type="text"
          inputmode="decimal"
          class="field"
          autocomplete="off"
          :aria-invalid="!!amountError"
          :aria-describedby="amountError ? 'record-payment-amount-error' : undefined"
          data-testid="record-payment-amount"
        />
        <span
          v-if="amountError"
          id="record-payment-amount-error"
          class="record-payment-error"
          role="alert"
          data-testid="record-payment-amount-error"
          >{{ amountError }}</span
        >
      </label>

      <fieldset class="record-payment-field">
        <legend class="field-label">{{ isRefund ? 'Given back by' : 'Paid by' }}</legend>
        <div class="record-payment-methods">
          <label v-for="option in PAYMENT_METHODS" :key="option.id" class="record-payment-radio">
            <input
              v-model="method"
              type="radio"
              name="record-payment-method"
              :value="option.id"
              :data-testid="`record-payment-method-${option.id}`"
            />
            <span>{{ option.label }}</span>
          </label>
        </div>
      </fieldset>

      <label class="record-payment-field">
        <span class="field-label">{{ isRefund ? 'Given back on' : 'Paid on' }}</span>
        <input
          id="record-payment-date"
          v-model="paidOn"
          type="date"
          class="field"
          required
          data-testid="record-payment-date"
        />
      </label>

      <label class="record-payment-field">
        <span class="field-label">Note (optional)</span>
        <textarea
          id="record-payment-note"
          v-model="note"
          class="field field--textarea"
          rows="2"
          maxlength="500"
          data-testid="record-payment-note"
        />
      </label>
    </div>
  </AppDialog>
</template>

<style scoped>
.record-payment-intro {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.record-payment-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.record-payment-field {
  display: flex;
  flex-direction: column;
  border: none;
  padding: 0;
  margin: 0;
}

/* A legend's own inline padding would set "Paid by" apart from the labels above and below it. */
.record-payment-field legend {
  padding: 0;
}

.record-payment-methods {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-6);
}

.record-payment-radio {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--target-min);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.record-payment-error {
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: var(--mm-red);
}
</style>
