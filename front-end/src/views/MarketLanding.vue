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
import { marketPath } from '@/utils/market';
import { currentPage, hasAssignment } from '@/utils/marketPage';
import { useOpenMarket } from '@/utils/openMarket';

const route = useRoute();
const router = useRouter();
const marketId = computed(() => String(route.params.marketId ?? ''));
const { market } = useOpenMarket(marketId);

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
  <!-- The frame says what is shown while the market is on its way, as on every market page. -->
  <MarketFrame :market="market" />
</template>
