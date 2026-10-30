<script setup lang="ts">
/**
 * The Tools tab (E46/F01/S02): the manual tools an organizer runs whenever they choose, in every
 * phase until the market is archived, rather than parts of the plan that settle on leaving draft.
 *
 * Discord is the first. Each tool is a card of the page's card grid, as the plan's are, so a tool
 * added later is one more card and decides nothing else (the design language, Layout). Who may use
 * a tool is its own row of the table; a card the row refuses reads, with no control.
 *
 * It fits a phone (`meta.fitsAPhone`), the second organizer market screen that does after the
 * door: an organizer may connect Discord from one (Daniel, T113).
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useOpenMarket } from '@/utils/openMarket';
import MarketFrame from '@/components/MarketFrame.vue';
import MarketDiscordCard from '@/components/market/MarketDiscordCard.vue';

const route = useRoute();
const marketId = computed(() => String(route.params.marketId ?? ''));
const { market, refresh } = useOpenMarket(marketId);
</script>

<template>
  <MarketFrame :market="market">
    <div v-if="market" class="tools card-grid" data-testid="market-tools">
      <MarketDiscordCard :market="market" @changed="refresh" />
    </div>
  </MarketFrame>
</template>

<style scoped>
/* The frame's gutter, as on every market page: in line with the rail and the frame's own note. */
.tools {
  align-self: stretch;
  padding: var(--space-6);
}

/* On a phone the gutter narrows, as the door's does, and stays on both sides. */
@media (width <= 640px) {
  .tools {
    padding: var(--space-4);
  }
}
</style>
