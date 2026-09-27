<script setup lang="ts">
/**
 * Values a file holds that the market does not have, each fixed where it stands: mapped to one of
 * the market's own values, or ignored (E01, extracted for E24/F03/S02).
 *
 * The import's control, and the proposal ledger's for a tier or a date the plan does not have:
 * one control, so an organizer settles a stray value the same way wherever they meet one.
 */
import { IGNORE_VALUE } from '@/utils/valueFixes';

export interface ValueFix {
  target: string;
  value: string;
  /** How many rows hold it, when known. */
  rows?: number;
  offered: string[];
}

const props = withDefaults(
  defineProps<{
    entries: ValueFix[];
    resolutionFor: (target: string, value: string) => string;
    labelFor?: (target: string, choice: string) => string;
    /** What the values did not match, as the organizer calls it. */
    against?: string;
  }>(),
  { labelFor: (_target: string, choice: string) => choice, against: 'your market' },
);
const emit = defineEmits<{ resolve: [target: string, value: string, choice: string] }>();

function choose(entry: ValueFix, event: Event) {
  emit('resolve', entry.target, entry.value, (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <div class="ledger-fixes" data-testid="import-value-fixes">
    <p class="ledger-fixes-title">
      {{ entries.length }} value{{ entries.length === 1 ? '' : 's' }} did not match
      {{ against }}
    </p>
    <div v-for="entry in entries" :key="`${entry.target}-${entry.value}`" class="ledger-fix">
      <code data-testid="import-unmatched-value">{{ entry.value }}</code>
      <span v-if="entry.rows !== undefined" class="ledger-fix-rows"
        >{{ entry.rows }} row{{ entry.rows === 1 ? '' : 's' }}</span
      >
      <select
        class="ledger-fix-select"
        :value="props.resolutionFor(entry.target, entry.value)"
        :data-testid="`import-fix-${entry.value}`"
        @change="choose(entry, $event)"
      >
        <option value="">Choose…</option>
        <option v-for="choice in entry.offered" :key="choice" :value="choice">
          {{ props.labelFor(entry.target, choice) }}
        </option>
        <option :value="IGNORE_VALUE">Ignore this value</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.ledger-fixes {
  margin-top: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--mm-red);
  border-radius: var(--radius-control);
  background: rgba(192, 57, 43, 0.14);
}

.ledger-fixes-title {
  margin: 0 0 var(--space-1);
  font-size: var(--text-xs);
  color: var(--mm-red);
}

.ledger-fix {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-1);
}

.ledger-fix code {
  padding: var(--space-hairline) var(--space-1);
  border-radius: var(--radius-control);
  background: var(--mm-beige);
  font-size: var(--text-xs);
}

.ledger-fix-rows {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.ledger-fix-select {
  height: 30px;
  padding: var(--space-hairline) var(--space-1);
  font-size: var(--text-xs);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
}
</style>
