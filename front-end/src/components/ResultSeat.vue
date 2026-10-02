<script setup lang="ts">
/**
 * One seat on the Result page: who holds it, and the way into changing that.
 *
 * Every seat is a control on a market that can change - an empty one is filled, an occupied one is
 * freed or traded, and a seat rather than a table is what a placement names (E11/F03/S01). On a
 * market that cannot change it is a record, and draws as text with nothing to press (bug 30). It
 * was six copies of a button in the page, and a record needs every one of them to know.
 */
import VendorIdentity from '@/components/VendorIdentity.vue';
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
}>();

const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <div
    v-if="readOnly"
    class="seat seat--record"
    :class="{ 'seat--vacant': !email }"
    :data-testid="email ? 'tables-seat-occupied' : 'tables-seat-empty'"
    :data-vendor-email="email ?? undefined"
  >
    <VendorIdentity
      v-if="email"
      class="seat-occupant"
      :class="{ 'seat-occupant--whole': whole }"
      :email="email"
      :names="names"
    />
    <span v-else :class="vacantLabel === 'Unassigned' ? 'seat-unassigned' : 'seat-vacant'">{{
      vacantLabel
    }}</span>
  </div>
  <button
    v-else
    type="button"
    class="seat seat-button"
    :class="{ 'seat--vacant': !email }"
    :data-testid="email ? 'tables-seat-occupied' : 'tables-seat-empty'"
    :data-vendor-email="email ?? undefined"
    @click="emit('open')"
  >
    <VendorIdentity
      v-if="email"
      class="seat-occupant"
      :class="{ 'seat-occupant--whole': whole }"
      :email="email"
      :names="names"
    />
    <span v-else :class="vacantLabel === 'Unassigned' ? 'seat-unassigned' : 'seat-vacant'">{{
      vacantLabel
    }}</span>
    <span class="seat-button-hint">{{ email ? 'Change' : 'Place someone' }}</span>
  </button>
</template>

<style scoped>
.seat {
  display: flex;
  align-items: baseline;
  gap: 8px;
  /* Sized to its occupant, not to the row. A full-width button lit the whole row on hover, which
     reads as "this table" rather than "this seat" - and a table holds two of them. */
  align-self: flex-start;
  max-width: 100%;
  min-width: 0;
  text-align: left;
  padding: 6px 8px;
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
   (E09/F03). */
.seat-button {
  border-color: var(--mm-border);
  cursor: pointer;
}

.seat-button:hover {
  border-color: var(--mm-green);
  background: var(--mm-beige);
}

.seat-button:focus-visible {
  outline: 2px solid var(--mm-green);
  outline-offset: 1px;
}

/* Dashed for a seat with nobody in it, solid for one with somebody: the difference between an
   opening and a person is worth reading before any of the text is. A record keeps no box at all,
   which is exactly how it says there is nothing here to press. */
.seat-button.seat--vacant {
  border-style: dashed;
}

.seat-occupant {
  font-size: var(--text-sm);
  color: var(--mm-black);
  word-break: break-word;
}

.seat-occupant--whole {
  font-weight: 600;
}

.seat-vacant {
  font-size: var(--text-sm);
  color: var(--mm-black);
  opacity: 0.5;
  font-style: italic;
}

.seat-unassigned {
  font-size: var(--text-sm);
  color: var(--mm-black);
  opacity: 0.6;
  font-style: italic;
}

/* Shown on hover or focus, but its space is reserved always: a hint that appears and pushes the
   row taller makes the grid jump under the pointer. `nowrap` keeps it beside the label rather
   than below it, so a vacant seat is exactly as tall as an occupied one. At rest the word "Vacant"
   is the whole message; "Place someone" on every empty seat would be a wall of instructions. */
.seat-button-hint {
  font-size: var(--text-xs);
  white-space: nowrap;
  color: var(--mm-text-link);
  opacity: 0;
}

.seat-button:hover .seat-button-hint,
.seat-button:focus-visible .seat-button-hint {
  opacity: 1;
}
</style>
