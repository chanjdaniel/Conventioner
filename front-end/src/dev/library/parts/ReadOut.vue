<script setup lang="ts">
/**
 * The line under a live demo that reads out its value ("Chosen: Ana Ceramics, Ben Prints"), so a
 * choice is seen to land. An empty value reads "nothing".
 */
import { computed } from 'vue';

const props = defineProps<{ label: string; value: string | readonly string[] | null }>();

const shown = computed(() => {
  const value = props.value;
  const text = Array.isArray(value) ? value.join(', ') : (value ?? '');
  return text === '' ? 'nothing' : text;
});
</script>

<template>
  <p class="read-out" data-testid="read-out" aria-live="polite">
    {{ label }}: <span class="read-out__value">{{ shown }}</span>
  </p>
</template>

<style scoped>
.read-out {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.read-out__value {
  color: var(--mm-black);
}
</style>
