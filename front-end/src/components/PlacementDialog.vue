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
import AppDialog from '@/components/AppDialog.vue';
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

const seatChoices: Seat[] = [FULL_TABLE, HALF_TABLE_LEFT, HALF_TABLE_RIGHT];
/** A fixed seat is not a choice: only one side of this table is free. */
const seatIsFixed = computed(() => props.seat !== null);

const chosenVendor = computed(() => props.candidates.find((v) => v.email === chosenEmail.value));
const warnings = computed(() =>
  placementWarnings(chosenVendor.value, props.date, chosenSeat.value),
);
const canPlace = computed(() => Boolean(chosenEmail.value) && !props.busy);
const canSwap = computed(() => Boolean(swapWith.value) && !props.busy);

/**
 * What Enter does here (E20/F01/S03). Each mode has exactly one primary action, and it is the
 * form's submit - so Enter runs it through the same guard its button wears, and does nothing at
 * all while that button is disabled.
 *
 * "Free this seat" is deliberately NOT it. It is the destructive half of the occupied mode, and
 * Enter must never be the way a vendor loses their table.
 */
function submitPrimary() {
  if (props.mode === 'place') {
    if (!canPlace.value) return;
    emit('place', { email: chosenEmail.value, seat: chosenSeat.value });
    return;
  }
  if (!canSwap.value) return;
  emit('swap', swapWith.value);
}

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
  <AppDialog
    :open="open"
    :title="tableCode"
    testid="placement-dialog"
    :confirm-label="mode === 'place' ? 'Place them here' : 'Swap seats'"
    :confirm-disabled="mode === 'place' ? !canPlace : !canSwap"
    :error="errorMessage"
    @close="emit('close')"
    @submit="submitPrimary"
  >
    <p class="placement-dialog-sub">
      {{ dateLabel }}<span v-if="section"> - {{ section }}</span
      ><span v-if="tier">, {{ tier }}</span>
    </p>

    <template v-if="mode === 'place'">
      <label class="placement-field">
        <span class="field-label">Who sits here</span>
        <select
          v-model="chosenEmail"
          class="field field--select"
          data-testid="placement-dialog-vendor"
        >
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
        <legend class="field-label">Which seat</legend>
        <label v-for="option in seatChoices" :key="option" class="placement-radio">
          <input
            v-model="chosenSeat"
            type="radio"
            :value="option"
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
      <ul v-if="warnings.length" class="placement-warnings" data-testid="placement-dialog-warning">
        <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
      </ul>
    </template>

    <template v-else>
      <p class="placement-occupant">
        <strong data-testid="placement-dialog-occupant">{{ label(occupantEmail) }}</strong>
        holds this seat.
      </p>

      <label class="placement-field">
        <span class="field-label">Swap them with</span>
        <select
          v-model="swapWith"
          class="field field--select"
          data-testid="placement-dialog-swap-target"
        >
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

    <!--
      Its own footer, because the occupied mode has a destructive action beside the primary one.
      The primary is `type="submit"`, so Enter reaches it and nothing else here.
    -->
    <template #actions>
      <button type="button" class="btn btn--secondary" @click="emit('close')">Cancel</button>
      <button
        v-if="mode === 'occupied'"
        type="button"
        class="btn btn--destructive"
        :disabled="busy"
        data-testid="placement-dialog-free"
        @click="emit('free')"
      >
        Free this seat
      </button>
      <button
        v-if="mode === 'place'"
        type="submit"
        class="btn btn--primary"
        :disabled="!canPlace"
        data-testid="placement-dialog-confirm"
      >
        Place them here
      </button>
      <button
        v-else
        type="submit"
        class="btn btn--primary"
        :disabled="!canSwap"
        data-testid="placement-dialog-swap"
      >
        Swap seats
      </button>
    </template>
  </AppDialog>
</template>

<style scoped>
/* The scrim, window, title, close and footer belong to `AppDialog`; the buttons and controls to
   `primitives.css`. What is left is this dialog's own reading matter (E20/F01/S03). */
.placement-dialog-sub {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.placement-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  border: none;
  padding: 0;
  margin: 0;
}

.placement-radio {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.placement-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.placement-occupant {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.placement-warnings {
  margin: 0;
  padding-left: var(--space-4);
  font-size: var(--text-xs);
  color: var(--mm-text-yellow-on-tint);
}
</style>
