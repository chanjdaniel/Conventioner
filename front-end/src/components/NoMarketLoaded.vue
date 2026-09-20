<script setup lang="ts">
/**
 * What a market-scoped page shows when no market is open.
 *
 * Four organizer routes take no parameter and read `localStorage.market`: `/market-setup`,
 * `/import-applications`, `/assignment-results` and `/vendors`. Opened directly - after signing
 * out and back in, or from a bookmark - three of them rendered their editable surface anyway.
 * `/market-setup` was the worst of them: a page titled "Settings", an empty Market Dates panel,
 * no phase strip, and a live Next button. An editable setup wizard attached to no market.
 *
 * Putting the market id in the path is the real fix and is deliberately not taken here: guarding
 * removes the lie, and routing by id is justified by deep links and two-tab support, which is a
 * separate effort.
 */
import { useRouter } from 'vue-router';

defineProps<{
  /** What this page would have shown, named so the message is about the page you asked for. */
  shows?: string;
}>();

const router = useRouter();
</script>

<template>
  <div class="no-market" data-testid="no-market-loaded">
    <h1>No market is open</h1>
    <p>
      {{
        shows
          ? `This page shows ${shows} for one market at a time.`
          : 'This page shows one market at a time.'
      }}
      Choose one and it will open here.
    </p>
    <button type="button" class="no-market-action" @click="router.push('/markets')">
      Choose a market
    </button>
  </div>
</template>

<style scoped>
.no-market {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 48px 40px;
  color: var(--mm-black);
}

h1 {
  margin: 0;
  font-size: var(--text-xl);
  font-weight: 600;
}

p {
  margin: 0;
  max-width: 52ch;
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.no-market-action {
  height: 38px;
  padding: 0 18px;
  border-radius: var(--radius-control);
  border: 1px solid var(--mm-green);
  background: var(--mm-green);
  color: white;
  font-size: var(--text-sm);
  cursor: pointer;
}
</style>
