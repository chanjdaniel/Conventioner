<script setup lang="ts">
/**
 * Which answers a reviewer reads first (E19/F03/S01).
 *
 * ONE list covering both kinds of answer, because that is the point of this living on the market
 * rather than on a form field: the essential answers are derived from the plan and are not
 * `FormField`s at all, so a flag on a field could only ever have marked half the card.
 *
 * Authored here, and adjustable from the review queue (`S02`) - which is where an organizer
 * actually finds out, because the form has frozen by then.
 *
 * A flag, not a rank. Most markets want two or three answers at the top and are not drawing a
 * finer distinction than that; ranking is more to author for something nobody is saying.
 */
import { computed } from 'vue';
import { askedEssentialAnswers } from '@/utils/essentialFields';
import type { EssentialFormOptions, FormField } from '@/assets/types/datatypes';

const props = defineProps<{
  fields: FormField[];
  essentialOptions: EssentialFormOptions;
  highlights: string[];
  disabled?: boolean;
}>();

const emit = defineEmits<{ (event: 'update:highlights', value: string[]): void }>();

/** The organizer's own questions first, then the essential ones - the card's own order. */
const offered = computed(() => [
  ...props.fields
    .filter((field) => field.key)
    .map((field) => ({ key: field.key, label: field.label || field.key, custom: true })),
  ...askedEssentialAnswers(props.essentialOptions).map((answer) => ({ ...answer, custom: false })),
]);

/**
 * Anything already marked that this screen would not otherwise offer, so a mark can always be
 * taken off where it is found.
 *
 * The two screens that show this control describe different moments: the builder offers what the
 * plan asks right now, the review queue offers the offering FROZEN onto the form. A key marked in
 * one and absent from the other's list would be a mark the reviewer can see leading the card and
 * has no way to remove - and removing it is the whole of E19/F03/S02.
 */
const strays = computed(() => {
  const known = new Set(offered.value.map((candidate) => candidate.key));
  return props.highlights
    .filter((key) => !known.has(key))
    .map((key) => ({
      key,
      label: key.replace(/^essential_/, '').replace(/_/g, ' '),
      custom: true,
    }));
});

const candidates = computed(() => [...offered.value, ...strays.value]);

function marked(key: string): boolean {
  return props.highlights.includes(key);
}

function toggle(key: string, on: boolean) {
  if (props.disabled) return;
  // Order matters: it is the order the card leads with, so a newly marked answer goes last.
  emit(
    'update:highlights',
    on ? [...props.highlights, key] : props.highlights.filter((k) => k !== key),
  );
}
</script>

<template>
  <div class="highlights" data-testid="review-highlights">
    <p class="highlights-help">
      A reviewer reads these first, and everything else folds away behind them. Leave it empty and
      the card shows every answer, as it always has.
    </p>

    <p v-if="!candidates.length" class="highlights-empty" data-testid="review-highlights-empty">
      This market asks nothing yet, so there is nothing to put first.
    </p>

    <label
      v-for="candidate in candidates"
      :key="candidate.key"
      class="highlight-choice"
      :class="{ marked: marked(candidate.key), disabled }"
      :data-testid="`review-highlight-${candidate.key}`"
    >
      <input
        type="checkbox"
        :checked="marked(candidate.key)"
        :disabled="disabled"
        @change="toggle(candidate.key, ($event.target as HTMLInputElement).checked)"
      />
      <span class="highlight-label">{{ candidate.label }}</span>
      <span v-if="!candidate.custom" class="highlight-kind">asked by every market</span>
    </label>
  </div>
</template>

<style scoped>
.highlights {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
}

.highlights-help,
.highlights-empty {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  line-height: 1.4;
}

.highlight-choice {
  display: flex;
  align-items: center;
  gap: var(--space-2);

  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
  cursor: pointer;
}

.highlight-choice.marked {
  border-color: var(--mm-green);
}

.highlight-choice.disabled {
  cursor: not-allowed;
  background: var(--mm-beige);
}

.highlight-label {
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.highlight-kind {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
