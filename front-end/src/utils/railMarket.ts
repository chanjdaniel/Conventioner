/**
 * The market a screen draws its phase rail for.
 *
 * The rail belongs below the header on every market screen (`E10/F01/S01`), and the screens do
 * not agree about how they know which market they are looking at: the plan editor and the vendor
 * list read one out of `localStorage`, while Tables and Attendance are routed by id and never
 * held a `Market` at all. Rather than teach the rail two ways of being told, this fetches one by
 * id and keeps `localStorage` in step, so a transition fired from any screen is the transition
 * every other screen sees.
 */
import { ref, watch, type Ref } from 'vue';
import type { Market } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { parseMarketFromApi } from '@/utils/market';

export function useRailMarket(marketId: Ref<string>) {
  const market = ref<Market | null>(null);

  async function load(): Promise<void> {
    if (!marketId.value) {
      market.value = null;
      return;
    }
    try {
      const resp = await api.get(`/markets/${encodeURIComponent(marketId.value)}`);
      market.value = parseMarketFromApi(resp.data.market);
    } catch {
      // The rail is never the reason a screen fails to render: without a market it draws nothing,
      // and the screen's own content is what the organizer came for.
      market.value = null;
    }
  }

  /** After a transition, so the screen and the stored market agree about the phase. */
  function adopt(updated: Market): void {
    market.value = updated;
    localStorage.setItem('market', JSON.stringify(updated));
  }

  watch(marketId, load, { immediate: true });

  return { market, adopt, reload: load };
}
