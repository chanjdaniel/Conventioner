<script setup lang="ts">
/**
 * Which answers reject an application automatically (E33/F03/S01).
 *
 * A rule names one choice question and the answers to it that reject. Which questions may carry a
 * rule, and which answers each offers, are the server's (`rejectionQuestions` on the market, from
 * `back-end/rejection_rules.py`): this draws them and writes the whole list on every change, as the
 * highlights beside it do. Settled rules - the market has reached Assignment - are shown fixed,
 * with the reason.
 */
import { computed, ref } from 'vue';
import type { RejectionQuestion, RejectionRule } from '@/assets/types/datatypes';

const props = defineProps<{
  questions: RejectionQuestion[];
  rules: RejectionRule[];
  /** Why the rules can no longer change, or null while they can. */
  lockReason: string | null;
  /** True for a person who may not change the market at all; the step says why. */
  disabled?: boolean;
  /**
   * Who may overturn an automatic rejection on this market, from its table: "an Admin or the
   * owner" (E38/F06/S01). Null when the market read carries no such row.
   */
  overturnedBy?: string | null;
}>();

const emit = defineEmits<{ 'update:rules': [rules: RejectionRule[]] }>();

const capitalized = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);
const fixed = computed(() => props.disabled || !!props.lockReason);
const byKey = computed(() => new Map(props.questions.map((q) => [q.key, q])));
/** A rule's question, or a stand-in for one the form no longer has, so it can still be removed. */
const questionOf = (rule: RejectionRule): RejectionQuestion =>
  byKey.value.get(rule.key) ?? { key: rule.key, label: rule.key, answers: [] };
const unruled = computed(() =>
  props.questions.filter((q) => !props.rules.some((rule) => rule.key === q.key)),
);
const chosen = ref('');

function add() {
  if (!chosen.value) return;
  emit('update:rules', [...props.rules, { key: chosen.value, answers: [] }]);
  chosen.value = '';
}

function remove(key: string) {
  emit(
    'update:rules',
    props.rules.filter((rule) => rule.key !== key),
  );
}

function toggle(key: string, answer: string, rejects: boolean) {
  emit(
    'update:rules',
    props.rules.map((rule) =>
      rule.key !== key
        ? rule
        : {
            key,
            answers: rejects
              ? [...rule.answers, answer]
              : rule.answers.filter((value) => value !== answer),
          },
    ),
  );
}
</script>

<template>
  <div class="rejections" data-testid="automatic-rejections">
    <p class="rejections-help">
      An application that gives one of these answers arrives in review already rejected, with the
      reason.
      <template v-if="overturnedBy">
        {{ capitalized(overturnedBy) }} can overturn it, and the applicant never sees the reason.
      </template>
      <template v-else>The applicant never sees the reason.</template>
    </p>
    <p v-if="lockReason" class="rejections-locked" data-testid="rejection-rules-locked">
      {{ lockReason }}
    </p>

    <p v-if="!rules.length && fixed" class="rejections-empty">No answer rejects automatically.</p>

    <div
      v-for="rule in rules"
      :key="rule.key"
      class="rejection-rule"
      :data-testid="`rejection-rule-${rule.key}`"
    >
      <div class="rejection-rule-head">
        <span class="rejection-rule-question">
          Reject when <strong>{{ questionOf(rule).label }}</strong> is
        </span>
        <button
          v-if="!fixed"
          type="button"
          class="btn btn--secondary btn--compact"
          :aria-label="`Remove the rule on ${questionOf(rule).label}`"
          :data-testid="`rejection-rule-remove-${rule.key}`"
          @click="remove(rule.key)"
        >
          Remove
        </button>
      </div>
      <div class="rejection-answers">
        <label
          v-for="answer in questionOf(rule).answers"
          :key="answer.value"
          class="rejection-answer"
          :class="{ rejects: rule.answers.includes(answer.value) }"
          :data-testid="`rejection-answer-${rule.key}-${answer.value}`"
        >
          <input
            type="checkbox"
            :checked="rule.answers.includes(answer.value)"
            :disabled="fixed"
            @change="toggle(rule.key, answer.value, ($event.target as HTMLInputElement).checked)"
          />
          <span>{{ answer.label }}</span>
        </label>
      </div>
      <p v-if="!fixed && !rule.answers.length" class="rejections-empty">
        Tick the answers that reject. Until one is ticked, this rule rejects nobody.
      </p>
    </div>

    <div v-if="!fixed && unruled.length" class="rejection-add">
      <label class="rejection-add-label" for="rejection-rule-question">Add a rule on</label>
      <select
        id="rejection-rule-question"
        v-model="chosen"
        class="field field--select"
        data-testid="rejection-rule-question"
      >
        <option value="" disabled>Choose a question</option>
        <option v-for="question in unruled" :key="question.key" :value="question.key">
          {{ question.label }}
        </option>
      </select>
      <button
        type="button"
        class="btn btn--secondary"
        :disabled="!chosen"
        data-testid="rejection-rule-add"
        @click="add"
      >
        Add rule
      </button>
    </div>
    <p v-else-if="!fixed && !questions.length" class="rejections-empty">
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

.rejection-rule {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
}

.rejection-rule-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.rejection-rule-question {
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.rejection-rule-question strong {
  font-weight: 600;
}

.rejection-rule-head .btn {
  margin-left: auto;
}

.rejection-answers {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.rejection-answer {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
}

.rejection-answer.rejects {
  border-color: var(--mm-red);
}

.rejection-add {
  align-items: center;
  gap: var(--space-2);
}

.rejection-add-label {
  font-size: var(--text-sm);
  color: var(--mm-black);
}

/* The select sizes from its column, as the primitive asks: the column is the add row's middle. */
.rejection-add {
  display: grid;
  grid-template-columns: auto minmax(0, 24rem) auto;
}
</style>
