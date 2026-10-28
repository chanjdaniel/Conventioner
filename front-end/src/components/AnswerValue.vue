<script setup lang="ts">
import { computed } from 'vue';
import { answerSegments } from '@/utils/answerLinks';

/** One answer as written, with each web address in it a link (see `utils/answerLinks.ts`). */
const props = defineProps<{ value: string }>();

const segments = computed(() => answerSegments(props.value));
</script>

<template>
  <template v-for="(segment, index) in segments" :key="index">
    <a
      v-if="segment.href"
      :href="segment.href"
      target="_blank"
      rel="noopener noreferrer"
      class="answer-link"
      :class="{ 'answer-link--alone': segments.length === 1 }"
      data-testid="answer-link"
      >{{ segment.text }}</a
    >
    <template v-else>{{ segment.text }}</template>
  </template>
</template>

<style scoped>
/* AA on white and on the beige review card alike (contrast.test.ts holds it to both). */
.answer-link {
  color: var(--mm-text-link);
  text-decoration: underline;
  text-underline-offset: 2px;
  /* An address has no spaces to wrap at, and a long one ran 108px past a phone (T79). */
  overflow-wrap: anywhere;
}

/* An answer that is only an address is a link on its own line, so on a phone it is a thumb's
   target (T82); one inside a sentence stays in the sentence's line, and a desk keeps the line. */
@media (width <= 640px) {
  .answer-link--alone {
    display: inline-flex;
    align-items: center;
    min-height: var(--target-min);
  }
}
</style>
