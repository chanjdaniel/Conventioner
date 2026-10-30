<script setup lang="ts">
/**
 * The organization's own changes, newest first: Manage organization's History section
 * (E40/F02/S01). Its people, its name, ownership handed on, the markets created in it and its
 * default rows, worded as the market's history words them and read a page at a time, as
 * `MarketHistory.vue` reads; an organization's changes are few, so it is not filtered.
 */
import { ref, watch } from 'vue';
import HistoryEntries from '@/components/HistoryEntries.vue';
import { api, getApiErrorMessage } from '@/utils/api';
import type { MarketHistoryEntry } from '@/utils/marketHistory';

const props = defineProps<{ orgId: string }>();

interface HistoryPage {
  entries: MarketHistoryEntry[];
  next: string | null;
  /** The table's rows by label, on the first page, for a change to the default rows. */
  rowLabels?: Record<string, string>;
}

const entries = ref<MarketHistoryEntry[]>([]);
const next = ref<string | null>(null);
const labels = ref<Record<string, string>>({});
const loading = ref(false);
const loadingMore = ref(false);
const loadError = ref('');

async function read(before: string | null): Promise<HistoryPage> {
  const asked = before ? `?${new URLSearchParams({ before })}` : '';
  const response = await api.get<HistoryPage>(
    `/organizations/${encodeURIComponent(props.orgId)}/history${asked}`,
  );
  return response.data;
}

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    const page = await read(null);
    entries.value = page.entries ?? [];
    next.value = page.next ?? null;
    labels.value = page.rowLabels ?? {};
  } catch (err) {
    loadError.value = getApiErrorMessage(err, 'The history could not be loaded.');
    entries.value = [];
    next.value = null;
  } finally {
    loading.value = false;
  }
}

async function loadMore(): Promise<void> {
  if (!next.value || loadingMore.value) return;
  loadingMore.value = true;
  loadError.value = '';
  try {
    const page = await read(next.value);
    entries.value = [...entries.value, ...(page.entries ?? [])];
    next.value = page.next ?? null;
  } catch (err) {
    loadError.value = getApiErrorMessage(err, 'Older changes could not be loaded.');
  } finally {
    loadingMore.value = false;
  }
}

watch(() => props.orgId, load, { immediate: true });
</script>

<template>
  <div class="org-history" data-testid="org-history">
    <p v-if="loading" class="history-note">Loading…</p>
    <p v-else-if="loadError && !entries.length" class="form-error" data-testid="org-history-error">
      {{ loadError }}
    </p>
    <p v-else-if="!entries.length" class="history-note" data-testid="org-history-empty">
      Nothing has changed on this organization yet.
    </p>

    <HistoryEntries
      v-if="!loading && entries.length"
      :entries="entries"
      testid="org-history"
      :labels="labels"
    />

    <p v-if="loadError && entries.length" class="form-error" data-testid="org-history-error">
      {{ loadError }}
    </p>
    <button
      v-if="!loading && next"
      type="button"
      class="btn btn--secondary history-more"
      :disabled="loadingMore"
      data-testid="org-history-load-more"
      @click="loadMore"
    >
      {{ loadingMore ? 'Loading…' : 'Load more' }}
    </button>
  </div>
</template>

<style scoped>
.org-history {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.history-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.form-error {
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-xs);
}

.history-more {
  align-self: flex-start;
}
</style>
