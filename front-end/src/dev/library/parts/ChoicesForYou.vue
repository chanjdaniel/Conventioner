<script setup lang="ts">
/**
 * What an entry leaves for Daniel to decide, at its end: one item each, so the answers go straight
 * into T191's fix plan.
 */
import { useId } from 'vue';

const id = useId();
</script>

<template>
  <section class="choices-for-you note" :aria-labelledby="id" data-testid="choices-for-you">
    <h2 :id="id" class="choices-for-you__title">Choices for you</h2>
    <ul class="choices-for-you__list">
      <slot />
    </ul>
  </section>
</template>

<style scoped>
.choices-for-you {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.choices-for-you__title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}

.choices-for-you__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding-left: var(--space-4);
}
</style>
