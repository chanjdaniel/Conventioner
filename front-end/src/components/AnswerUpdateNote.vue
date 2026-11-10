<script setup lang="ts">
/**
 * Beside an answer an organizer updated (E41/F01/S01): who updated it, when, and what the vendor
 * wrote; and, when what they wrote has changed since (a re-import, or their own edit), that it has,
 * or that it now matches the update, compared as the server and Update info compare them.
 * The answer itself already reads as updated: the server serves it in its place. Nothing beside an
 * answer that is the vendor's own.
 */
import { computed } from 'vue';
import type { AnswerUpdate } from '@/assets/types/datatypes';
import { CHANGED_SINCE, NOW_MATCHES, sameAnswer, updatedLine } from '@/utils/answerUpdates';
import { answerText } from '@/utils/essentialFields';

const props = defineProps<{
  update: AnswerUpdate | null | undefined;
  testid: string;
}>();

const line = computed(() =>
  props.update ? updatedLine(props.update, answerText(props.update.theyWrote)) : '',
);

const changed = computed(() =>
  props.update && sameAnswer(props.update.theyWrote, props.update.value)
    ? NOW_MATCHES
    : CHANGED_SINCE,
);
</script>

<template>
  <template v-if="update">
    <p class="answer-updated" :data-testid="`${testid}-updated`">{{ line }}</p>
    <p v-if="update.changedSince" class="answer-changed" :data-testid="`${testid}-changed`">
      {{ changed }}
    </p>
  </template>
</template>

<style scoped>
.answer-updated,
.answer-changed {
  margin: var(--space-hairline) 0 0;
  font-size: var(--text-xs);
  white-space: normal;
}

.answer-updated {
  /* The review card's ground is beige, the drawer's white: the on-beige ink reads on both. */
  color: var(--mm-text-muted-on-beige);
}

/* Something to act on: their own answer moved under the update, or to it. */
.answer-changed {
  color: var(--mm-black);
  font-weight: 600;
}
</style>
