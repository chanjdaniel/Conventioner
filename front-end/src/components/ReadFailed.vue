<script setup lang="ts">
/**
 * A screen's own read that failed: what happened, and a way to read it again (E38/F11/S01).
 *
 * The message is `getApiErrorMessage`'s, so it already says which kind of failure it was; Try again
 * runs the screen's read once more. `name` prefixes the test ids, one per screen:
 * `<name>-read-failed` and `<name>-retry`. A market that could not be loaded at all is
 * `MarketArrival`'s to say.
 */
defineProps<{ name: string; message: string }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="read-failed" role="alert" :data-testid="`${name}-read-failed`">
    <p>{{ message }}</p>
    <button
      type="button"
      class="btn btn--secondary btn--compact"
      :data-testid="`${name}-retry`"
      @click="$emit('retry')"
    >
      Try again
    </button>
  </div>
</template>

<style scoped>
.read-failed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin: 0 0 var(--space-3);
  color: var(--mm-red);
  font-size: var(--text-sm);
}

.read-failed p {
  margin: 0;
}
</style>
