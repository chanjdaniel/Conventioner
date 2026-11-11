<script setup lang="ts">
/**
 * The organization's own changes, newest first: Manage organization's History section
 * (E40/F02/S01). Its people, its name, ownership handed on, the markets created in it or deleted
 * and its floorplan templates, worded as the market's history words them and read a page at a
 * time in a box of its own, as `MarketHistory.vue` reads; an organization's changes are few, so it
 * is not filtered.
 */
import { computed, ref, watch } from 'vue';
import HistoryEntries from '@/components/HistoryEntries.vue';
import PagedList from '@/components/PagedList.vue';
import ReadFailed from '@/components/ReadFailed.vue';
import { api } from '@/utils/api';
import type { HistoryContext } from '@/utils/marketHistory';
import { useHistoryPages, type HistoryPage } from '@/utils/useHistoryPages';

const props = defineProps<{
  orgId: string;
  /** Counts the changes the dialog holding it has made: each reads the first page again, so the
   * change shows without reopening the dialog. */
  changesMade?: number;
}>();

interface OrganizationHistoryPage extends HistoryPage {
  /** The table's rows by label, on the first page, for a change to the default rows. */
  rowLabels?: Record<string, string>;
}

const labels = ref<Record<string, string>>({});

/** What the entries' words are given, one input a line. */
const context = computed<HistoryContext>(() => ({
  labels: labels.value,
}));

async function read(before: string | null): Promise<OrganizationHistoryPage> {
  const asked = before ? `?${new URLSearchParams({ before })}` : '';
  const response = await api.get<OrganizationHistoryPage>(
    `/organizations/${encodeURIComponent(props.orgId)}/history${asked}`,
  );
  return response.data;
}

const { entries, next, loading, loadingMore, loadError, load, more } =
  useHistoryPages<OrganizationHistoryPage>({
    read,
    firstPage(page) {
      labels.value = page.rowLabels ?? {};
    },
  });

watch(() => props.orgId, load, { immediate: true });
watch(() => props.changesMade, load);
</script>

<template>
  <div class="org-history" data-testid="org-history">
    <p v-if="loading" class="history-note">Loading…</p>
    <ReadFailed
      v-else-if="loadError && !entries.length"
      name="org-history"
      :message="loadError"
      @retry="load"
    />
    <p v-else-if="!entries.length" class="history-note" data-testid="org-history-empty">
      Nothing has changed on this organization yet.
    </p>

    <!-- Only with entries to stand in it, so a new first page starts the box at its top. -->
    <PagedList
      v-if="!loading && entries.length"
      :has-more="!!next"
      :loading="loadingMore"
      :error="loadError"
      label="History"
      testid="org-history"
      @more="more"
    >
      <HistoryEntries :entries="entries" testid="org-history" :context="context" />
    </PagedList>
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
</style>
