<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { type Market } from '@/assets/types/datatypes';
import { getApiErrorMessage } from '@/utils/api';
import { fetchMarkets, openMarket } from '@/utils/market';
import MarketSummaryCard from '@/components/MarketSummaryCard.vue';
import NewMarketOverlay from './NewMarketOverlay.vue';
import ManageMarketOverlay from './ManageMarketOverlay.vue';

const router = useRouter();
const markets = ref<Market[]>([]);
const loading = ref(true);
const errorMessage = ref('');
const newOpen = ref(false);
const manageOpen = ref(false);
const manageMarket = ref<Market | null>(null);

async function loadMarkets() {
  loading.value = true;
  errorMessage.value = '';
  try {
    markets.value = await fetchMarkets();
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to load markets');
    markets.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadMarkets();
});

function handleOpen(market: Market) {
  openMarket(router, market);
}

function handleManage(market: Market) {
  manageMarket.value = market;
  manageOpen.value = true;
}

function handleManageClose() {
  manageOpen.value = false;
  manageMarket.value = null;
  loadMarkets();
}

function handleNewClose() {
  newOpen.value = false;
  loadMarkets();
}
</script>

<template>
  <div class="markets-view">
    <div class="header">
      <h1>Markets</h1>
      <button class="new-market-button" @click="newOpen = true" data-testid="markets-create-button">
        New market
      </button>
    </div>

    <div class="markets-block">
      <p v-if="loading" class="empty-state">Loading markets...</p>
      <p v-else-if="errorMessage" class="error-state">{{ errorMessage }}</p>
      <p v-else-if="markets.length === 0" class="empty-state">No markets found</p>
      <div v-else class="markets-container">
        <MarketSummaryCard
          v-for="market in markets"
          :key="market.id"
          :market="market"
          showManage
          @open="handleOpen(market)"
          @manage="handleManage(market)"
        />
      </div>
    </div>

    <NewMarketOverlay @newClose="handleNewClose" :newOpen="newOpen" />
    <ManageMarketOverlay
      :manageOpen="manageOpen"
      :market="manageMarket"
      @manageClose="handleManageClose"
    />
  </div>
</template>

<style scoped>
.markets-view {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  padding: 32px 40px;
  overflow: hidden;
}

.header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--mm-border);
}

.header h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: var(--mm-black);
}

.new-market-button {
  padding: 10px 24px;
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 2px 4px rgba(73, 176, 150, 0.2);
}

.new-market-button:hover {
  background: #3a9a82;
  box-shadow: 0 4px 8px rgba(73, 176, 150, 0.3);
}

.markets-block {
  flex: 1;
  overflow-y: auto;
  padding-top: 24px;
}

.empty-state,
.error-state {
  color: #666;
  font-size: 14px;
}

.error-state {
  color: #d32f2f;
}

.markets-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Scrollbar styling */
.markets-block::-webkit-scrollbar {
  width: 8px;
}

.markets-block::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}

.markets-block::-webkit-scrollbar-thumb {
  background: var(--mm-border);
  border-radius: 4px;
}

.markets-block::-webkit-scrollbar-thumb:hover {
  background: #999;
}
</style>
