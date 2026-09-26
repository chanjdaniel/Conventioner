<script setup lang="ts">
/**
 * A market's own address, `/markets/:id` (E22/F04/S02).
 *
 * It lands on the page the market is worked on in its phase - the one carrying the dot - which it
 * can only know once the market has arrived, so it opens the market, shows the arrival, and then
 * replaces itself with that page. Opening a market from a list, the dashboard or a new market all
 * come through here, so none of them has to know which page a phase belongs to.
 */
import { computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MarketFrame from '@/components/MarketFrame.vue';
import MarketArrival from '@/components/MarketArrival.vue';
import { marketPath } from '@/utils/market';
import { currentPage, hasAssignment } from '@/utils/marketPage';
import { useOpenMarket } from '@/utils/openMarket';

const route = useRoute();
const router = useRouter();
const marketId = computed(() => String(route.params.marketId ?? ''));
const { market, status, refresh } = useOpenMarket(marketId);

watch(
  market,
  (arrived) => {
    if (!arrived || arrived.id !== marketId.value) return;
    void router.replace(marketPath(arrived.id, currentPage(arrived.phase, hasAssignment(arrived))));
  },
  { immediate: true },
);
</script>

<template>
  <div class="market-landing">
    <MarketFrame :market="null">
      <MarketArrival :status="status" @retry="refresh()" />
    </MarketFrame>
  </div>
</template>

<style scoped>
.market-landing {
  width: 100%;
  padding: 0 var(--space-4) var(--space-4);
}
</style>
