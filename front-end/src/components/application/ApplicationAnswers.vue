<script setup lang="ts">
/**
 * An application's answers as an organizer reads them: what the market said a reviewer reads first
 * (E19/F03/S01), then the rest behind "N more answers".
 *
 * The one layout of them, so the review card and the import preview's rows (E38/F03/S01) read an
 * application the same way, rather than each with a style of its own.
 *
 * The rest folds away ONLY when something leads. A market that marked nothing shows every answer
 * as one list: an empty list of highlights is not a reason to hide an application. The label
 * names the HIDDEN count, not the total: the question before the click is "what am I not being
 * shown?".
 */
import type { AnswerRow } from '@/utils/essentialFields';
import AnswerValue from '@/components/AnswerValue.vue';

defineProps<{
  leading: AnswerRow[];
  rest: AnswerRow[];
  /** The prefix of every testid here: `<testid>-leading`, `-rest`, `-answer-<key>`. */
  testid: string;
}>();

/** Whether the rest is open: bound by a screen that keeps it open across applications. */
const restOpen = defineModel<boolean>('restOpen', { default: false });

defineSlots<{
  /** What reads under an answer's value: the review card's note of an organizer's update. */
  note?(props: { answer: AnswerRow }): unknown;
}>();
</script>

<template>
  <div v-if="leading.length || rest.length" class="application-answers">
    <dl v-if="leading.length" class="answers" :data-testid="`${testid}-leading`">
      <template v-for="answer in leading" :key="answer.key">
        <dt>{{ answer.label }}</dt>
        <dd :data-testid="`${testid}-answer-${answer.key}`">
          <AnswerValue :value="answer.value" />
          <slot name="note" :answer="answer" />
        </dd>
      </template>
    </dl>

    <details
      v-if="leading.length && rest.length"
      class="answers-rest"
      :open="restOpen"
      :data-testid="`${testid}-rest`"
      @toggle="restOpen = ($event.target as HTMLDetailsElement).open"
    >
      <summary :data-testid="`${testid}-rest-summary`">
        {{ rest.length }} more {{ rest.length === 1 ? 'answer' : 'answers' }}
      </summary>
      <dl class="answers">
        <template v-for="answer in rest" :key="answer.key">
          <dt>{{ answer.label }}</dt>
          <dd :data-testid="`${testid}-answer-${answer.key}`">
            <AnswerValue :value="answer.value" />
            <slot name="note" :answer="answer" />
          </dd>
        </template>
      </dl>
    </details>

    <dl v-else-if="!leading.length" class="answers" :data-testid="`${testid}-answers`">
      <template v-for="answer in rest" :key="answer.key">
        <dt>{{ answer.label }}</dt>
        <dd :data-testid="`${testid}-answer-${answer.key}`">
          <AnswerValue :value="answer.value" />
          <slot name="note" :answer="answer" />
        </dd>
      </template>
    </dl>
  </div>
</template>

<style scoped>
.application-answers {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* The beige-safe muted ink for the labels: the review card's ground is beige, and on white it
   reads darker still. */
.answers {
  display: grid;
  grid-template-columns: minmax(0, 13rem) minmax(0, 1fr);
  gap: var(--space-2) var(--space-4);
  margin: 0;
  font-size: var(--text-sm);
}

.answers dt {
  color: var(--mm-text-muted-on-beige);
  overflow-wrap: anywhere;
}

.answers dd {
  margin: 0;
  color: var(--mm-black);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

/* The unmarked answers. Set apart from the marked ones above it by a rule, so the list reads as
   "these first, then the rest" rather than as one long list that happens to fold. */
.answers-rest {
  border-top: 1px solid var(--mm-border);
  padding-top: var(--space-3);
}

.answers-rest summary {
  font-size: var(--text-sm);
  color: var(--mm-text-muted-on-beige);
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.answers-rest summary::-webkit-details-marker {
  display: none;
}

/* Its own marker, because the native one is hidden above to keep the row on one baseline. */
.answers-rest summary::before {
  content: '▸';
  font-size: var(--text-xs);
  transition: transform 0.12s ease;
}

.answers-rest[open] summary::before {
  transform: rotate(90deg);
}

.answers-rest summary:hover {
  color: var(--mm-black);
}

.answers-rest .answers {
  margin-top: var(--space-3);
}

@media (max-width: 640px) {
  .answers {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-hairline) 0;
  }

  .answers dd {
    margin-bottom: var(--space-3);
  }
}
</style>
