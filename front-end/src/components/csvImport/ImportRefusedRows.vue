<script setup lang="ts">
/**
 * The rows of a file the import refuses, the preview's and the done step's: the first 20, "Show all
 * N", and a find field past 12, so a bad file does not push the confirm 361 rows down (T223, L10).
 * The heading that counts them, and what to do about them, are each step's to say.
 */
import ListFrame from '@/components/ListFrame.vue';
import { findsRefusedRow, IMPORT_LIST_FIRST } from '@/utils/importPreview';

export interface RefusedRow {
  row: number;
  /** Empty on a row that names nobody, as a blank row does. */
  email: string;
  error: string;
}

defineProps<{
  rows: RefusedRow[];
  testid: string;
  rowTestid: string;
}>();
</script>

<template>
  <ListFrame
    class="refused-rows"
    :items="rows"
    :finds="findsRefusedRow"
    :item-key="(failure) => String(failure.row)"
    :noun="{ one: 'row', many: 'rows' }"
    :page-size="IMPORT_LIST_FIRST"
    show-all
    find-label="Find by address, row number or reason"
    :testid="testid"
  >
    <template #rows="{ rows: shown }">
      <ul class="refused-rows__list">
        <li
          v-for="failure in shown"
          :key="failure.row"
          data-list-row
          tabindex="-1"
          :data-testid="rowTestid"
        >
          <strong>Row {{ failure.row }}</strong>
          <span v-if="failure.email"> ({{ failure.email }})</span>: {{ failure.error }}
        </li>
      </ul>
    </template>
  </ListFrame>
</template>

<style scoped>
.refused-rows {
  margin-top: var(--space-2);
}

.refused-rows__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding-left: var(--space-6);
  font-size: var(--text-xs);
}
</style>
