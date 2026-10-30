<script setup lang="ts">
/**
 * Rows of an import's file, as the applications they will become: a list of rows that expand
 * (E38/F03/S01, layout A of the walk's prototype, chosen over a list beside a detail pane).
 *
 * Each row is headed by who it is and its file row, so the organizer can find it in their
 * spreadsheet, and opens to the answers as the review card lays them out (`ApplicationAnswers`):
 * a preview row should read like the application it becomes. A row the automatic rejections
 * reject (E38/F03/S02) opens led by the reason the review will show on it.
 *
 * A heading is a native `summary`, so it is a disclosure to the keyboard and to a reader, and it
 * takes the shared focus treatment with no rule of its own.
 */
import type { AnswerRow } from '@/utils/essentialFields';
import ApplicationAnswers from '@/components/application/ApplicationAnswers.vue';
import IconExpandDown from '@/components/icons/IconExpandDown.vue';

export interface ImportRow {
  /** The row's number in the file, its header row being row 1. */
  row: number;
  email: string;
  /** The name to call them by, or empty: the heading then reads the address alone. */
  name: string;
  leading: AnswerRow[];
  rest: AnswerRow[];
  /** Why an automatic rejection rejects it, in the review's words; absent on a row it does not. */
  reason?: string;
}

defineProps<{
  rows: ImportRow[];
  /** Opens the first row, so the list shows what a row holds without a click. */
  openFirst?: boolean;
  rowTestid: string;
}>();
</script>

<template>
  <div class="import-rows">
    <details
      v-for="(item, index) in rows"
      :key="item.row"
      class="import-row"
      :open="openFirst && index === 0"
      :data-testid="rowTestid"
    >
      <summary class="import-row-heading">
        <IconExpandDown class="import-row-caret" aria-hidden="true" />
        <span class="import-row-who">
          <span class="import-row-name" data-testid="import-row-name">{{
            item.name || item.email
          }}</span>
          <span v-if="item.name" class="import-row-email" data-testid="import-row-email">{{
            item.email
          }}</span>
        </span>
        <span class="import-row-meta">
          <span v-if="item.reason" class="chip chip--destructive">Rejected</span>
          <span class="import-row-number" data-testid="import-row-number">Row {{ item.row }}</span>
        </span>
      </summary>
      <div class="import-row-body">
        <p v-if="item.reason" class="import-row-reason" data-testid="import-row-reason">
          <strong>Rejected automatically:</strong>{{ ' ' }}<span>{{ item.reason }}</span>
        </p>
        <ApplicationAnswers :leading="item.leading" :rest="item.rest" :testid="rowTestid" />
      </div>
    </details>
  </div>
</template>

<style scoped>
/* Not clipped to its rounded corners (no `overflow: hidden`): a focused heading's halo is drawn
   outside its box, and a clipped one would be cut at the list's edge. */
.import-rows {
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
}

.import-row + .import-row {
  border-top: 1px solid var(--mm-border);
}

.import-row-heading {
  list-style: none;
  display: grid;
  grid-template-columns: var(--space-4) minmax(0, 1fr) auto;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-3) var(--space-4);
  cursor: pointer;
}

/* A hovered heading's beige, and a focused one's halo, keep to the list's own rounded corners. */
.import-row:first-child > .import-row-heading {
  border-start-start-radius: var(--radius-card);
  border-start-end-radius: var(--radius-card);
}

.import-row:last-child:not([open]) > .import-row-heading {
  border-end-start-radius: var(--radius-card);
  border-end-end-radius: var(--radius-card);
}

.import-row-heading::-webkit-details-marker {
  display: none;
}

/* A hovered row is beige, as across the product, so the heading's muted ink is the beige-safe one. */
.import-row-heading:hover {
  background: var(--mm-beige);
}

.import-row-caret {
  width: var(--space-4);
  height: var(--space-4);
  color: var(--mm-text-muted-on-beige);
  transform: rotate(-90deg);
  transition: transform 0.12s ease;
}

.import-row[open] > .import-row-heading .import-row-caret {
  transform: none;
}

.import-row-who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.import-row-name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-row-email {
  font-size: var(--text-xs);
  color: var(--mm-text-muted-on-beige);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-row-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.import-row-number {
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--mm-text-muted-on-beige);
  white-space: nowrap;
}

/* Under the heading's text, not its caret, and clear of the heading by `--space-2`, so what opens
   never sits squashed against the row's title (Daniel's note on the prototype). */
.import-row-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4) var(--space-4)
    calc(var(--space-4) + var(--space-4) + var(--space-3));
}

.import-row-reason {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  background: var(--mm-chip-destructive);
  color: var(--mm-text-red-on-tint);
  font-size: var(--text-xs);
}

.import-row-reason strong {
  font-weight: 600;
}

/* A phone has no room to indent the answers under the name: they take the row's width. */
@media (width <= 640px) {
  .import-row-body {
    padding-left: var(--space-4);
  }
}
</style>
