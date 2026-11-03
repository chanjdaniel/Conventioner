<script setup lang="ts">
/**
 * Where a signed-in vendor stands (ADR 0022): "Submitted" until results are published, whatever
 * the review decided, then "You have a table" with each day's table, or "You did not get assigned".
 *
 * The server serves no verdict before publishing, so there is none here to word; the seats are
 * read off the stored assignment on every read, so a vendor moved by hand reads their new table.
 *
 * On a Google Form market a signed-in address with no vendor there is told which address to use:
 * there is no application section to say it, since nobody applies on its page.
 */
import { computed } from 'vue';
import { IntakeMode } from '@/assets/types/datatypes';
import { useApplicationStore } from '@/stores/application';
import { noVendorAtThisAddress, statusHeadline } from '@/utils/vendorPage';
import { seatLine } from '@/utils/applicantOutcome';
import { getTimestampDate } from '@/utils/utils';

const store = useApplicationStore();

const application = computed(() => store.application);
const headline = computed(() => statusHeadline(application.value));
const hasATable = computed(() => application.value?.outcome === 'has_a_table');
const noVendor = computed(() =>
  !application.value && store.page?.intakeMode === IntakeMode.Csv
    ? noVendorAtThisAddress(store.page.marketName)
    : null,
);
</script>

<template>
  <div
    v-if="application && headline"
    class="status-card"
    :class="hasATable ? 'status-card--table' : 'status-card--neutral'"
    data-testid="vendor-page-status"
  >
    <span class="status-label">{{ headline }}</span>
    <span v-if="application.submittedAt" class="status-date">
      Submitted {{ getTimestampDate(application.submittedAt) }}
    </span>
    <ul v-if="application.seats?.length" class="status-seats" data-testid="vendor-page-seats">
      <li v-for="seat in application.seats" :key="seat.date">{{ seatLine(seat) }}</li>
    </ul>
  </div>
  <p v-else-if="noVendor" class="status-none" data-testid="vendor-page-no-vendor">
    {{ noVendor }}
  </p>
</template>

<style scoped>
.status-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-6);
  border-radius: var(--radius-card);
}

/* In the chip tones, each ink measured on its own ground (`contrast.test.ts`). */
.status-card--neutral {
  background: var(--mm-chip-informational);
  border: 1px solid var(--mm-blue);
  color: var(--mm-blue);
}

.status-card--table {
  background: var(--mm-chip-positive);
  border: 1px solid var(--mm-green);
  color: var(--mm-text-green);
}

.status-label {
  font-size: var(--text-lg);
  font-family: 'Merge One';
}

/* In the card's own ink, which is measured on its ground: dimmed by opacity it read 3.3:1. */
.status-date {
  font-size: var(--text-xs);
}

/* Worded and drawn as the application section's notice that a vendor has none. */
.status-none {
  margin: 0;
  background: var(--mm-chip-informational);
  border: 1px solid var(--mm-blue);
  border-radius: var(--radius-control);
  padding: var(--space-4);
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--mm-blue);
}

/* Where they sit, one line a date, under the outcome. */
.status-seats {
  margin: var(--space-2) 0 0;
  padding-left: var(--space-6);
  font-size: var(--text-sm);
}
</style>
