<script setup lang="ts">
/**
 * Conditions on a vendor's answers to the market's choice questions: one builder, used by the
 * automatic rejections (E33/F03/S01) and by each price group on the Pricing card (E43/F01/S02).
 *
 * A condition names one choice question and the answers that meet it. Which questions may carry
 * one, and which answers each offers, are the server's (`rejectionQuestions` on the market, from
 * `back-end/rejection_rules.py`, which judges both). The whole list is emitted on every change.
 *
 * A condition on a question the form no longer asks, or on an answer it no longer offers, is drawn
 * broken, with what is missing, so it can be changed or removed: the server leaves what a rule names
 * that the form no longer has out of it, and keeps such a price group's condition, which then holds
 * the market in draft.
 */
import { computed, ref } from 'vue';
import type { AnswerCondition, RejectionQuestion } from '@/assets/types/datatypes';
import { brokenCondition } from '@/utils/choiceConditions';

const props = defineProps<{
  questions: RejectionQuestion[];
  conditions: AnswerCondition[];
  /** Shown, not changed: settled, or a person who may not change it. */
  fixed: boolean;
  /** Prefixes every `data-testid` and the question select's `id`. */
  testid: string;
  /** What one is called on the screen: "rule", "condition". */
  noun: string;
  /** The words before and after a condition's question: "Reject when … is". */
  before?: string;
  after: string;
  /** Said under a condition with no answer ticked yet. */
  unticked: string;
  /** Who the conditions are for, read after a control's own words: "from Example College student only". */
  owner?: string;
  /** A ticked answer rejects, drawn red; otherwise it meets the condition, drawn green. */
  rejects?: boolean;
}>();

const emit = defineEmits<{ 'update:conditions': [conditions: AnswerCondition[]] }>();

const byKey = computed(() => new Map(props.questions.map((q) => [q.key, q])));
/** A condition's question, or a stand-in for one the form no longer has, so it can be removed: its
 * label went with it, and its key is a slug nobody wrote to be read. */
const questionOf = (condition: AnswerCondition): RejectionQuestion =>
  byKey.value.get(condition.key) ?? {
    key: condition.key,
    label: 'A question no longer on the form',
    answers: [],
  };
/** The answers drawn for a condition: what the question offers, then any it named that is gone. */
function answersOf(condition: AnswerCondition) {
  const offered = questionOf(condition).answers;
  const gone = condition.answers
    .filter((value) => !offered.some((answer) => answer.value === value))
    .map((value) => ({ value, label: value, gone: true }));
  return [...offered.map((answer) => ({ ...answer, gone: false })), ...gone];
}
const unused = computed(() =>
  props.questions.filter((q) => !props.conditions.some((condition) => condition.key === q.key)),
);
const chosen = ref('');

function add() {
  if (!chosen.value) return;
  emit('update:conditions', [...props.conditions, { key: chosen.value, answers: [] }]);
  chosen.value = '';
}

function remove(key: string) {
  emit(
    'update:conditions',
    props.conditions.filter((condition) => condition.key !== key),
  );
}

function toggle(key: string, answer: string, meets: boolean) {
  emit(
    'update:conditions',
    props.conditions.map((condition) =>
      condition.key !== key
        ? condition
        : {
            key,
            answers: meets
              ? [...condition.answers, answer]
              : condition.answers.filter((value) => value !== answer),
          },
    ),
  );
}
</script>

<template>
  <div class="conditions" :class="{ 'conditions--reject': rejects }">
    <div
      v-for="condition in conditions"
      :key="condition.key"
      class="condition"
      :class="{ broken: brokenCondition(questions, condition) }"
      :data-testid="`${testid}-rule-${condition.key}`"
    >
      <div class="condition-head">
        <span class="condition-question">
          {{ before }} <strong>{{ questionOf(condition).label }}</strong> {{ after }}
        </span>
        <button
          v-if="!fixed"
          type="button"
          class="btn btn--secondary btn--compact"
          :data-testid="`${testid}-rule-remove-${condition.key}`"
          @click="remove(condition.key)"
        >
          Remove<span class="visually-hidden">
            the {{ noun }} on {{ questionOf(condition).label }}{{ owner ? ` ${owner}` : '' }}</span
          >
        </button>
      </div>
      <div class="condition-answers">
        <label
          v-for="answer in answersOf(condition)"
          :key="answer.value"
          class="condition-answer"
          :class="{ meets: condition.answers.includes(answer.value), gone: answer.gone }"
          :data-testid="`${testid}-answer-${condition.key}-${answer.value}`"
        >
          <input
            type="checkbox"
            :checked="condition.answers.includes(answer.value)"
            :disabled="fixed"
            @change="
              toggle(condition.key, answer.value, ($event.target as HTMLInputElement).checked)
            "
          />
          <span>{{ answer.label }}</span>
        </label>
      </div>
      <p
        v-if="!byKey.has(condition.key)"
        class="condition-broken"
        :data-testid="`${testid}-broken-${condition.key}`"
      >
        The form no longer asks this question. Remove this {{ noun }}.
      </p>
      <p
        v-else-if="brokenCondition(questions, condition)"
        class="condition-broken"
        :data-testid="`${testid}-broken-${condition.key}`"
      >
        The form no longer offers an answer ticked here. Untick it, or remove this {{ noun }}.
      </p>
      <p v-else-if="!fixed && !condition.answers.length" class="conditions-empty">
        {{ unticked }}
      </p>
    </div>

    <div v-if="!fixed && unused.length" class="condition-add">
      <label class="condition-add-label" :for="`${testid}-question`">Add a {{ noun }} on</label>
      <select
        :id="`${testid}-question`"
        v-model="chosen"
        class="field field--select"
        :data-testid="`${testid}-rule-question`"
      >
        <option value="" disabled>Choose a question</option>
        <option v-for="question in unused" :key="question.key" :value="question.key">
          {{ question.label }}
        </option>
      </select>
      <button
        type="button"
        class="btn btn--secondary"
        :disabled="!chosen"
        :data-testid="`${testid}-rule-add`"
        @click="add"
      >
        Add {{ noun }}<span v-if="owner" class="visually-hidden"> {{ owner }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.conditions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.conditions-empty {
  margin: 0;
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--mm-text-muted);
}

.condition {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
}

.condition.broken {
  border-color: var(--mm-red);
}

.condition-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.condition-question {
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.condition-question strong {
  font-weight: 600;
}

.condition-head .btn {
  margin-left: auto;
}

.condition-answers {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.condition-answer {
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

.condition-answer.meets {
  border-color: var(--mm-green);
}

.conditions--reject .condition-answer.meets {
  border-color: var(--mm-red);
}

.condition-answer.gone {
  border-style: dashed;
  border-color: var(--mm-red);
  color: var(--mm-red);
}

.condition-broken {
  margin: 0;
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--mm-red);
}

/* The label, the select and the button in one row packed to the start, wrapping where the column is
   narrow (a price group's, beside its prices on a 1000px screen) rather than squeezing the select to
   a sliver: it grows to 24rem and never shrinks below 12rem. */
.condition-add {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.condition-add .field--select {
  flex: 1 1 12rem;
  min-width: 12rem;
  max-width: 24rem;
}

.condition-add-label {
  white-space: nowrap;
  font-size: var(--text-sm);
  color: var(--mm-black);
}
</style>
