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
}
</style>
