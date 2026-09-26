<script setup lang="ts">
import { computed } from 'vue';
import { marketPath } from '@/utils/market';
import { useRouter, useRoute } from 'vue-router';
import FloorplanWorkflow from '@/components/floorplan/FloorplanWorkflow.vue';
import MarketArrival from '@/components/MarketArrival.vue';
import { useOpenMarket } from '@/utils/openMarket';

const router = useRouter();
const route = useRoute();

/** The market in the route (E21/F02/S04); it used to ride in the query string. */
const marketId = computed(() => String(route.params.marketId ?? ''));
/**
 * Opened through the one store like every other market screen, so an id that names no market - or
 * one this organizer cannot reach - reads as such, rather than opening an editor that will fail on
 * save.
 */
const { market, status: marketStatus, refresh: refreshMarket } = useOpenMarket(marketId);

function handleSaved(payload: { market_id: string }) {
  router.push(marketPath(payload.market_id));
}
</script>

<template>
  <div class="floorplan-editor-view">
    <div class="editor-wrapper">
      <FloorplanWorkflow v-if="market" :marketId="market.id" @saved="handleSaved" />
      <MarketArrival v-else :status="marketStatus" @retry="refreshMarket()" />
    </div>
  </div>
</template>

<style scoped>
.floorplan-editor-view {
  width: 100%;
  min-width: 1000px;
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--mm-beige);
}

.editor-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
