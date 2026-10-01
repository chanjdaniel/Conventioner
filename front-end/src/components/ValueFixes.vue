<script setup lang="ts">
/**
 * Values a file holds that the market does not have, each fixed where it stands: mapped to one of
 * the market's own values, or ignored (E01, extracted for E24/F03/S02).
 *
 * The import's control, and the proposal ledger's for a tier or a date the plan does not have:
 * one control, so an organizer settles a stray value the same way wherever they meet one.
 */
import { computed, ref } from 'vue';
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
    /** Test id prefix, the view's own: `<testid>-value-fixes`, `-unmatched-value`, `-fix-<value>`. */
    testid?: string;
    /**
     * Values already decided rather than waiting on a decision (bug 28): listed so a decision -
     * restored from the last import, saved by the proposal, or made a moment ago - can be seen and
     * changed, in a quiet box because nothing here is wrong.
     */
    decided?: boolean;
  }>(),
  {
    labelFor: (_target: string, choice: string) => choice,
    against: 'your market',
    testid: 'import',
    decided: false,
  },
);
const emit = defineEmits<{ resolve: [target: string, value: string, choice: string] }>();

/**
 * A long list of decisions is shown a few at a time. A market started from its Google Form can
 * carry a hundred "ignore" decisions for one question, and listing every one buried the column
 * rows under thousands of pixels of them. Values still waiting on a decision are always all shown.
 */
const FIRST_DECIDED = 6;
const expanded = ref(false);
const shown = computed(() =>
  props.decided && !expanded.value ? props.entries.slice(0, FIRST_DECIDED) : props.entries,
);

function choose(entry: ValueFix, event: Event) {
  emit('resolve', entry.target, entry.value, (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <div
    class="ledger-fixes"
    :class="{ 'ledger-fixes--decided': decided }"
    :data-testid="`${testid}-value-fixes`"
  >
    <p v-if="decided" class="ledger-fixes-title">
      {{ entries.length }} value{{ entries.length === 1 ? '' : 's' }} already decided - change any
      that are wrong
    </p>
    <p v-else class="ledger-fixes-title">
      {{ entries.length }} value{{ entries.length === 1 ? '' : 's' }} did not match
      {{ against }}
    </p>
    <div v-for="entry in shown" :key="`${entry.target}-${entry.value}`" class="ledger-fix">
      <code :data-testid="`${testid}-unmatched-value`">{{ entry.value }}</code>
      <span v-if="entry.rows !== undefined" class="ledger-fix-rows"
        >{{ entry.rows }} row{{ entry.rows === 1 ? '' : 's' }}</span
      >
      <select
        class="field field--select ledger-fix-select"
        :value="props.resolutionFor(entry.target, entry.value)"
        :data-testid="`${testid}-fix-${entry.value}`"
        @change="choose(entry, $event)"
      >
        <option value="">Choose…</option>
        <option v-for="choice in entry.offered" :key="choice" :value="choice">
          {{ props.labelFor(entry.target, choice) }}
        </option>
        <option :value="IGNORE_VALUE">Ignore this value</option>
      </select>
    </div>
    <button
      v-if="decided && entries.length > FIRST_DECIDED"
      type="button"
      class="btn btn--compact btn--secondary ledger-fixes-more"
      :data-testid="`${testid}-show-all`"
      @click="expanded = !expanded"
    >
      {{ expanded ? 'Show fewer' : `Show all ${entries.length}` }}
    </button>
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

.ledger-fixes-more {
  margin-top: var(--space-2);
}

.ledger-fixes--decided {
  border-color: var(--mm-border);
  background: var(--mm-beige);
}

.ledger-fixes--decided .ledger-fixes-title {
  color: var(--mm-text-muted);
}

.ledger-fixes--decided .ledger-fix code {
  background: white;
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

/* The field primitive, as wide as its words rather than the row. */
.ledger-fix-select {
  width: auto;
}
</style>
