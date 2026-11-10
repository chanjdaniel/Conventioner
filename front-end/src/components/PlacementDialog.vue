<script setup lang="ts">
/**
 * Changing one placement, from the screen that can show which seats are free.
 *
 * Three changes and never a fourth (`E11/F03/S01`, T208). A seat is filled, from nobody or from
 * another table (a move, one write, so the vendor never stands at no table); two vendors trade
 * seats atomically; or a seat is freed. Nothing here puts a vendor into a seat somebody holds:
 * that is how a vendor is silently unassigned on market day.
 */
import { computed, ref, watch } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import SearchPicker, { type PickerGroup, type PickerOption } from '@/components/SearchPicker.vue';
import { vendorLabel, vendorOption } from '@/utils/personChoice';
import { type VendorNames } from '@/utils/vendorIdentity';
import { vendorFound, type VendorSearch } from '@/utils/resultFilters';
import {
  FULL_TABLE,
  HALF_TABLE_LEFT,
  HALF_TABLE_RIGHT,
  groupCandidates,
  placementWarnings,
  seatAMoveKeeps,
  seatLabel,
  tableInWords,
  seatWarnings,
  type EmptySeat,
  type PlaceableVendor,
  type Seat,
  type SeatedVendor,
} from '@/utils/placementChange';

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
  /** Everyone seated on this date, in table order: the occupant's swap partners are among them. */
  seated: SeatedVendor[];
  /** This date's empty seats, the occupant's own table left out: where a move may take them. */
  emptySeats: EmptySeat[];
  vendorNames: VendorNames;
  /** What the pages' search finds each vendor by, which the pickers search by too (E38/F08/S03). */
  vendorSearch: VendorSearch;
  busy?: boolean;
  errorMessage?: string;
  /**
   * What freeing this seat may also take off what its vendor owes (E44/F01/S02), for whoever may
   * change the amount owed: what the seat's line owes and the vendor's name. Null where it is not
   * asked.
   */
  deduction?: { amount: string; name: string } | null;
}>();

const emit = defineEmits<{
  place: [payload: { email: string; seat: Seat }];
  /** Ticked, the seat's line owes nothing once freed: a refund may be due. */
  free: [deductOwed: boolean];
  swap: [email: string];
  /** Move the occupant to an empty seat on this date, in one write (T208). */
  move: [payload: { tableCode: string; seat: Seat }];
  /** Open the occupant's drawer (E35/F01/S02): who they are, before deciding what to do. */
  view: [];
  close: [];
}>();

const chosenEmail = ref('');
const deductOwed = ref(false);
const chosenSeat = ref<Seat>(FULL_TABLE);
const swapWith = ref('');
/** What to do with the occupant: move them to an empty seat, or trade seats with someone. */
const action = ref<'move' | 'swap'>('move');
const moveTo = ref('');
const moveSeat = ref<Seat>(FULL_TABLE);

// `immediate`, because the dialog is mounted by the seat that opened it: nothing changes after
// mount, so a watcher that waits for a change never runs and the seat stays at its default. That
// read as "The whole table - the other side is taken" on the free half of a shared table.
watch(
  () => [props.open, props.tableCode, props.seat] as const,
  () => {
    chosenEmail.value = '';
    swapWith.value = '';
    moveTo.value = '';
    deductOwed.value = false;
    chosenSeat.value = props.seat ?? FULL_TABLE;
    // The action that disturbs nobody else first, unless there is nowhere empty to move them.
    action.value = props.emptySeats.length ? 'move' : 'swap';
  },
  { immediate: true },
);

// One picker in front of the organizer at a time, and never a choice left behind the other.
watch(action, () => {
  moveTo.value = '';
  swapWith.value = '';
});

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

/**
 * Everyone seated at another table on this date (T208): choosing one moves them here, in the one
 * write that places them, which frees the seat they leave. Anyone seated, an applicant or not.
 */
const seatedElsewhere = computed(() =>
  props.seated.filter((vendor) => vendor.tableCode !== props.tableCode),
);
const seatedElsewhereOf = computed(
  () => new Map(seatedElsewhere.value.map((vendor) => [vendor.email, vendor])),
);
/** The vendor chosen, when choosing them moves them here from another table. */
const mover = computed(() => seatedElsewhereOf.value.get(chosenEmail.value));
// A move starts at the free side, or at the shape they hold now; any other choice at the seat's.
watch(mover, (moving, wasMoving) => {
  if (moving) chosenSeat.value = seatAMoveKeeps(moving.seat, props.seat);
  else if (wasMoving) chosenSeat.value = props.seat ?? FULL_TABLE;
});

