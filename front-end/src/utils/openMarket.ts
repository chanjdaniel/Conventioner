/**
 * Open the market a screen is routed to, and keep it as the server has it (E21/F02/S01).
 *
 * Every market screen is addressed by id, and this is how it gets its market: from the one store
 * (`@/stores/market`), opened on arrival and whenever the route's id changes. It is re-read when
 * the organizer comes back to this browser tab, which is what "I changed it in another tab and
 * came back" needs - and all it needs, since live push is out of scope.
 *
 * It replaced `useRailMarket`, which fetched a market of its own for the rail on Tables and
 * Attendance and wrote it into `localStorage` for everyone else.
 */
import { onMounted, onUnmounted, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useMarketStore } from '@/stores/market';

export function useOpenMarket(marketId: Ref<string>) {
  const store = useMarketStore();
  const { market, status } = storeToRefs(store);

  watch(
    marketId,
    (id) => {
      if (id) void store.open(id);
    },
    { immediate: true },
  );

  const onVisible = () => {
    if (document.visibilityState === 'visible' && marketId.value) void store.refresh();
  };
  onMounted(() => document.addEventListener('visibilitychange', onVisible));
  onUnmounted(() => document.removeEventListener('visibilitychange', onVisible));

  return { market, status, refresh: store.refresh };
}
