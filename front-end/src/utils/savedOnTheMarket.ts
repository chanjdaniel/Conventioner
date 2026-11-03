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
 *
 * So is a re-read of the market that lands while a write is in flight: it was asked for before the
 * click being written, and putting it on screen un-ticked what was just ticked. The write's own
 * answer, and the re-read after it, bring the list up to date.
 *
 * A list that a draft must decide before Review (T206) also carries the organizer's choice of none,
 * as the market holds it (`storedNone`) and as the write answers it.
 */
export function useSavedOnTheMarket<T>(
  market: Ref<Market | null | undefined>,
  stored: (market: Market) => T[] | undefined,
  write: (marketId: string, value: T[], none: boolean) => Promise<{ list: T[]; none: boolean }>,
  failure: string,
  storedNone: (market: Market) => boolean = () => false,
) {
  const value = ref<T[]>([...((market.value && stored(market.value)) ?? [])]) as Ref<T[]>;
  /**
   * That the organizer chose none (T206): an empty list says only that nothing is marked, so the
   * choice is its own flag beside it. Written with the empty list by `chooseNone`, and false after
   * any `save`, so the next mark replaces it.
   */
  const none = ref(Boolean(market.value && storedNone(market.value)));
  const error = ref('');
  let latestSave = 0;
  let writing = 0;

  watch(
    () => market.value && stored(market.value),
    (held) => {
      if (held && writing === 0) value.value = [...held];
    },
  );
  watch(
    () => Boolean(market.value && storedNone(market.value)),
    (held) => {
      if (writing === 0) none.value = held;
    },
  );

  async function commit(next: T[], nextNone: boolean) {
    const id = market.value?.id;
    if (!id) return;
    const previous = { list: [...value.value], none: none.value };
    const thisSave = (latestSave += 1);
    value.value = next;
    none.value = nextNone;
    error.value = '';
    writing += 1;
    try {
      const written = await write(id, next, nextNone);
      writing -= 1;
      if (thisSave !== latestSave) return;
      value.value = [...written.list];
      none.value = written.none;
      void useMarketStore().refresh();
    } catch (err: unknown) {
      writing -= 1;
      if (thisSave !== latestSave) return;
      value.value = previous.list;
      none.value = previous.none;
      error.value = getApiErrorMessage(err, failure);
    }
  }

  /** Write this list, which replaces a choice of none. */
  function save(next: T[]) {
    return commit(next, false);
  }

  /** Choose none: the empty list and the flag, in one write. */
  function chooseNone() {
    return commit([], true);
  }

  return { value, none, error, save, chooseNone };
}
