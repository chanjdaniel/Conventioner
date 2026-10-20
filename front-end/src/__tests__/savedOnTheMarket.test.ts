/**
 * A list the market holds, changed a click at a time (E19/F03, E33/F03): what is on screen is the
 * reviewer's until their write lands. A re-read of the market that arrives while a write is in
 * flight is older than what they just did, and putting it back un-ticked the box they ticked.
 */
import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import type { Market } from '@/assets/types/datatypes';

vi.mock('@/stores/market', () => ({ useMarketStore: () => ({ refresh: vi.fn() }) }));

import { useSavedOnTheMarket } from '@/utils/savedOnTheMarket';

type Held = { list: string[] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('a list saved on the market', () => {
  it('keeps what was just clicked when an older re-read lands during the write', async () => {
    const market = ref({ id: 'm1', list: [] } as unknown as Market & Held);
    const pending = deferred<string[]>();
    const { value, save } = useSavedOnTheMarket<string>(
      market,
      (held) => (held as unknown as Held).list,
      () => pending.promise,
      'failed',
    );

    const saving = save(['ticked']);
    // The re-read the previous write asked for, from before this click.
    market.value = { ...market.value, list: [] } as unknown as Market & Held;
    await nextTick();
    expect(value.value).toEqual(['ticked']);

    pending.resolve(['ticked']);
    await saving;
    expect(value.value).toEqual(['ticked']);
  });

  it('follows a re-read when nothing is being written', async () => {
    const market = ref({ id: 'm1', list: [] } as unknown as Market & Held);
    const { value } = useSavedOnTheMarket<string>(
      market,
      (held) => (held as unknown as Held).list,
      async (_id, next) => next,
      'failed',
    );

    market.value = { ...market.value, list: ['from another tab'] } as unknown as Market & Held;
    await nextTick();
    expect(value.value).toEqual(['from another tab']);
  });
});
