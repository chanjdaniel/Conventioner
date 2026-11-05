<script setup lang="ts">
/**
 * Every change to a permission table, newest first (E39/F01/S04): the row, or the whole table, each
 * row's role before and after, and who changed it when. They stand in a box of bounded height, so a
 * long record does not push the rest of the dialog away, and it shows 25 more as its end comes into
 * view, from the rows the screen read whole, since a table's changes are few.
 *
 * Under Manage market's Permissions dialog's rows, and Manage organization's default permissions
 * (E39/F02/S01). The words are `changeLines`'.
 */
import { computed, ref } from 'vue';
import PagedList from '@/components/PagedList.vue';
import { type PermissionTableRow } from '@/assets/types/datatypes';
import { changeLines, type PermissionHistoryEntry } from '@/utils/permissionTable';
import { getFormattedTimestamp } from '@/utils/utils';

const props = defineProps<{
  entries: PermissionHistoryEntry[];
  /** The table the entries are about, which names each row by its label. */
  table: PermissionTableRow[];
  /** Why the changes could not be read, said in their place. */
  error: string;
  /** Prefixes every test id: `manage-market-permission`, `manage-org-permission`. */
  testid: string;
}>();

/** As many at a time as the market's History pages (E40/F01/S03). */
const PAGE = 25;
const shown = ref(PAGE);

const changes = computed(() =>
  props.entries
    .slice(0, shown.value)
    .map((entry) => ({ entry, ...changeLines(entry, props.table) })),
);
</script>

<template>
  <h3 class="subheading">Changes</h3>
  <p v-if="error" class="error">{{ error }}</p>
  <p v-else-if="!changes.length" class="hint">No changes yet.</p>
  <PagedList
    v-else
    :has-more="entries.length > shown"
    label="Changes"
    :testid="`${testid}-changes`"
    @more="shown += PAGE"
  >
    <ol class="rows" :data-testid="`${testid}-changes`">
      <li
        v-for="{ entry, title, rows } in changes"
        :key="entry.id"
        class="change"
        :data-testid="`${testid}-change`"
      >
        <span class="label change-title">{{ title }}</span>
        <span v-for="line in rows" :key="line" class="change-line">{{ line }}</span>
        <span class="caption">{{ entry.actor }}, {{ getFormattedTimestamp(entry.at) }}</span>
      </li>
    </ol>
  </PagedList>
</template>

<style scoped>
.subheading {
  margin: var(--space-4) 0 var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
}

.hint {
  margin: 0;
  color: var(--mm-text-muted);
  font-size: var(--text-xs);
}

.error {
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-xs);
}

.rows {
  list-style: none;
  margin: 0;
  padding: 0;
}

.label {
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.caption {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.change {
  display: flex;
  flex-direction: column;
  gap: var(--space-hairline);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--mm-border);
}

/* The box's own border closes the list. */
.change:last-child {
  border-bottom: 0;
}

/* The row an entry is about leads it, so a list of entries does not read as one run of lines. */
.change-title {
  font-weight: 600;
}

.change-line {
  font-size: var(--text-sm);
  color: var(--mm-black);
}
</style>
