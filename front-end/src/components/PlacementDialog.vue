<script setup lang="ts">
/**
 * Changing one placement, from the screen that can show which seats are free.
 *
 * Two operations and deliberately no third (`E11/F03/S01`). A seat is filled, or two vendors
 * trade seats atomically. There is no "move" that displaces whoever is already there: that is how
 * a vendor is silently unassigned on market day, and freeing a seat first is both safe and what an
 * organizer physically does.
 */
import { computed, ref, watch } from 'vue';
import { useEscapeToClose } from '@/utils/useEscapeToClose';
import { useModalRoot } from '@/utils/useModalRoot';
import { vendorName, type VendorNames } from '@/utils/vendorIdentity';
import {
  FULL_TABLE,
  HALF_TABLE_LEFT,
  HALF_TABLE_RIGHT,
  placementWarnings,
  seatLabel,
  type PlaceableVendor,
  type Seat,
} from '@/utils/placementChange';

/** One seat somebody already holds, offered as the other half of a swap. */
export interface SwapTarget {
  email: string;
  tableCode: string;
  seat: string;
}

const props = defineProps<{
  open: boolean;
  /** Filling a seat, or deciding what to do with one somebody holds. */
  mode: 'place' | 'occupied';
  date: string;
  dateLabel: string;
  tableCode: string;
  section: string;
  tier: string;
  /** Fixed when only one side is free; null when the whole table is, and the seat is a choice. */
  seat: Seat | null;
  occupantEmail?: string | null;
  candidates: PlaceableVendor[];
  swapTargets: SwapTarget[];
  vendorNames: VendorNames;
  busy?: boolean;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  place: [payload: { email: string; seat: Seat }];
  free: [];
  swap: [email: string];
  close: [];
}>();

const chosenEmail = ref('');
const chosenSeat = ref<Seat>(FULL_TABLE);
const swapWith = ref('');

// `immediate`, because the dialog is mounted by the seat that opened it: nothing changes after
// mount, so a watcher that waits for a change never runs and the seat stays at its default. That
// read as "The whole table - the other side is taken" on the free half of a shared table.
watch(
  () => [props.open, props.tableCode, props.seat] as const,
  () => {
    chosenEmail.value = '';
    swapWith.value = '';
    chosenSeat.value = props.seat ?? FULL_TABLE;
  },
  { immediate: true },
);

useEscapeToClose(
  () => props.open,
  () => emit('close'),
);

/** Modal: the page behind it goes out of the tab order, not just out of reach of the mouse. */
const modalRoot = useModalRoot(() => props.open);

const seatChoices: Seat[] = [FULL_TABLE, HALF_TABLE_LEFT, HALF_TABLE_RIGHT];
/** A fixed seat is not a choice: only one side of this table is free. */
const seatIsFixed = computed(() => props.seat !== null);

const chosenVendor = computed(() => props.candidates.find((v) => v.email === chosenEmail.value));
const warnings = computed(() =>
  placementWarnings(chosenVendor.value, props.date, chosenSeat.value),
);
const canPlace = computed(() => Boolean(chosenEmail.value) && !props.busy);

/**
 * Both halves, in a list where the organizer is choosing between people.
 *
 * The address alone is what every vendor surface used to show; the name alone is ambiguous in a
 * dropdown, where two traders may share one. So: the name, and the address that identifies them.
 */
function label(email: string | null | undefined): string {
  const address = String(email ?? '').trim();
  const name = vendorName(address, props.vendorNames);
  return name ? `${name} (${address})` : address;
}
</script>

