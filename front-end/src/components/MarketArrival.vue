<script setup lang="ts">
/**
 * What a market screen shows while its market is not in hand (E21/F02/S01).
 *
 * Nothing about a market is kept in the browser any more, so a reload has nothing to paint until
 * the server answers. A market that does not exist and one this organizer cannot reach read the
 * same, word for word: telling them apart would confirm to anyone guessing ids that a market is
 * real.
 */
import type { MarketStatus } from '@/stores/market';

defineProps<{ status: MarketStatus }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <p v-if="status === 'loading'" class="arrival" data-testid="market-arrival-loading">
    Loading market…
  </p>
  <div v-else-if="status === 'failed'" class="arrival" data-testid="market-arrival-failed">
    <p>This market could not be loaded.</p>
    <button
      type="button"
      class="btn btn--secondary btn--compact"
      data-testid="market-arrival-retry"
      @click="$emit('retry')"
    >
      Try again
    </button>
  </div>
  <div v-else-if="status === 'missing'" class="arrival" data-testid="market-arrival-missing">
    <p>This market does not exist, or you do not have access to it.</p>
    <RouterLink to="/markets" class="btn btn--secondary btn--compact">Choose a market</RouterLink>
  </div>
</template>

<style scoped>
.arrival {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  padding: var(--space-4) var(--space-6);
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.arrival p {
  margin: 0;
}
</style>
