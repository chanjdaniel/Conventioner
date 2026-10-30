<script setup lang="ts">
import { MarketAction, mayTake } from '@/utils/marketActions';
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

/**
 * Whether this market's sections can no longer be drawn. The flow writes the setup, which settles
 * on leaving draft (E31/F01/S03), so past it the flow says so in place of a wizard whose save would
 * only be refused - as Market Setup does, in the same words. A person who may change nothing is
 * offered no wizard either, and the frame says why (T15).
 */
const settled = computed(
  () => !mayTake(market.value, MarketAction.ChangeSetup) || Boolean(market.value?.setupLockReason),
);

function backToSetup() {
  if (market.value) router.push(marketPath(market.value.id, 'setup'));
}

function handleSaved(payload: { market_id: string }) {
  // Back to the plan, where the sections it just described are listed.
  router.push(marketPath(payload.market_id, 'setup'));
}
</script>

<template>
  <!-- A flow entered from Market Setup, standing in the frame like every market page (bug 43): the
       bar with that tab active (E22/F04/S02), and the rail. It was full-bleed, with neither. -->
  <MarketFrame :market="market">
    <div v-if="market && settled" class="floorplan-settled" data-testid="floorplan-settled">
      <p v-if="market.setupLockReason" class="note">{{ market.setupLockReason }}</p>
      <button type="button" class="btn btn--secondary" @click="backToSetup">
        Back to Market Setup
      </button>
    </div>
    <FloorplanWorkflow
      v-else-if="market"
      class="floorplan-flow"
      :marketId="market.id"
      @saved="handleSaved"
    />
  </MarketFrame>
</template>

<style scoped>
.floorplan-settled {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
}

/* The whole card, so each step's Next sits at its foot rather than above an empty band. */
.floorplan-flow {
  flex: 1;
}
</style>
