/**
 * The open market, exactly as the server last reported it (E21/F02/S01).
 *
 * The back end is the only source of truth about a market. This is its one holder in the browser:
 * every market screen, the phase rail and every tab read the market from here, and nothing else
 * keeps a copy of its own. It used to be held three ways at once - a view's ref, a value one tab
 * published for its siblings, and `localStorage` - written by eleven call sites that each patched
 * their own copy, which is how the form builder came to ignore a phase change until the organizer
 * left the tab (the-market-frame ticket 02).
 *
 * The rules, from the-market-frame ticket 03:
 *
 * - **Keyed by the route's id.** A market held for one id is never shown while another is open,
 *   not even for a frame; an answer for a market no longer open is dropped.
 * - **Fetched on every arrival**, and re-read (`refresh`) after every write that changes the market.
 *   Nothing patches what is held: a write is followed by asking the server, so no caller needs to
 *   know which fields its write touched.
 * - **What it holds is shown while a re-read of the same market is in flight**, so returning to a
 *   screen or saving does not blank it.
 * - **A missing market and one the organizer cannot reach read identically.** Anything else that
 *   fails is `failed`, and `refresh` is the retry.
 * - An editor's unsaved work is the editor's own working copy, never layered on this.
 */
import axios from 'axios';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Market } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { parseMarketFromApi } from '@/utils/market';
import { forgetLastMarket, lastMarketId, rememberLastMarket } from '@/utils/lastMarket';

export type MarketStatus = 'idle' | 'loading' | 'loaded' | 'failed' | 'missing';

export const useMarketStore = defineStore('market', () => {
  const marketId = ref<string | null>(null);
  const held = ref<Market | null>(null);
  const status = ref<MarketStatus>('idle');

  /** Bumped by every fetch, so an answer to an earlier one can tell it has been overtaken. */
  let generation = 0;

  /** Only ever the market for the id that is open. */
  const market = computed<Market | null>(() =>
    held.value && held.value.id === marketId.value ? held.value : null,
  );

  async function refresh(): Promise<void> {
    const id = marketId.value;
    if (!id) return;
    const mine = ++generation;
    if (!market.value) status.value = 'loading';
    try {
      const response = await api.get(`/markets/${encodeURIComponent(id)}`);
      if (mine !== generation) return;
      held.value = parseMarketFromApi(response.data.market);
      status.value = 'loaded';
      // Arriving at a market is what opening one means, so this is the one place the dashboard's
      // pointer is set - by the list, a link, a bookmark or a new market alike.
      rememberLastMarket(id);
    } catch (err: unknown) {
      if (mine !== generation) return;
      held.value = null;
      const code = axios.isAxiosError(err) ? err.response?.status : undefined;
      status.value = code === 404 || code === 403 ? 'missing' : 'failed';
      if (status.value === 'missing' && lastMarketId() === id) forgetLastMarket();
    }
  }

  /** Open a market by id, or re-read it when it is the one already open. */
  function open(id: string): Promise<void> {
    if (id !== marketId.value) {
      marketId.value = id;
      held.value = null;
    }
    return refresh();
  }

  /** Forget the market entirely - on signing out, so one account never sees another's. */
  function clear(): void {
    generation++;
    marketId.value = null;
    held.value = null;
    status.value = 'idle';
  }

  return { marketId, market, status, open, refresh, clear };
});
