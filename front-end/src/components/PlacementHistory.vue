<script setup lang="ts">
/**
 * The placement trail: who changed a placement, to what, and when (`E11/F04/S01`), across the
 * market, in the Assignment history dialog. One vendor's changes, placements among them, are the
 * market's history narrowed to them, in their drawer (`MarketHistory`, E40/F01/S04).
 */
import { ref, watch } from 'vue';
import { api } from '@/utils/api';
import { type VendorNames } from '@/utils/vendorIdentity';
import {
  historyDate,
  historyParts,
  historyWhen,
  type PlacementHistoryEntry,
} from '@/utils/placementHistory';

const props = defineProps<{ marketId: string }>();

const entries = ref<PlacementHistoryEntry[]>([]);
const vendorNames = ref<VendorNames>({});
const isLoading = ref(false);
const loadError = ref('');

async function load(): Promise<void> {
  if (!props.marketId) return;
  isLoading.value = true;
  loadError.value = '';
  try {
    const resp = await api.get<{ entries: PlacementHistoryEntry[]; vendorNames: VendorNames }>(
      `/markets/${encodeURIComponent(props.marketId)}/placement-history`,
    );
    entries.value = Array.isArray(resp.data?.entries) ? resp.data.entries : [];
    vendorNames.value = resp.data?.vendorNames ?? {};
  } catch {
    // A trail that cannot be read is worth saying so about, but it never blocks the screen it
    // sits on: nothing an organizer does depends on it.
    loadError.value = 'The assignment history could not be loaded.';
    entries.value = [];
  } finally {
    isLoading.value = false;
  }
}

watch(() => props.marketId, load, { immediate: true });
</script>

<template>
  <section class="placement-history" data-testid="placement-history">
    <p v-if="isLoading" class="placement-history-note">Loading…</p>
    <p v-else-if="loadError" class="placement-history-note">{{ loadError }}</p>
    <p v-else-if="entries.length === 0" class="placement-history-note">
      No assignments have been changed yet.
    </p>

    <ol v-else class="placement-history-list">
      <li
        v-for="entry in entries"
        :key="entry.id"
        class="placement-history-entry"
        :data-kind="entry.kind"
        data-testid="placement-history-entry"
      >
        <p class="placement-history-what">
          <template v-for="(part, index) in historyParts(entry, vendorNames)" :key="index">
            <template v-if="part.kind === 'text'">{{ part.text }}</template>
            <span v-else class="placement-history-vendor" data-testid="placement-history-vendor"
              >{{ part.name || part.email
              }}<template v-if="part.name"
                >{{ ' ' }}<span class="placement-history-email">{{ part.email }}</span></template
              ></span
            >
          </template>
        </p>
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
.placement-history-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.placement-history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.placement-history-entry {
  border-left: 3px solid var(--mm-border);
  padding: var(--space-2) 0 var(--space-2) var(--space-3);
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
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

/* The email beside the name, muted, so the line still reads as a sentence (E35/F03/S03). */
.placement-history-email {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.placement-history-who {
  margin: var(--space-hairline) 0 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}
</style>