<template>
  <div v-if="open" ref="modalRoot" class="placement-scrim" @click.self="emit('close')">
    <div
      class="placement-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="placement-dialog-title"
      data-testid="placement-dialog"
    >
      <header class="placement-dialog-head">
        <h2 id="placement-dialog-title">{{ tableCode }}</h2>
        <p class="placement-dialog-sub">
          {{ dateLabel }}<span v-if="section"> - {{ section }}</span
          ><span v-if="tier">, {{ tier }}</span>
        </p>
        <button
          type="button"
          class="placement-dialog-close"
          aria-label="Close"
          data-testid="placement-dialog-close"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <div class="placement-dialog-body">
        <template v-if="mode === 'place'">
          <label class="placement-field">
            <span class="placement-field-label">Who sits here</span>
            <select v-model="chosenEmail" data-testid="placement-dialog-vendor">
              <option value="">Choose a vendor…</option>
              <option v-for="vendor in candidates" :key="vendor.email" :value="vendor.email">
                {{ label(vendor.email) }}
              </option>
            </select>
          </label>
          <p v-if="candidates.length === 0" class="placement-note">
            Every vendor who applied already has a table on this date.
          </p>

          <fieldset v-if="!seatIsFixed" class="placement-field">
            <legend class="placement-field-label">Which seat</legend>
            <label v-for="option in seatChoices" :key="option" class="placement-radio">
              <input
                type="radio"
                :value="option"
                v-model="chosenSeat"
                :data-testid="`placement-dialog-seat-${option}`"
              />
              <span>{{ seatLabel(option) }}</span>
            </label>
          </fieldset>
          <p v-else class="placement-note" data-testid="placement-dialog-fixed-seat">
            {{ seatLabel(chosenSeat) }} - the other side is taken.
          </p>

          <!-- Before the change, not after: the product does not rewrite an applicant's answer
               to match what an organizer did. -->
          <ul
            v-if="warnings.length"
            class="placement-warnings"
            data-testid="placement-dialog-warning"
          >
            <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
          </ul>
        </template>

        <template v-else>
          <p class="placement-occupant">
            <strong data-testid="placement-dialog-occupant">{{ label(occupantEmail) }}</strong>
            holds this seat.
          </p>

          <label class="placement-field">
            <span class="placement-field-label">Swap them with</span>
            <select v-model="swapWith" data-testid="placement-dialog-swap-target">
              <option value="">Choose a vendor to trade seats with…</option>
              <option v-for="target in swapTargets" :key="target.email" :value="target.email">
                {{ label(target.email) }} - {{ target.tableCode }} ({{ target.seat }})
              </option>
            </select>
          </label>
          <p v-if="swapTargets.length === 0" class="placement-note">
            Nobody else holds a table on this date, so there is nobody to trade with.
          </p>

          <p class="placement-note">
            Freeing this seat leaves them with no table on this date until they are placed again.
          </p>
        </template>

        <p v-if="errorMessage" class="placement-error" data-testid="placement-dialog-error">
          {{ errorMessage }}
        </p>
      </div>

      <footer class="placement-dialog-actions">
        <button type="button" class="ghost-button" @click="emit('close')">Cancel</button>
        <template v-if="mode === 'place'">
          <button
            type="button"
            class="confirm-button"
            :disabled="!canPlace"
            data-testid="placement-dialog-confirm"
            @click="emit('place', { email: chosenEmail, seat: chosenSeat })"
          >
            Place them here
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            class="ghost-button ghost-button--danger"
            :disabled="busy"
            data-testid="placement-dialog-free"
            @click="emit('free')"
          >
            Free this seat
          </button>
          <button
            type="button"
            class="confirm-button"
            :disabled="!swapWith || busy"
            data-testid="placement-dialog-swap"
            @click="emit('swap', swapWith)"
          >
            Swap seats
          </button>
        </template>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.placement-scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 60;
}

.placement-dialog {
  width: 100%;
  max-width: 440px;
  background: white;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 40px);
}

.placement-dialog-head {
  position: relative;
  padding: 20px 48px 12px 20px;
  border-bottom: 1px solid var(--mm-border);
}

.placement-dialog-head h2 {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  color: var(--mm-green);
}

.placement-dialog-sub {
  margin: 4px 0 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.placement-dialog-close {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: var(--radius-control);
  background: transparent;
  font-size: var(--text-lg);
  line-height: 1;
  color: var(--mm-text-muted);
  cursor: pointer;
}

.placement-dialog-close:hover {
  background: var(--mm-beige);
  color: var(--mm-black);
}

.placement-dialog-body {
  padding: 16px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.placement-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: none;
  margin: 0;
  padding: 0;
}

.placement-field-label {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.placement-field select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  font-family: inherit;
  font-size: var(--text-sm);
  background: white;
  color: var(--mm-black);
}

.placement-radio {
  display: flex;
  align-items: center;
  gap: 8px;
}

.placement-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.placement-occupant {
  margin: 0;
}

.placement-warnings {
  margin: 0;
  padding: 10px 12px 10px 28px;
  border-left: 4px solid var(--mm-yellow);
  border-radius: var(--radius-control);
  background: rgba(228, 166, 41, 0.18);
  color: var(--mm-text-yellow);
  font-size: var(--text-xs);
}

.placement-error {
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-xs);
}

.placement-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px 18px;
  border-top: 1px solid var(--mm-border);
}

.ghost-button,
.confirm-button {
  padding: 8px 14px;
  border-radius: var(--radius-control);
  font-size: var(--text-sm);
  cursor: pointer;
}

.ghost-button {
  border: 1px solid var(--mm-border);
  background: white;
  color: var(--mm-black);
}

.ghost-button--danger {
  color: var(--mm-red);
  border-color: var(--mm-red);
}

.confirm-button {
  border: 1px solid var(--mm-green);
  background: var(--mm-green);
  color: white;
}

.confirm-button:disabled,
.ghost-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
