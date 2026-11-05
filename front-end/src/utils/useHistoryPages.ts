/**
 * Reading a history a page at a time, newest first (T224): the first page, the next, and the one
 * guard both need, that a page answered after something newer was asked for is dropped. The screen
 * brings `read`, which holds its filters, and draws the rest through `PagedList`.
 */
import { ref } from 'vue';
import { getApiErrorMessage } from '@/utils/api';
import type { MarketHistoryEntry } from '@/utils/marketHistory';

export interface HistoryPage {
  entries?: MarketHistoryEntry[];
  next?: string | null;
}

export function useHistoryPages<Page extends HistoryPage>(options: {
  /** Reads one page: the newest with no cursor, else the page that cursor names. */
  read: (before: string | null) => Promise<Page>;
  /** What a first page says whatever it was narrowed by: called even for one overtaken by a newer. */
  firstPage?: (page: Page) => void;
  /** What a next page adds beyond its entries; never called for one overtaken. */
  nextPage?: (page: Page) => void;
}) {
  const entries = ref<MarketHistoryEntry[]>([]);
  const next = ref<string | null>(null);
  const loading = ref(false);
  const loadingMore = ref(false);
  const loadError = ref('');
  /** Counts the first pages read, so a new one can draw its entries closed. */
  const firstPages = ref(0);

  let asking = 0;

  /** Drops what is on its way and shows nothing, for a screen that knows there is nothing to ask. */
  function clear(): void {
    asking++;
    loadError.value = '';
    entries.value = [];
    next.value = null;
    loading.value = false;
    loadingMore.value = false;
  }

  /** The first page; any page asked for before it is dropped. */
  async function load(): Promise<void> {
    const mine = ++asking;
    loadError.value = '';
    loading.value = true;
    loadingMore.value = false;
    try {
      const page = await options.read(null);
      options.firstPage?.(page);
      if (mine !== asking) return;
      entries.value = page.entries ?? [];
      next.value = page.next ?? null;
      firstPages.value++;
    } catch (err) {
      if (mine !== asking) return;
      loadError.value = getApiErrorMessage(err, 'The history could not be loaded.');
      entries.value = [];
      next.value = null;
    } finally {
      if (mine === asking) loading.value = false;
    }
  }

  /** The next page, beneath what is there; does nothing with none to read or one on its way. */
  async function more(): Promise<void> {
    if (!next.value || loading.value || loadingMore.value) return;
    const mine = asking;
    loadingMore.value = true;
    loadError.value = '';
    try {
      const page = await options.read(next.value);
      if (mine !== asking) return;
      entries.value = [...entries.value, ...(page.entries ?? [])];
      next.value = page.next ?? null;
      options.nextPage?.(page);
    } catch (err) {
      if (mine !== asking) return;
      loadError.value = getApiErrorMessage(err, 'Older changes could not be loaded.');
    } finally {
      if (mine === asking) loadingMore.value = false;
    }
  }

  return { entries, next, loading, loadingMore, loadError, firstPages, load, more, clear };
}
