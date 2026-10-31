<script setup lang="ts">
/**
 * Changing what one table-day owes (E44/F01/S02, an Admin's by default): the pricing calculates it,
 * and an Admin may set it, $0 being how a fee is waived (Daniel, T92 Q26: "instead of a button to
 * waive, the admin will set amount owed to zero"). The dialog says the change before Save, which is
 * its confirmation.
 */
import { computed, ref, watch } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import { getApiErrorMessage } from '@/utils/api';
import { money, setAmountOwed, type PaymentLine, type VendorAccount } from '@/utils/payments';
import { centsFromText, priceText } from '@/utils/pricing';
import { dateLabel } from '@/utils/vendorDetails';

const props = defineProps<{
  open: boolean;
  marketId: string;
  email: string;
  line: PaymentLine | null;
  currency: string | null;
}>();
const emit = defineEmits<{ close: []; saved: [account: VendorAccount] }>();

const amount = ref('');
const error = ref('');
const busy = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    amount.value = priceText(props.line?.owedCents ?? 0) || '0';
    error.value = '';
  },
  { immediate: true },
);

/** The amount as cents, $0 included; null while the text is no amount. */
const cents = computed(() => centsFromText(amount.value) ?? null);
const amountError = computed(() =>
  cents.value === null ? 'Type an amount, such as 0, 35 or 35.50.' : '',
);
const account = computed(() => ({ currency: props.currency }));

/** The change, said before Save: "Friday, May 8, 2099 will owe $0 instead of $35." */
const sentence = computed(() => {
  const line = props.line;
  if (!line || cents.value === null || cents.value === line.owedCents) return '';
  const was = line.owedCents == null ? 'no price' : money(line.owedCents, account.value);
  return `${dateLabel(line.date)} will owe ${money(cents.value, account.value)} instead of ${was}.`;
});
const ready = computed(
  () => cents.value !== null && cents.value !== props.line?.owedCents && !busy.value,
);

async function save(): Promise<void> {
  const line = props.line;
  if (!ready.value || !line || cents.value === null) return;
  busy.value = true;
  error.value = '';
  try {
    emit('saved', await setAmountOwed(props.marketId, props.email, line.date, cents.value));
  } catch (err: unknown) {
    error.value = getApiErrorMessage(err, 'The amount owed could not be changed.');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog
    :open="open && !!line"
    title="Change the amount owed"
    testid="change-owed"
    anchored
    :confirm-label="busy ? 'Saving…' : 'Set amount owed'"
    :confirm-disabled="!ready"
    :error="error"
    @close="emit('close')"
    @submit="save"
  >
    <div class="change-owed-body">
      <p v-if="line" class="change-owed-note">
        The pricing calculates
        {{ line.priceCents == null ? 'no price' : money(line.priceCents, account) }} for this day.
        Set $0 to waive it.
      </p>
      <label class="change-owed-field">
        <span class="field-label">Amount owed{{ currency ? ` (${currency})` : '' }}</span>
        <input
          id="change-owed-amount"
          v-model="amount"
          type="text"
          inputmode="decimal"
          class="field"
          autocomplete="off"
          :aria-invalid="!!amountError"
          :aria-describedby="amountError ? 'change-owed-amount-error' : 'change-owed-sentence'"
          data-testid="change-owed-amount"
        />
        <span
          v-if="amountError"
          id="change-owed-amount-error"
          class="change-owed-error"
          role="alert"
          data-testid="change-owed-amount-error"
          >{{ amountError }}</span
        >
      </label>
      <p
        v-if="sentence"
        id="change-owed-sentence"
        class="change-owed-note"
        data-testid="change-owed-sentence"
      >
        {{ sentence }}
      </p>
    </div>
  </AppDialog>
</template>

<style scoped>
.change-owed-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.change-owed-note {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.change-owed-field {
  display: flex;
  flex-direction: column;
}

.change-owed-error {
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: var(--mm-red);
}
</style>
