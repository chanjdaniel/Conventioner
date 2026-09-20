<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { type Market } from '@/assets/types/datatypes.ts';
import { fetchMarkets, openMarket } from '@/utils/market';
import { useEscapeToClose } from '@/utils/useEscapeToClose';
import { useModalRoot } from '@/utils/useModalRoot';
import MarketSummaryCard from '@/components/MarketSummaryCard.vue';

const props = defineProps<{
  loadOpen: boolean;
}>();

const emit = defineEmits<{
  loadClose: [];
}>();

useEscapeToClose(
  () => props.loadOpen,
  () => emit('loadClose'),
);

/** Modal: the page behind it goes out of the tab order, not just out of reach of the mouse. */
const modalRoot = useModalRoot(() => props.loadOpen);

const router = useRouter();
const markets = ref<Market[]>([]);

onMounted(async () => {
  markets.value = await fetchMarkets();
});

const handleLoadMarket = (market: Market) => openMarket(router, market);
</script>

<template>
  <div ref="modalRoot" class="container" :style="{ visibility: loadOpen ? 'visible' : 'hidden' }">
    <div
      class="background"
      @click="$emit('loadClose')"
      :style="{ opacity: loadOpen ? '100%' : '0%' }"
      data-testid="load-market-overlay-background"
    ></div>
    <div class="window">
      <div class="header">
        <h2>Load Market</h2>
        <p v-if="markets.length === 0" class="empty-state">No markets found</p>
      </div>
      <div class="markets-container">
        <MarketSummaryCard
          v-for="market in markets"
          :key="market.id"
          :market="market"
          data-testid="load-market-card-button"
          @open="handleLoadMarket(market)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
}

.background {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0%;
  transition:
    opacity 0.15s ease-in-out,
    visibility 0.15s ease-in-out;
  z-index: 0;
}

.window {
  position: relative;
  width: 70%;
  max-width: 900px;
  height: 85%;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 12px;
  z-index: 1;
  padding: 0;
  overflow: hidden;
  box-shadow: var(--shadow-card);
}

.header {
  padding: 32px 40px 24px;
  border-bottom: 1px solid var(--mm-border);
}

.header h2 {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--mm-black);
}

.empty-state {
  margin-top: 12px;
  color: #666;
  font-size: var(--text-sm);
}

.markets-container {
  flex: 1;
  overflow-y: auto;
  padding: 24px 40px 32px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Scrollbar styling */
.markets-container::-webkit-scrollbar {
  width: 8px;
}

.markets-container::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.markets-container::-webkit-scrollbar-thumb {
  background: var(--mm-border);
  border-radius: 4px;
}

.markets-container::-webkit-scrollbar-thumb:hover {
  background: #999;
}
</style>
