import { ref, watch, type Ref } from 'vue';
import { getApiErrorMessage } from '@/utils/api';
import { useMarketStore } from '@/stores/market';
import type { Market } from '@/assets/types/datatypes';

/**
 * A list the market holds and a screen changes a click at a time, each click its own write: what
 * a reviewer reads first (E19/F03) and which answers reject automatically (E33/F03).
 *
 * Every change is shown at once, written whole, and followed by the store re-reading the market,
 * so every surface that reads the list moves with it (E21/F02/S02). A failed write puts the list
 * back and says why.
 *
 * Which write is the current one is tracked: two quick clicks put two in flight, and responses are
 * not promised in order. Applying whichever landed LAST wrote the older list over the newer one -
 * mark two answers quickly and the second silently came back off. A stale response is ignored.
 */
export function useSavedOnTheMarket<T>(
  market: Ref<Market | null | undefined>,
  stored: (market: Market) => T[] | undefined,
  write: (marketId: string, value: T[]) => Promise<T[]>,
  failure: string,
) {
  const value = ref<T[]>([...((market.value && stored(market.value)) ?? [])]) as Ref<T[]>;
  const error = ref('');
  let latestSave = 0;

  watch(
    () => market.value && stored(market.value),
    (held) => {
      if (held) value.value = [...held];
    },
  );

  async function save(next: T[]) {
    const id = market.value?.id;
    if (!id) return;
    const previous = [...value.value];
    const thisSave = (latestSave += 1);
    value.value = next;
    error.value = '';
    try {
      const written = await write(id, next);
      if (thisSave !== latestSave) return;
      value.value = [...written];
      void useMarketStore().refresh();
    } catch (err: unknown) {
      if (thisSave !== latestSave) return;
      value.value = previous;
      error.value = getApiErrorMessage(err, failure);
    }
  }

  return { value, error, save };
}
