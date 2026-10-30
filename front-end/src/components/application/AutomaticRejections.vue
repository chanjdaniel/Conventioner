<script setup lang="ts">
/**
 * Which answers reject an application automatically (E33/F03/S01).
 *
 * A rule names one choice question and the answers to it that reject, drawn by the one condition
 * builder the price groups use too (`ChoiceConditions.vue`). Which questions may carry a rule, and
 * which answers each offers, are the server's (`rejectionQuestions` on the market, from
 * `back-end/rejection_rules.py`): this writes the whole list on every change, as the highlights
 * beside it do. Settled rules - the market has reached Assignment - are shown fixed, with the reason.
 */
import { computed } from 'vue';
import type { RejectionQuestion, RejectionRule } from '@/assets/types/datatypes';
import ChoiceConditions from '@/components/application/ChoiceConditions.vue';

const props = defineProps<{
  questions: RejectionQuestion[];
  rules: RejectionRule[];
  /** Why the rules can no longer change, or null while they can. */
  lockReason: string | null;
  /** True for a person who may not change the market at all; the step says why. */
  disabled?: boolean;
}>();

const emit = defineEmits<{ 'update:rules': [rules: RejectionRule[]] }>();

const fixed = computed(() => props.disabled || !!props.lockReason);
</script>

<template>
  <div class="rejections" data-testid="automatic-rejections">
    <p class="rejections-help">
      An application that gives one of these answers arrives in review already rejected, with the
      reason. A reviewer can overturn it, and the applicant never sees the reason.
    </p>
    <p v-if="lockReason" class="rejections-locked" data-testid="rejection-rules-locked">
      {{ lockReason }}
    </p>

    <p v-if="!rules.length && fixed" class="rejections-empty">No answer rejects automatically.</p>

    <ChoiceConditions
      :questions="questions"
      :conditions="rules"
      :fixed="fixed"
      testid="rejection"
      noun="rule"
      before="Reject when"
      after="is"
      unticked="Tick the answers that reject. Until one is ticked, this rule rejects nobody."
      rejects
      @update:conditions="(next) => emit('update:rules', next)"
    />
    <p v-if="!fixed && !questions.length" class="rejections-empty">
      This market asks no question with answers to choose from, so nothing can reject automatically.
    </p>
  </div>
</template>

<style scoped>
.rejections {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
}

.rejections-help,
.rejections-empty {
  margin: 0;
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--mm-text-muted);
}

.rejections-locked {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-yellow);
  border-radius: var(--radius-control);
  background: var(--mm-chip-attention);
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--mm-text-yellow-on-tint);
}
</style>
