<script setup lang="ts">
/**
 * The placement trail: who changed a placement, to what, and when (`E11/F04/S01`).
 *
 * One component, two surfaces - the whole market's log on the assignment tab, and one vendor's
 * entries on their detail panel. It is the same list asking the same question of a different
 * scope, and building it twice would let the two drift.
 */
import { computed, ref, watch } from 'vue';
import { api } from '@/utils/api';
import { type VendorNames } from '@/utils/vendorIdentity';
import {
  historyDate,
  historySummary,
  historyWhen,
  type PlacementHistoryEntry,
} from '@/utils/placementHistory';

const props = defineProps<{
  marketId: string;
  /** Narrow to one person's entries, for their panel. Omitted, the whole market's trail. */
  vendor?: string | null;
  /** How the vendor list words a heading it may not want at all. */
  heading?: string;
}>();

const entries = ref<PlacementHistoryEntry[]>([]);
const vendorNames = ref<VendorNames>({});
const isLoading = ref(false);
const loadError = ref('');

async function load(): Promise<void> {
  if (!props.marketId) return;
  isLoading.value = true;
  loadError.value = '';
  try {
    const query = props.vendor ? `?vendor=${encodeURIComponent(props.vendor)}` : '';
    const resp = await api.get<{ entries: PlacementHistoryEntry[]; vendorNames: VendorNames }>(
      `/markets/${encodeURIComponent(props.marketId)}/placement-history${query}`,
    );
    entries.value = Array.isArray(resp.data?.entries) ? resp.data.entries : [];
    vendorNames.value = resp.data?.vendorNames ?? {};
  } catch {
    // A trail that cannot be read is worth saying so about, but it never blocks the screen it
    // sits on: nothing an organizer does depends on it.
    loadError.value = 'The placement history could not be loaded.';
    entries.value = [];
  } finally {
    isLoading.value = false;
  }
}

watch(() => [props.marketId, props.vendor], load, { immediate: true });
defineExpose({ reload: load });

const emptyText = computed(() =>
  props.vendor
    ? 'Nobody has changed this vendor’s placement.'
    : 'No placements have been changed yet.',
);
</script>

<template>
  <section class="placement-history" data-testid="placement-history">
    <h3 v-if="heading" class="placement-history-title">{{ heading }}</h3>

    <p v-if="isLoading" class="placement-history-note">Loading…</p>
    <p v-else-if="loadError" class="placement-history-note">{{ loadError }}</p>
    <p v-else-if="entries.length === 0" class="placement-history-note">{{ emptyText }}</p>

    <ol v-else class="placement-history-list">
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="placement-history-entry"
        :data-kind="entry.kind"
        data-testid="placement-history-entry"
      >
        <p class="placement-history-what">{{ historySummary(entry, vendorNames) }}</p>
        <p class="placement-history-who">
          {{ entry.actor }} - {{ historyWhen(entry) }}
          <span v-if="historyDate(entry)" class="placement-history-for">
            for {{ historyDate(entry) }}
          </span>
        </p>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.placement-history-title {
  margin: 0 0 8px;
  font-family: 'Merge One', sans-serif;
  font-size: 15px;
  color: var(--mm-green);
}

.placement-history-note {
  margin: 0;
  font-size: 13px;
  color: var(--mm-text-muted);
}

.placement-history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.placement-history-entry {
  border-left: 3px solid var(--mm-border);
  padding: 6px 0 6px 10px;
}

/* A machine row reads quieter than a hand edit: the hand edits are the ones anyone came for. */
.placement-history-entry[data-kind='assigned'] {
  border-left-color: var(--mm-text-muted);
}

.placement-history-entry[data-kind='placed'],
.placement-history-entry[data-kind='swapped'] {
  border-left-color: var(--mm-green);
}

.placement-history-entry[data-kind='freed'] {
  border-left-color: var(--mm-yellow);
}

.placement-history-what {
  margin: 0;
  font-size: 14px;
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.placement-history-who {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}
</style>
