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
const candidates = computed(() => [
  ...props.fields
    .filter((field) => field.key)
    .map((field) => ({ key: field.key, label: field.label || field.key, custom: true })),
  ...askedEssentialAnswers(props.essentialOptions).map((answer) => ({ ...answer, custom: false })),
]);

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
