<script setup lang="ts">
/**
 * One table on the Assignments page, on the fixture: its code, its size and the real `ResultSeat`.
 * The fixture seats one vendor at a table, so every row holds a whole one. The look is
 * `ResultView.vue`'s, copied rather than shared, since no real screen changes here. A seat there
 * opens the placement dialog and the vendor drawer; here a press reads out under the row it was
 * made on, since a page of sections has no one place that would be in view.
 */
import { ref } from 'vue';
import ResultSeat from '@/components/ResultSeat.vue';
import { FULL_TABLE } from '@/utils/placementChange';
import { vendorHeadline, type VendorNames } from '@/utils/vendorIdentity';
import ReadOut from './ReadOut.vue';

const props = defineProps<{ code: string; email: string; names: VendorNames }>();

const pressed = ref<string | null>(null);
const who = () => vendorHeadline(props.email, props.names);
</script>

<template>
  <div class="seat-row">
    <div class="seat-row__head">
      <span class="seat-row__code">{{ code }}</span>
      <span class="chip chip--positive" data-testid="tables-table-choice">{{ FULL_TABLE }}</span>
    </div>
    <div class="seat-row__assignment">
      <ResultSeat
        :email="email"
        vacantLabel="Unassigned"
        whole
        :names="names"
        :readOnly="false"
        @open="pressed = `Change ${code}, ${who()}`"
        @view="pressed = `The drawer of ${who()}`"
      />
    </div>
    <ReadOut v-if="pressed" label="Pressed" :value="pressed" />
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
