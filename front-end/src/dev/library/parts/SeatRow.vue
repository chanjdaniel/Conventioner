<script setup lang="ts">
/**
 * One table on the Assignments page, on the fixture: its code, its size and the real `ResultSeat`.
 * The fixture seats one vendor at a table, so every row holds a whole one. The look is
 * `ResultView.vue`'s, copied rather than shared, since no real screen changes here. A seat there
 * opens the placement dialog and the vendor drawer; here it emits `open` and `view`, and the entry
 * reads them out.
 */
import ResultSeat from '@/components/ResultSeat.vue';
import { FULL_TABLE } from '@/utils/placementChange';
import type { VendorNames } from '@/utils/vendorIdentity';

defineProps<{
  code: string;
  email: string;
  names: VendorNames;
  /** A record: shown, never offered. */
  readOnly?: boolean;
}>();

defineEmits<{ open: []; view: [] }>();
</script>

<template>
  <div class="seat-row" data-testid="library-seat-row">
    <div class="seat-row__head">
      <span class="seat-row__code">{{ code }}</span>
      <span class="chip chip--positive">{{ FULL_TABLE }}</span>
    </div>
    <div class="seat-row__assignment">
      <ResultSeat
        :email="email"
        vacantLabel="Unassigned"
        whole
        :names="names"
        :readOnly="readOnly ?? false"
        @open="$emit('open')"
        @view="$emit('view')"
      />
    </div>
  </div>
</template>

<style scoped>
.seat-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background-color: white;
  border-radius: var(--radius-card);
  border-left: 4px solid var(--mm-green);
  box-shadow: var(--shadow-card);
}

.seat-row__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.seat-row__code {
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  color: var(--mm-black);
  letter-spacing: 0.5px;
}

.seat-row__assignment {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding-top: var(--space-1);
  border-top: 1px dashed var(--mm-border);
}
</style>
