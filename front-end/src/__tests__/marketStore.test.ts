import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { MarketPhase } from '@/assets/types/datatypes';

/**
 * The open market, exactly as the server last reported it (E21/F02/S01).
 *
 * One holder, keyed by the id in the route. It fetches on arrival and after every write, never
 * patches what it holds, and never shows a market held for one id while another is open.
 */

type Pending = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };
const calls: Array<{ url: string } & Pending> = [];

vi.mock('@/utils/api', () => ({
  api: {
    get: (url: string) =>
      new Promise((resolve, reject) => {
        calls.push({ url, resolve, reject });
      }),
  },
}));

import { useMarketStore } from '@/stores/market';

const apiMarket = (id: string, fields: Record<string, unknown> = {}) => ({
  data: {
    market: {
      id,
      name: `Market ${id}`,
      creationDate: '2026-01-01T00:00:00Z',
      roles: {},
      modificationList: [],
      assignmentObject: { vendorAssignments: [] },
      phase: 'draft',
      ...fields,
    },
  },
});

const httpError = (status: number) => ({ isAxiosError: true, response: { status } });

/** Let the store's awaits run after a mocked response settles. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the market store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    calls.length = 0;
  });

  it('fetches the market it is opened on and holds it as the server reported it', async () => {
    const store = useMarketStore();

    const opened = store.open('m1');
    expect(store.status).toBe('loading');
    expect(calls[0].url).toBe('/markets/m1');
    calls[0].resolve(apiMarket('m1', { phase: 'applications_open' }));
    await opened;

    expect(store.status).toBe('loaded');
    expect(store.market?.id).toBe('m1');
    expect(store.market?.phase).toBe(MarketPhase.ApplicationsOpen);
  });

  it('never shows the market it held for another id, not even while loading', async () => {
    const store = useMarketStore();
    const first = store.open('m1');
    calls[0].resolve(apiMarket('m1'));
    await first;

    void store.open('m2');

    expect(store.market).toBeNull();
    expect(store.status).toBe('loading');
  });

  it('ignores an answer for a market that is no longer open', async () => {
    const store = useMarketStore();
    const slow = store.open('m1');
    const fast = store.open('m2');
    calls[1].resolve(apiMarket('m2'));
    await fast;
    calls[0].resolve(apiMarket('m1'));
    await slow;

    expect(store.market?.id).toBe('m2');
  });

  it('keeps showing what it holds while it re-reads the same market', async () => {
    const store = useMarketStore();
    const opened = store.open('m1');
    calls[0].resolve(apiMarket('m1'));
    await opened;

    const reread = store.refresh();
    expect(store.market?.id).toBe('m1');
    expect(store.status).toBe('loaded');

    calls[1].resolve(apiMarket('m1', { phase: 'applications_open' }));
    await reread;
    expect(store.market?.phase).toBe(MarketPhase.ApplicationsOpen);
  });

  it('re-opening the market already open re-reads it rather than blanking it', async () => {
    const store = useMarketStore();
    const opened = store.open('m1');
    calls[0].resolve(apiMarket('m1'));
    await opened;

    void store.open('m1');

    expect(store.market?.id).toBe('m1');
    expect(calls).toHaveLength(2);
  });

  it('reads a market that does not exist and one the organizer cannot reach identically', async () => {
    for (const status of [404, 403]) {
      setActivePinia(createPinia());
      calls.length = 0;
      const store = useMarketStore();
      const opened = store.open('m1');
      calls[0].reject(httpError(status));
      await opened;

      expect(store.status).toBe('missing');
      expect(store.market).toBeNull();
    }
  });

  it('says a fetch failed, and a retry recovers', async () => {
    const store = useMarketStore();
    const opened = store.open('m1');
    calls[0].reject(httpError(500));
    await opened;
    expect(store.status).toBe('failed');
    expect(store.market).toBeNull();

    const retried = store.refresh();
    calls[1].resolve(apiMarket('m1'));
    await retried;
    expect(store.status).toBe('loaded');
    expect(store.market?.id).toBe('m1');
  });

  /**
   * A re-read that fails for a reason other than the market being gone must not take the market
   * away: every screen renders from it, so dropping it unmounts the tabs - and with them any unsaved
   * working copy, such as a form being built - over a dropped connection (code review of E21).
   */
  it('keeps what it holds when a re-read of the same market fails in transit', async () => {
    const store = useMarketStore();
    const opened = store.open('m1');
    calls[0].resolve(apiMarket('m1'));
    await opened;

    const reread = store.refresh();
    calls[1].reject(httpError(500));
    await reread;

    expect(store.market?.id).toBe('m1');
    expect(store.status).toBe('loaded');
    expect(store.stale).toBe(true);

    const recovered = store.refresh();
    calls[2].resolve(apiMarket('m1'));
    await recovered;
    expect(store.stale).toBe(false);
  });

  it('lets go of a market that has gone, even one it was holding', async () => {
    const store = useMarketStore();
    const opened = store.open('m1');
    calls[0].resolve(apiMarket('m1'));
    await opened;

    const reread = store.refresh();
    calls[1].reject(httpError(404));
    await reread;

    expect(store.market).toBeNull();
    expect(store.status).toBe('missing');
  });

  it('forgets everything when cleared, so the next account is never shown this market', async () => {
    const store = useMarketStore();
    const opened = store.open('m1');
    calls[0].resolve(apiMarket('m1'));
    await opened;

    store.clear();
    await settle();

    expect(store.market).toBeNull();
    expect(store.marketId).toBeNull();
    expect(store.status).toBe('idle');
  });
});
