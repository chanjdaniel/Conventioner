<script setup lang="ts">
/**
 * One part of an entry (the buttons, the fields), its heading in the page's order under the entry's
 * title, an optional line saying where it is used or what it serves, and its panels in a grid that
 * is one column on a phone.
 */
import { useId } from 'vue';

defineProps<{ title: string; about?: string }>();

const id = useId();
</script>

<template>
  <section class="library-section" :aria-labelledby="id">
    <h2 :id="id" class="library-section__title">{{ title }}</h2>
    <p v-if="about" class="library-section__about">{{ about }}</p>
    <div class="library-section__panels">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.library-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.library-section__title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--mm-black);
}

.library-section__about {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.library-section__panels {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
  gap: var(--space-3);
  align-items: start;
}
</style>
