<script setup lang="ts">
/**
 * Choosing a market to open (E20/F01/S03).
 *
 * No confirm action - picking a market IS the action - so it passes no confirm label and takes
 * the scrim, window, close control, Escape, backdrop and inert behaviour from `AppDialog` without
 * a footer. It had no visible close control of its own at all.
 */
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { type Market } from '@/assets/types/datatypes.ts';
import { fetchMarkets, openMarket } from '@/utils/market';
import AppDialog from '@/components/AppDialog.vue';
import MarketSummaryCard from '@/components/MarketSummaryCard.vue';

const props = defineProps<{
  loadOpen: boolean;
}>();

const emit = defineEmits<{
  loadClose: [];
}>();

const router = useRouter();
const markets = ref<Market[]>([]);

onMounted(async () => {
  markets.value = await fetchMarkets();
});

const handleLoadMarket = (market: Market) => openMarket(router, market);
</script>

<template>
  <AppDialog
    :open="props.loadOpen"
    title="Load market"
    testid="load-market"
    wide
    @close="emit('loadClose')"
  >
    <p v-if="markets.length === 0" class="empty-state" data-testid="load-market-empty">
      No markets found
    </p>
    <div v-else class="markets-container">
      <MarketSummaryCard
        v-for="market in markets"
        :key="market.id"
        :market="market"
        data-testid="load-market-card-button"
        @open="handleLoadMarket(market)"
      />
    </div>
  </AppDialog>
</template>

<style scoped>
.empty-state {
  margin: 0;
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.markets-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
</style>
