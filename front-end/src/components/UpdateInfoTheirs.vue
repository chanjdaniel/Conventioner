<script setup lang="ts">
/**
 * Under one question in Update info (E41/F01/S01): what the vendor wrote, while the answer differs
 * from it, with "Use their answer"; that Save takes an update away, when the answer is back to
 * theirs; and who updated it, while the dialog leaves that update standing.
 */
defineProps<{
  question: string;
  differs: boolean;
  theyWrote: string;
  goesBack: boolean;
  standing: string | null;
}>();
const emit = defineEmits<{ useTheirs: [] }>();
</script>

<template>
  <div v-if="differs" class="update-info-theirs" :data-testid="`update-info-theirs-${question}`">
    <span>They wrote: {{ theyWrote }}</span>
    <button
      type="button"
      class="btn btn--secondary btn--compact"
      :data-testid="`update-info-use-theirs-${question}`"
      @click="emit('useTheirs')"
    >
      Use their answer
    </button>
  </div>
  <p
    v-else-if="goesBack"
    class="update-info-meta"
    :data-testid="`update-info-goes-back-${question}`"
  >
    Back to their answer: Save takes the update away.
  </p>
  <p v-if="standing" class="update-info-meta" :data-testid="`update-info-updated-${question}`">
    {{ standing }}
  </p>
</template>

<style scoped>
/* What the vendor wrote, beside the new value: the confirmation Save stands for. */
.update-info-theirs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  background: var(--mm-beige);
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.update-info-meta {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
