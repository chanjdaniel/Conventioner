<script setup lang="ts">
/**
 * Values a file holds that the market does not have, each fixed where it stands: mapped to one of
 * the market's own values, or ignored (E01, extracted for E24/F03/S02).
 *
 * The import's control, and the proposal ledger's for a tier or a date the plan does not have:
 * one control, so an organizer settles a stray value the same way wherever they meet one. Each
 * value is a `ChoiceField`, so a question of many answers finds one by typing (T223), and a fix can
 * only name an answer the question offers: the import stores what a fix names, and the row would be
 * refused at the preview otherwise.
 */
import { computed, ref } from 'vue';
import ChoiceField from '@/components/ChoiceField.vue';
import type { PickerGroup } from '@/components/SearchPicker.vue';
import { IGNORE_VALUE } from '@/utils/valueFixes';

export interface ValueFix {
  target: string;
  value: string;
  /** How many rows hold it, when known. */
  rows?: number;
  offered: string[];
  /** Who decided it, when that was not the organizer: "set aside when your form was started". */
  decidedBy?: string;
}

const props = withDefaults(
  defineProps<{
    entries: ValueFix[];
    resolutionFor: (target: string, value: string) => string;
    /** What a choice is called; the same words for the same two arguments, since it is kept. */
    labelFor?: (target: string, choice: string) => string;
    /** What the values did not match, as the organizer calls it. */
    against?: string;
    /**
     * The view's own prefix: test ids `<testid>-value-fixes`, `-unmatched-value`, `-fix-<value>`, and
     * a select's field name, `<testid>-fix-<target>-<value>`.
     */
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

/**
 * Whose decisions these are, said once for the list: a market started from its Google Form can
 * carry a hundred of the start's, and a note on each buried the values (E30/F02/S01).
 */
const decidedTitle = computed(() => {
  const count = props.entries.length;
  const values = `${count} value${count === 1 ? '' : 's'}`;
  const by = new Set(props.entries.map((entry) => entry.decidedBy));
  const [only] = by;
  if (by.size === 1 && only) return `${values} ${only}`;
  const theirs = props.entries.filter((entry) => entry.decidedBy).length;
  if (theirs === 0) return `${values} already decided`;
  return `${values} already decided, ${theirs} when your form was started`;
});

/**
 * The rows offered one set of answers share one list of choices, kept across renders since the view
 * hands over new entries each time: 142 values among 129 answers build it once. Keyed by the answers
 * as well as the target, as one target can offer two sets: a tier grid's day headings are offered
 * the dates, and its cells the tiers (bug 26).
 */
const choiceLists = new Map<string, PickerGroup[]>();
function choicesFor({ target, offered }: ValueFix): PickerGroup[] {
  const key = JSON.stringify([target, offered]);
  let choices = choiceLists.get(key);
  if (!choices) {
    choices = [
      {
        options: [
          { value: IGNORE_VALUE, label: 'Ignore this value' },
          ...offered.map((value) => ({ value, label: props.labelFor(target, value) })),
        ],
      },
    ];
    choiceLists.set(key, choices);
  }
  return choices;
}
</script>

<template>
  <div
    class="ledger-fixes"
    :class="{ 'ledger-fixes--decided': decided }"
    :data-testid="`${testid}-value-fixes`"
  >
    <p v-if="decided" class="ledger-fixes-title" :data-testid="`${testid}-title`">
      {{ decidedTitle }} - change any that are wrong
    </p>
    <p v-else class="ledger-fixes-title">
      {{ entries.length }} value{{ entries.length === 1 ? '' : 's' }} did not match
      {{ against }}
    </p>
    <div v-for="entry in shown" :key="`${entry.target}-${entry.value}`" class="ledger-fix">
      <code :data-testid="`${testid}-unmatched-value`">{{ entry.value }}</code>
      <!-- Always a cell, even empty, so every control sits in the same column. -->
      <span class="ledger-fix-rows"
        ><template v-if="entry.rows !== undefined"
          >{{ entry.rows }} row{{ entry.rows === 1 ? '' : 's' }}</template
        ></span
      >
      <!-- A question's answers decide the control, "Ignore this value" apart: 12 stay a select. -->
      <ChoiceField
        :model-value="props.resolutionFor(entry.target, entry.value)"
        :groups="choicesFor(entry)"
        :whole-count="entry.offered.length"
        :label="`What ${entry.value} means`"
        :name="`${testid}-fix-${entry.target}-${entry.value}`"
        :testid="`${testid}-fix-${entry.value}`"
        placeholder="Choose…"
        hide-label
        writes
        @update:model-value="emit('resolve', entry.target, entry.value, $event)"
      />
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
/*
 * One grid for every value, so the controls line up in a column of their own (bug 43). Each row was
 * its own flex line, so each "Choose…" started wherever its value ended, and a long value pushed it
 * onto a line of its own.
 */
.ledger-fixes {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(9rem, 14rem);
  align-items: center;
  gap: var(--space-1) var(--space-2);
  margin-top: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--mm-red);
  border-radius: var(--radius-control);
  /* Opaque, so a grid row's tint does not darken it past what its ink is chosen for. */
  background: var(--mm-chip-destructive);
}

.ledger-fixes-title,
.ledger-fixes-more {
  grid-column: 1 / -1;
}

.ledger-fixes-title {
  margin: 0;
  font-size: var(--text-xs);
  /* `--mm-red` is 4.41 on this ground. */
  color: var(--mm-text-red-on-tint);
}

.ledger-fixes-more {
  justify-self: start;
  margin-top: var(--space-1);
}

.ledger-fixes--decided {
  border-color: var(--mm-border);
  background: var(--mm-beige);
}

/* Muted on beige needs the beige's own muted ink to stay AA (E31/F04). */
.ledger-fixes--decided .ledger-fixes-title {
  color: var(--mm-text-muted-on-beige);
}

.ledger-fixes--decided .ledger-fix code {
  background: white;
}

/* Its three cells are the grid's own, which is what lines them up across values. */
.ledger-fix {
  display: contents;
}

.ledger-fix code {
  justify-self: start;
  overflow-wrap: anywhere;
  padding: var(--space-hairline) var(--space-1);
  border-radius: var(--radius-control);
  background: var(--mm-beige);
  font-size: var(--text-xs);
}

.ledger-fix-rows {
  font-size: var(--text-xs);
  /* Its ground is the red tint or beige: `--mm-text-muted` is 4.24 on the tint. */
  color: var(--mm-text-muted-on-beige);
  white-space: nowrap;
}
</style>
