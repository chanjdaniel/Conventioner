<script setup lang="ts">
/**
 * One market date, for one vendor: what happened to them that day.
 *
 * Three states, one component. The cards existed and had the hole in them: a placed date and an
 * unplaced one carried the same green left border and the unplaced one's content was a bare em
 * dash, so a date with no table read as placed at a glance.
 *
 * The second state - placed against the vendor's own stated preference - is `E11/F02/S02`'s pin
 * override. Tier sets the price, so a vendor charged for a table they did not choose has to be
 * visible as such, and it belongs here rather than in a second override-marking UI elsewhere.
 */
import { computed } from 'vue';
import {
  overrideText,
  placementReasonText,
  reasonIsActionable,
  type PlacementOverride,
  type PlacementReason,
} from '@/utils/placementReason';

const props = defineProps<{
  /** The market date, as it reads to a person. */
  label: string;
  /** Where they were placed, when they were. */
  placement?: string | null;
  /** Why they were not, when they were not. */
  reason?: PlacementReason;
  /**
   * What this placement overrides about the vendor's own answer, when it overrides anything.
   *
   * A pin that breaks a filter stands - admins edit without restriction - but never silently:
   * tier sets the price, so someone will be charged for a table they did not choose
   * (`E11/F02/S02`).
   */
  overrides?: PlacementOverride[];
  /** Where the organizer can go to act on a `free` reason. */
  placeHref?: string | null;
}>();

defineEmits<{ place: [] }>();

const placed = computed(() => !!props.placement);
const overridden = computed(() => (props.overrides?.length ?? 0) > 0);
const state = computed(() => {
  if (!placed.value) return 'unplaced';
  return overridden.value ? 'overridden' : 'placed';
});
/**
 * The way from this card to the screen that can change it (`E11/F03/S02`).
 *
 * Offered on a placed date too, not only on a free seat. The trigger for every change is a
 * person - a vendor drops out, a vendor must move - and this panel is where an organizer is
 * looking at that person; the Tables view is the only screen that can answer "where can they go".
 * An unplaced date offers it only when a seat is actually free, because the other three reasons
 * are answered in the plan or in the vendor's own answers, never at a table.
 */
const actionLabel = computed(() => (placed.value ? 'Change placement' : 'Place them'));
const canPlace = computed(() => placed.value || reasonIsActionable(props.reason));
</script>

<template>
  <li
    class="vendor-date-card"
    :class="`vendor-date-card--${state}`"
    :data-state="state"
    data-testid="vendors-detail-assignment-item"
  >
    <div class="vendor-date-card-date">{{ label }}</div>

    <div v-if="placed" class="vendor-date-card-detail">
      {{ placement }}
      <a
        v-if="canPlace && placeHref"
        class="vendor-date-card-action"
        :href="placeHref"
        data-testid="vendor-date-card-place-link"
        @click.prevent="$emit('place')"
      >
        {{ actionLabel }}
      </a>
      <span v-if="overridden" class="vendor-date-card-flag" data-testid="vendor-date-card-override">
        {{ overrideText(overrides) }}
      </span>
    </div>

    <!-- Never punctuation. An unplaced date used to be an em dash on a card the same colour as a
         placed one. -->
    <div v-else class="vendor-date-card-detail" data-testid="vendor-date-card-reason">
      {{ placementReasonText(reason) }}
      <a
        v-if="canPlace && placeHref"
        class="vendor-date-card-action"
        :href="placeHref"
        data-testid="vendor-date-card-place-link"
        @click.prevent="$emit('place')"
      >
        {{ actionLabel }}
      </a>
    </div>
  </li>
</template>

<style scoped>
/* On the detail panel's white body, matching the cards this replaces. The left border is the
   state, read before any of the text is: a placed date and an unplaced one used to carry the same
   green border, and the unplaced one's content was an em dash. */
.vendor-date-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid #e1e4e8;
  border-left: 4px solid var(--mm-border);
  border-radius: 8px;
  padding: 12px 14px;
  background: white;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.vendor-date-card--placed {
  border-left-color: var(--mm-green);
}

.vendor-date-card--overridden {
  border-left-color: var(--mm-yellow);
}

/* Not green, and not red either: an unplaced date is a fact to act on, not a failure. */
.vendor-date-card--unplaced {
  border-left-color: var(--mm-text-muted);
  background: #fbfbfa;
}

.vendor-date-card-date {
  font-family: 'Merge One', sans-serif;
  font-size: 15px;
  color: var(--mm-green);
}

.vendor-date-card--unplaced .vendor-date-card-date {
  color: var(--mm-text-muted);
}

.vendor-date-card-detail {
  font-size: 14px;
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.vendor-date-card--unplaced .vendor-date-card-detail {
  color: var(--mm-text-muted);
  font-style: italic;
}

.vendor-date-card-flag {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  font-style: italic;
  color: var(--mm-text-yellow);
}

.vendor-date-card-action {
  display: inline-block;
  margin-left: 8px;
  color: var(--mm-text-link);
  font-style: normal;
  text-decoration: underline;
  cursor: pointer;
}
</style>
