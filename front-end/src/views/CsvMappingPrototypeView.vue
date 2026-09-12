<script setup lang="ts">
/**
 * THROWAWAY PROTOTYPE HOST - delete with `src/prototypes/` once a variant wins.
 *
 * Three variants of the CSV column-mapping flow, switchable via `?variant=`, on the
 * throwaway route `/prototype/csv-mapping`. No backend calls, no persistence.
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import PrototypeVariantSwitcher from '@/prototypes/PrototypeVariantSwitcher.vue';
import VariantAColumnLedger from '@/prototypes/csv-mapping/VariantAColumnLedger.vue';
import VariantBTargetBoard from '@/prototypes/csv-mapping/VariantBTargetBoard.vue';
import VariantCGuidedWalkthrough from '@/prototypes/csv-mapping/VariantCGuidedWalkthrough.vue';

const VARIANTS = [
  { key: 'A', name: 'Column ledger' },
  { key: 'B', name: 'Target board' },
  { key: 'C', name: 'Guided walkthrough' },
];

const route = useRoute();
const variant = computed(() => String(route.query.variant ?? 'A').toUpperCase());
</script>

<template>
  <div class="prototype-host">
    <VariantBTargetBoard v-if="variant === 'B'" />
    <VariantCGuidedWalkthrough v-else-if="variant === 'C'" />
    <VariantAColumnLedger v-else />
    <PrototypeVariantSwitcher :variants="VARIANTS" />
  </div>
</template>

<style scoped>
.prototype-host {
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
