<script setup lang="ts">
/**
 * What a reviewer just decided, and its Undo (E38/F10/S01): one line, a polite live region, so a
 * screen reader hears the verdict land without being interrupted. A refused undo says why in place
 * of the button. One by one shows its key, Z.
 */
defineProps<{
  line: string;
  refusal: string;
  busy: boolean;
  /** The key that undoes, shown in the button as the card shows its verdicts' keys. */
  shortcut?: string;
  testid: string;
}>();

defineEmits<{ undo: [] }>();
</script>

<template>
  <p class="undo-line" role="status" :data-testid="testid">
    <span class="undo-words">{{ line }}</span>
    <span v-if="refusal" class="undo-refusal" :data-testid="`${testid}-refusal`">{{
      refusal
    }}</span>
    <button
      v-else
      type="button"
      class="btn btn--secondary btn--compact"
      :disabled="busy"
      :data-testid="`${testid}-button`"
      @click="$emit('undo')"
    >
      Undo<kbd v-if="shortcut">{{ shortcut }}</kbd>
    </button>
  </p>
</template>

<style scoped>
.undo-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.undo-words {
  flex: 1 1 12rem;
  overflow-wrap: anywhere;
}

.undo-refusal {
  flex: 1 1 100%;
  color: var(--mm-text-muted);
}

kbd {
  font-family: monospace;
  font-size: var(--text-xs);
  border: 1px solid color-mix(in srgb, currentColor 60%, transparent);
  border-radius: var(--radius-control);
  padding: 0 var(--space-1);
  margin-left: var(--space-1);
}
</style>