/**
 * What the choice overrides. A move is judged as one from a taken seat is: this seat's tier and
 * size only, since it changes which table they stand at, never their dates or the ceiling.
 */
const warnings = computed(() =>
  mover.value
    ? seatWarnings(vendorFor(chosenEmail.value), props.date, props.tier, chosenSeat.value)
    : placementWarnings(vendorFor(chosenEmail.value), {
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
  const target = swapPartners.value.find((t) => t.email === swapWith.value);
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

/** The empty seat chosen to move the occupant to. */
const moveTarget = computed(() => props.emptySeats.find((seat) => seat.tableCode === moveTo.value));
// A move refused for a seat taken meanwhile leaves the dialog open while the page reads the tables
// again; the seat chosen is then no longer empty, so it stops being the choice as it leaves the list.
watch(
  () => props.emptySeats,
  (seats) => {
    if (moveTo.value && !seats.some((seat) => seat.tableCode === moveTo.value)) moveTo.value = '';
  },
);
// A seat chosen starts at its free side, or at the shape the occupant holds now (T208).
watch(moveTarget, (target) => {
  if (target) moveSeat.value = seatAMoveKeeps(props.seat ?? FULL_TABLE, target.seat);
});
/**
 * What a move overrides: the new seat's tier and size, as a swap's. A move on one date changes
 * only which table the vendor stands at, so it never warns about their dates or the ceiling.
 */
const moveWarnings = computed(() => {
  const target = moveTarget.value;
  if (!target) return [];
  return seatWarnings(vendorFor(props.occupantEmail), props.date, target.tier, moveSeat.value);
});
const canMove = computed(() => Boolean(moveTarget.value) && !props.busy);

/** The occupied mode's primary, which follows the action chosen. */
const occupiedPrimary = computed(() =>
  action.value === 'move'
    ? { label: 'Move them', testid: 'placement-dialog-move', enabled: canMove.value }
    : { label: 'Swap seats', testid: 'placement-dialog-swap', enabled: canSwap.value },
);
/** The place mode's primary says what it does: a vendor from another table is moved here. */
const placeLabel = computed(() => (mover.value ? 'Move them here' : 'Assign them here'));
const primaryLabel = computed(() =>
  props.mode === 'place' ? placeLabel.value : occupiedPrimary.value.label,
);
const primaryEnabled = computed(() =>
  props.mode === 'place' ? canPlace.value : occupiedPrimary.value.enabled,
);

/**
 * What Enter does here (E20/F01/S03). Each mode has exactly one primary action at a time - the
 * placement, or the move or swap chosen - and it is the form's submit, so Enter runs it through
 * the same guard its button wears, and does nothing at all while that button is disabled.
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
  if (action.value === 'move') {
    const target = moveTarget.value;
    if (!canMove.value || !target) return;
    emit('move', { tableCode: target.tableCode, seat: moveSeat.value });
    return;
  }
  if (!canSwap.value) return;
  emit('swap', swapWith.value);
}

/** Both halves, in a list where the organizer is choosing between people. */
const label = (email: string | null | undefined): string => vendorLabel(email, props.vendorNames);

/** A seated vendor's table, in words: "Hall B 1, left half" rather than a stored spelling. */
function whereTheySit(target: SeatedVendor): string {
  if (target.seat === FULL_TABLE) return target.tableCode;
  return tableInWords(target.tableCode, target.seat);
}

/**
 * The vendor pickers, searched by the pages' terms (E38/F08/S03): a vendor's name, business or
 * address, and for anyone seated the table they sit at, by its code or its section.
 */
const vendorChoice = (email: string): PickerOption => vendorOption(email, props.vendorNames);

/** "Who sits here", grouped and never filtered (claims-and-room 05): a search only narrows. */
const placeGroups = computed((): PickerGroup[] => [
  {
    label: 'Fits this seat',
    testid: 'placement-dialog-fits',
    options: groups.value.fits.map((v) => vendorChoice(v.email)),
  },
  {
    label: 'Would override their answers',
    testid: 'placement-dialog-overrides',
    options: groups.value.overrides.map((v) => vendorChoice(v.email)),
  },
  // Anyone may be seated by hand (E36/F02/S02): the review governs the run, and an applicant it
  // left out is one deliberate, warned pick away.
  {
    label: 'Not approved',
    testid: 'placement-dialog-not-approved',
    options: groups.value.notApproved.map((v) => vendorChoice(v.email)),
  },
  // Recorded on the day, with no answers to fit or override (E36/F03/S01).
  {
    label: 'Added by hand',
    testid: 'placement-dialog-added',
    options: groups.value.addedByHand.map((v) => vendorChoice(v.email)),
  },
  // Last and named for what choosing one does, so nobody is moved by someone thinking they are
  // placing a vendor with no table (T208).
  {
    label: 'Seated elsewhere today (moves them)',
    testid: 'placement-dialog-seated-elsewhere',
    options: seatedElsewhere.value.map((vendor) => ({
      ...vendorChoice(vendor.email),
      detail: `Leaves ${tableInWords(vendor.tableCode, vendor.seat)}`,
    })),
  },
]);
function findsToPlace(option: PickerOption, words: string): boolean {
  const vendor = seatedElsewhereOf.value.get(option.value);
  const where = vendor ? [vendor.tableCode, vendor.section] : [];
  return vendorFound(words, option.value, props.vendorSearch, where);
}

/** "Swap them with": everyone else seated that day, in table order. */
const swapPartners = computed(() => {
  const occupant = String(props.occupantEmail ?? '').toLowerCase();
  return props.seated.filter((target) => target.email.toLowerCase() !== occupant);
});
const swapGroups = computed((): PickerGroup[] => [
  {
    options: swapPartners.value.map((target) => ({
      ...vendorChoice(target.email),
      detail: whereTheySit(target),
    })),
  },
]);
const swapTargetOf = computed(
  () => new Map(swapPartners.value.map((target) => [target.email, target])),
);
function findsToSwap(option: PickerOption, words: string): boolean {
  const target = swapTargetOf.value.get(option.value);
  const where = target ? [target.tableCode, target.section] : [];
  return vendorFound(words, option.value, props.vendorSearch, where);
}

/**
 * "Move them to": the day's empty seats, one group per section in the plan's order, headed with
 * the section and its tier, each table naming the part of it that is free. One row per table per
 * date, so a table's code is its value.
 */
const moveGroups = computed((): PickerGroup[] => {
  const groups: PickerGroup[] = [];
  let last = '';
  for (const seat of props.emptySeats) {
    if (!groups.length || seat.section !== last) {
      last = seat.section;
      groups.push({ label: [seat.section, seat.tier].filter(Boolean).join(', '), options: [] });
    }
    groups.at(-1)!.options.push({
      value: seat.tableCode,
      label: seat.tableCode,
      detail: seatLabel(seat.seat ?? FULL_TABLE),
    });
  }
  return groups;
});
const emptySeatOf = computed(() => new Map(props.emptySeats.map((seat) => [seat.tableCode, seat])));
/** An empty seat is found by its table code, its section, its location or its tier. */
function findsToMove(option: PickerOption, words: string): boolean {
  const seat = emptySeatOf.value.get(option.value);
  const needle = words.trim().toLowerCase();
  const where = seat ? [seat.tableCode, seat.section, seat.location, seat.tier] : [];
  return where.some((text) => (text ?? '').toLowerCase().includes(needle));
}
</script>

<template>
  <AppDialog
    :open="open"
    :title="tableCode"
    testid="placement-dialog"
    size="wide"
    scroll="body"
    :confirm-label="primaryLabel"
    :confirm-disabled="!primaryEnabled"
    :error="errorMessage"
    @close="emit('close')"
    @submit="submitPrimary"
  >
    <p class="placement-dialog-sub">
      {{ dateLabel }}<span v-if="section"> - {{ section }}</span
      ><span v-if="tier">, {{ tier }}</span>
    </p>

    <template v-if="mode === 'place'">
      <!-- Grouped, never filtered (claims-and-room 05): overriding an answer stays possible, it
           just is not mixed in with the vendors this seat fits, and a search narrows each group
           without hiding one. -->
      <SearchPicker
        v-model="chosenEmail"
        :groups="placeGroups"
        :finds="findsToPlace"
        label="Who sits here"
        placeholder="Search by name, business or email…"
        testid="placement-dialog-vendor"
      />
      <p v-if="candidates.length === 0" class="placement-note">
        Every vendor who applied already has a table on this date.<template
          v-if="seatedElsewhere.length"
        >
          Choosing one moves them here.</template
        >
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
      <div class="placement-occupant-row">
        <p class="placement-occupant">
          <strong data-testid="placement-dialog-occupant">{{ label(occupantEmail) }}</strong>
          holds this seat.
        </p>
        <button
          type="button"
          class="btn btn--secondary btn--compact"
          data-testid="placement-dialog-view-vendor"
          @click="emit('view')"
        >
          View vendor
        </button>
      </div>

      <fieldset class="placement-field">
        <legend class="field-label">What to do with them</legend>
        <label class="placement-radio">
          <input
            v-model="action"
            type="radio"
            value="move"
            data-testid="placement-dialog-action-move"
          />
          <span>Move to an empty seat</span>
        </label>
        <label class="placement-radio">
          <input
            v-model="action"
            type="radio"
            value="swap"
            data-testid="placement-dialog-action-swap"
          />
          <span>Swap with someone seated</span>
        </label>
      </fieldset>

      <template v-if="action === 'move'">
        <SearchPicker
          v-model="moveTo"
          :groups="moveGroups"
          :finds="findsToMove"
          label="Move them to"
          placeholder="Search by table, section or tier…"
          none-word="Nothing"
          testid="placement-dialog-move-target"
        />
        <p v-if="emptySeats.length === 0" class="placement-note">
          Every table is taken on this date, so there is nowhere empty to move them.
        </p>

        <template v-if="moveTarget">
          <fieldset v-if="!moveTarget.seat" class="placement-field">
            <legend class="field-label">Which seat</legend>
            <label v-for="option in seatChoices" :key="option" class="placement-radio">
              <input
                v-model="moveSeat"
                type="radio"
                :value="option"
                :data-testid="`placement-dialog-seat-${option}`"
              />
              <span>{{ seatLabel(option) }}</span>
            </label>
          </fieldset>
          <p v-else class="placement-note" data-testid="placement-dialog-fixed-seat">
            {{ seatLabel(moveSeat) }} - the other side is taken.
          </p>

          <ul
            v-if="moveWarnings.length"
            class="placement-warnings"
            data-testid="placement-dialog-move-warning"
          >
            <li v-for="warning in moveWarnings" :key="warning">{{ warning }}</li>
          </ul>
        </template>
      </template>

      <template v-else>
        <SearchPicker
          v-model="swapWith"
          :groups="swapGroups"
          :finds="findsToSwap"
          label="Swap them with"
          placeholder="Search by name, business, email or table…"
          testid="placement-dialog-swap-target"
        />
        <p v-if="swapPartners.length === 0" class="placement-note">
          Nobody else holds a table on this date, so there is nobody to trade with.
        </p>
      </template>

      <div
        v-if="action === 'swap' && swapWarnings.length"
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
        Freeing this seat leaves them with no table on this date until they are assigned again.
      </p>
      <!-- Freeing never changes what they owe by itself (Q26); this asks, unticked. -->
      <label v-if="deduction" class="placement-radio placement-deduct">
        <input v-model="deductOwed" type="checkbox" data-testid="placement-dialog-deduct" />
        <span
          >Also remove its {{ deduction.amount }} from what {{ deduction.name }} owes? (Cancelled
          before the deadline: a refund may be due.)</span
        >
      </label>
    </template>

    <!--
      Its own footer, because the occupied mode has a destructive action beside the primary one.
      The primary is `type="submit"`, so Enter reaches it and nothing else here; in the occupied
      mode it follows the action chosen, Move them or Swap seats.
    -->
    <template #actions>
      <button
        type="button"
        class="btn btn--secondary"
        data-testid="placement-dialog-cancel"
        @click="emit('close')"
      >
        Cancel
      </button>
      <button
        v-if="mode === 'occupied'"
        type="button"
        class="btn btn--destructive"
        :disabled="busy"
        data-testid="placement-dialog-free"
        @click="emit('free', !!deduction && deductOwed)"
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
        {{ placeLabel }}
      </button>
      <button
        v-else
        type="submit"
        class="btn btn--primary"
        :disabled="!occupiedPrimary.enabled"
        :data-testid="occupiedPrimary.testid"
      >
        {{ occupiedPrimary.label }}
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

/* A legend's own inline padding would set it 2px right of the labels and fields around it. */
.placement-field legend {
  padding: 0;
}

.placement-radio {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

/* A phone (T142): each choice a thumb's target, its label included. */
@media (width <= 640px) {
  .placement-radio {
    min-height: var(--target-min);
  }
}

/* Two lines in the drawer's width: the box stays beside the first. */
.placement-deduct {
  align-items: flex-start;
}

.placement-deduct input {
  margin-top: var(--space-hairline);
}

.placement-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.placement-occupant-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-3);
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
