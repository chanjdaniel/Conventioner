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
    const pending = deferred<{ list: string[]; none: boolean }>();
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

    pending.resolve({ list: ['ticked'], none: false });
    await saving;
    expect(value.value).toEqual(['ticked']);
  });

  it('follows a re-read when nothing is being written', async () => {
    const market = ref({ id: 'm1', list: [] } as unknown as Market & Held);
    const { value } = useSavedOnTheMarket<string>(
      market,
      (held) => (held as unknown as Held).list,
      async (_id, list, none) => ({ list, none }),
      'failed',
    );

    market.value = { ...market.value, list: ['from another tab'] } as unknown as Market & Held;
    await nextTick();
    expect(value.value).toEqual(['from another tab']);
  });
});

/**
 * "None" as a decision (T206): an empty list says nobody marked anything, so the organizer's choice
 * of none is a flag stored beside it, written by its own one click and replaced by the next mark.
 */
type Decided = { list: string[]; none?: boolean };

describe('none, chosen beside a list saved on the market', () => {
  function decided(start: Decided) {
    const market = ref({ id: 'm1', ...start } as unknown as Market & Decided);
    const write = vi.fn(async (_id: string, list: string[], none: boolean) => ({ list, none }));
    const saved = useSavedOnTheMarket<string>(
      market,
      (held) => (held as unknown as Decided).list,
      write,
      'failed',
      (held) => Boolean((held as unknown as Decided).none),
    );
    return { market, write, ...saved };
  }

  it('reads the choice as the market holds it', () => {
    expect(decided({ list: [], none: true }).none.value).toBe(true);
    expect(decided({ list: [] }).none.value).toBe(false);
  });

  it('writes the empty list with the choice in one write', async () => {
    const { write, value, none, chooseNone } = decided({ list: [] });

    await chooseNone();

    expect(write).toHaveBeenCalledWith('m1', [], true);
    expect(value.value).toEqual([]);
    expect(none.value).toBe(true);
  });

  it('replaces the choice with the next mark', async () => {
    const { write, none, save } = decided({ list: [], none: true });

    await save(['stall']);

    expect(write).toHaveBeenCalledWith('m1', ['stall'], false);
    expect(none.value).toBe(false);
  });

  it('puts the choice back when its write fails', async () => {
    const { write, none, error, chooseNone } = decided({ list: [] });
    write.mockRejectedValueOnce(new Error('offline'));

    await chooseNone();

    expect(none.value).toBe(false);
    expect(error.value).not.toBe('');
  });

  it('follows a re-read of the choice when nothing is being written', async () => {
    const { market, none } = decided({ list: [] });

    market.value = { ...market.value, none: true } as unknown as Market & Decided;
    await nextTick();

    expect(none.value).toBe(true);
  });
});
