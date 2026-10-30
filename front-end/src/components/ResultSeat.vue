<script setup lang="ts">
/**
 * One seat on the Assignments page: who holds it, and the way into changing that.
 *
 * Every seat is a control on a market that can change - an empty one is filled, an occupied one is
 * freed or traded, and a seat rather than a table is what a placement names (E11/F03/S01). On a
 * market that cannot change it is a record, and draws as text with nothing to press (bug 30). It
 * was six copies of a button in the page, and a record needs every one of them to know.
 *
 * Whoever holds it is a name that opens their drawer (E35/F01/S02), so a held seat is two controls
 * side by side, the name and Change, rather than one button - a button cannot hold another.
 */
import VendorNameButton from '@/components/VendorNameButton.vue';
import { type VendorNames } from '@/utils/vendorIdentity';

defineProps<{
  /** Who holds the seat; null when nobody does. */
  email: string | null;
  /** What an empty seat says: a whole free table is "Unassigned", half of one is "Vacant". */
  vacantLabel: 'Unassigned' | 'Vacant';
  /** The occupant has the whole table, which reads heavier than a half. */
  whole?: boolean;
  names: VendorNames;
  /** A record: shown, never offered. */
  readOnly: boolean;
  /** Seated by hand though the review left them out (E36/F02/S03): said on the seat itself. */
  notApproved?: boolean;
}>();

/** `open` changes the seat; `view` opens the drawer of whoever holds it. */
const emit = defineEmits<{ open: []; view: [] }>();
</script>

<template>
  <!-- Somebody holds it: their name, and - where the seat can change - Change beside it. -->
  <div
    v-if="email"
    class="seat"
    :class="readOnly ? 'seat--record' : 'seat--held'"
    data-testid="tables-seat-occupied"
    :data-vendor-email="email"
  >
    <VendorNameButton
      class="seat-occupant"
      :class="{ 'seat-occupant--whole': whole }"
      :email="email"
      :names="names"
      testid="tables-seat-vendor"
      @open="emit('view')"
    />
    <button
      v-if="!readOnly"
      type="button"
      class="seat-change"
      :aria-label="`Change ${email}'s seat`"
      data-testid="tables-seat-change"
      @click="emit('open')"
    >
      <span class="seat-button-hint" data-testid="tables-seat-hint">Change</span>
    </button>
    <span
      v-if="notApproved"
      class="chip chip--destructive seat-flag"
      data-testid="tables-seat-not-approved"
      >Not approved</span
    >
  </div>
  <div v-else-if="readOnly" class="seat seat--record seat--vacant" data-testid="tables-seat-empty">
    <span :class="vacantLabel === 'Unassigned' ? 'seat-unassigned' : 'seat-vacant'">{{
      vacantLabel
    }}</span>
  </div>
  <button
    v-else
    type="button"
    class="seat seat-button seat--vacant"
    data-testid="tables-seat-empty"
    @click="emit('open')"
  >
    <span :class="vacantLabel === 'Unassigned' ? 'seat-unassigned' : 'seat-vacant'">{{
      vacantLabel
    }}</span>
    <span class="seat-button-hint" data-testid="tables-seat-hint">Assign someone</span>
  </button>
</template>

<style scoped>
.seat {
  /* Who holds it on the left, the hint in the top right corner (E28/F04/S01): beside the
     occupant, the hint moved with the length of their email. Baseline-aligned, so the hint sits
     level with the name line. */
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--space-2);
  /* Two lines tall whoever holds it - a name over an address - so an empty seat is as tall as an
     occupied one, and a table's two halves line up. */
  min-height: 3.5rem;
  /* One width for every seat, never the row's. A full-width button lit the whole row on hover,
     which reads as "this table" rather than "this seat" - and a table holds two of them. Sized to
     its occupant instead, every box on the page was a different width (bug 43). */
  align-self: flex-start;
  width: 20rem;
  max-width: 100%;
  min-width: 0;
  text-align: left;
  padding: var(--space-1) var(--space-2);
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: transparent;
  font: inherit;
}

/* A seat is a control, so it looks like one: bordered at rest, hovering, focusable. It stays quiet
   at rest because a page of twenty-four tables is a page of forty-eight of these, and a grid of
   buttons shouting at once is harder to read than the list it replaced. Bordered at rest, not only
   on hover: a vendor's name with no box around it does not look like anything you can press, and
   an organizer who cannot tell a seat is a control has no way to reach the change they came for
   (E09/F03). A held seat is the same box around its two controls. */
.seat-button,
.seat--held {
  border-color: var(--mm-border);
}

.seat-button {
  cursor: pointer;
}

.seat-button:hover,
.seat--held:hover,
.seat--held:focus-within {
  border-color: var(--mm-green);
  background: var(--mm-beige);
}

/* Dashed for a seat with nobody in it, solid for one with somebody: the difference between an
   opening and a person is worth reading before any of the text is. A record keeps no box at all,
   which is exactly how it says there is nothing here to press. */
.seat-button.seat--vacant {
  border-style: dashed;
}

/* Change, in the corner where the hint always was: a control of its own beside the name, and so
   shown at rest. On a free seat the hint can wait for the pointer, because the whole seat is the
   button; here Change is the only way to the dialog, and a touch has no hover. */
.seat-change {
  justify-self: end;
  padding: 0;
  border: none;
  border-radius: var(--radius-control);
  background: none;
  font: inherit;
  cursor: pointer;
}

.seat-change .seat-button-hint {
  opacity: 1;
}

.seat-change:hover .seat-button-hint {
  text-decoration: underline;
}

/* Beneath the name, on a line of its own, so the name and Change keep their places. */
.seat-flag {
  grid-column: 1 / -1;
  justify-self: start;
}

.seat-occupant {
  /* As wide as the name, not the column: the space beside it is the seat's, not the vendor's. */
  justify-self: start;
  font-size: var(--text-sm);
  color: var(--mm-black);
  word-break: break-word;
}

/* On the name itself: weight does not inherit here (the global reset sets every element to 400),
   so on the wrapper it reached nothing. */
.seat-occupant--whole :deep(.vendor-identity-name) {
  font-weight: 600;
}

.seat-vacant {
  font-size: var(--text-sm);
  /* Muted by a token, never by fading the ink: an empty table's yellow ground and a hovered
     seat's beige need the darker muted ink, which holds AA on white too. */
  color: var(--mm-text-muted-on-beige);
  font-style: italic;
}

.seat-unassigned {
  font-size: var(--text-sm);
  color: var(--mm-text-muted-on-beige);
  font-style: italic;
}

/* Shown on hover or focus, but its space is reserved always: a hint that appears and pushes the
   row taller makes the grid jump under the pointer. At rest the word "Vacant" is the whole message;
   "Place someone" on every empty seat would be a wall of instructions. */
.seat-button-hint {
  justify-self: end;
  font-size: var(--text-xs);
  white-space: nowrap;
  color: var(--mm-text-link);
  opacity: 0;
}

.seat-button:hover .seat-button-hint,
.seat-button:focus-visible .seat-button-hint,
.seat--held:hover .seat-button-hint,
.seat--held:focus-within .seat-button-hint {
  opacity: 1;
}
</style>
