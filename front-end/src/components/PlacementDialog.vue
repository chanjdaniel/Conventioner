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
  groupCandidates,
  placementWarnings,
  seatLabel,
  tableInWords,
  seatWarnings,
  type PlaceableVendor,
  type Seat,
} from '@/utils/placementChange';

/** One seat somebody already holds, offered as the other half of a swap. */
export interface SwapTarget {
  email: string;
  tableCode: string;
  tier: string;
  seat: Seat;
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
  /**
   * The seat that was opened. Placing: fixed when only one side is free, null when the whole
   * table is and the seat is a choice. Occupied: the seat the occupant holds.
   */
  seat: Seat | null;
  occupantEmail?: string | null;
  /** Every vendor who could be placed, with their answers - a change is judged against them. */
  vendors: PlaceableVendor[];
  /** The dates each vendor holds a seat on, keyed by lowercased address. */
  datesHeld: Record<string, string[]>;
  /** The organizer's ceiling on dates per vendor; null when they set none. */
  marketCeiling: number | null;
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

function datesHeldBy(email: string): string[] {
  return props.datesHeld[email.toLowerCase()] ?? [];
}

function vendorFor(email: string | null | undefined): PlaceableVendor | undefined {
  const address = String(email ?? '').toLowerCase();
  return props.vendors.find((vendor) => vendor.email.toLowerCase() === address);
}

/** Anyone not already at a table on this date - one seat per vendor per date. */
const candidates = computed(() =>
  props.vendors.filter((vendor) => !datesHeldBy(vendor.email).includes(props.date)),
);
const groups = computed(() =>
  groupCandidates(
    candidates.value,
    { date: props.date, tier: props.tier, seat: props.seat, marketCeiling: props.marketCeiling },
    datesHeldBy,
  ),
);

const warnings = computed(() =>
  placementWarnings(vendorFor(chosenEmail.value), {
    date: props.date,
    tier: props.tier,
    seat: chosenSeat.value,
    datesHeld: datesHeldBy(chosenEmail.value),
    marketCeiling: props.marketCeiling,
  }),
);

/**
 * What a trade overrides, for each of the two vendors (bug 18): each takes the other's table, so
 * each is judged against the seat they are moving into. Only the vendors it overrides are listed.
 */
const swapWarnings = computed(() => {
  const target = props.swapTargets.find((t) => t.email === swapWith.value);
  if (!target || !props.occupantEmail || !props.seat) return [];
  return [
    {
      email: props.occupantEmail,
      warnings: seatWarnings(vendorFor(props.occupantEmail), props.date, target.tier, target.seat),
    },
    {
      email: target.email,
      warnings: seatWarnings(vendorFor(target.email), props.date, props.tier, props.seat),
    },
  ].filter((side) => side.warnings.length > 0);
});
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

/** A swap partner's table, in words: "Hall B 1, left half" rather than a stored spelling. */
function whereTheySit(target: SwapTarget): string {
  if (target.seat === FULL_TABLE) return target.tableCode;
  return tableInWords(target.tableCode, target.seat);
}
</script>

<template>
  <AppDialog
    :open="open"
    :title="tableCode"
    testid="placement-dialog"
    wide
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
          <!-- Grouped, never filtered (claims-and-room 05): overriding an answer stays possible,
               it just is not mixed in with the vendors this seat fits. -->
          <optgroup
            v-if="groups.fits.length"
            label="Fits this seat"
            data-testid="placement-dialog-fits"
          >
            <option v-for="vendor in groups.fits" :key="vendor.email" :value="vendor.email">
              {{ label(vendor.email) }}
            </option>
          </optgroup>
          <optgroup
            v-if="groups.overrides.length"
            label="Would override their answers"
            data-testid="placement-dialog-overrides"
          >
            <option v-for="vendor in groups.overrides" :key="vendor.email" :value="vendor.email">
              {{ label(vendor.email) }}
            </option>
          </optgroup>
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
            {{ label(target.email) }} - {{ whereTheySit(target) }}
          </option>
        </select>
      </label>
      <p v-if="swapTargets.length === 0" class="placement-note">
        Nobody else holds a table on this date, so there is nobody to trade with.
      </p>

      <div
        v-if="swapWarnings.length"
        class="placement-swap-warnings"
        data-testid="placement-dialog-swap-warning"
      >
        <div v-for="side in swapWarnings" :key="side.email" :data-vendor-email="side.email">
          <p class="placement-swap-name">{{ label(side.email) }}</p>
          <ul class="placement-warnings">
            <li v-for="warning in side.warnings" :key="warning">{{ warning }}</li>
          </ul>
        </div>
      </div>

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

.placement-swap-warnings {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.placement-swap-name {
  margin: 0 0 var(--space-1);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-black);
}
</style>
