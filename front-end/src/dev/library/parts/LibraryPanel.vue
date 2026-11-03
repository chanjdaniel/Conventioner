<script setup lang="ts">
/**
 * One variant or state of a component, in a labelled box: the label names what is shown, so a
 * panel can be pointed at by name ("the disabled select").
 */
import { useId } from 'vue';

defineProps<{ label: string }>();

const id = useId();
</script>

<template>
  <section class="library-panel" :aria-labelledby="id" data-testid="library-panel">
    <h3 :id="id" class="library-panel__label">{{ label }}</h3>
    <div class="library-panel__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.library-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
}

.library-panel__label {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-text-muted);
}

.library-panel__body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
</style>
