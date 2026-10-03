<script setup lang="ts">
import { computed } from 'vue';
import { marketPath } from '@/utils/market';
import { useRouter, useRoute } from 'vue-router';
import FloorplanWorkflow from '@/components/floorplan/FloorplanWorkflow.vue';
import MarketFrame from '@/components/MarketFrame.vue';
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
const { market } = useOpenMarket(marketId);

function handleSaved(payload: { market_id: string }) {
  // Back to the plan, where the sections it just described are listed.
  router.push(marketPath(payload.market_id, 'setup'));
}
</script>

<template>
  <!-- A flow entered from Market Setup, standing in the frame like every market page (bug 43): the
       bar with that tab active (E22/F04/S02), and the rail. It was full-bleed, with neither. -->
  <MarketFrame :market="market">
    <FloorplanWorkflow
      v-if="market"
      class="floorplan-flow"
      :marketId="market.id"
      @saved="handleSaved"
    />
  </MarketFrame>
</template>

<style scoped>
/* The whole card, so each step's Next sits at its foot rather than above an empty band. */
.floorplan-flow {
  flex: 1;
}
</style>
