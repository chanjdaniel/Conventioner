<script setup lang="ts">
/**
 * Whether what the organizer just typed into the plan is on the server (T271).
 *
 * Nothing else on Market Setup says so, since the plan saves itself (`utils/useAutosave.ts`):
 * "Saving…", then "Plan saved"; a save that failed on the way says why and offers Retry, which sends
 * the whole plan again; a save the server refused says the server's sentence, and that the plan is
 * back as the server holds it, with nothing to retry, since the same plan would be refused again.
 */
import type { AutosaveStatus } from '@/utils/useAutosave';

defineProps<{ status: AutosaveStatus; message: string }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <span v-if="status === 'saving'" class="plan-save-status" data-testid="market-setup-plan-saving">
    Saving…
  </span>
  <span
    v-else-if="status === 'saved'"
    class="plan-save-status plan-save-status--saved"
    data-testid="market-setup-plan-saved"
  >
    Plan saved
  </span>
  <span v-else-if="status === 'failed'" class="plan-save-failed" role="alert">
    <span
      class="plan-save-status plan-save-status--failed"
      data-testid="market-setup-plan-save-error"
      >{{ message }}</span
    >
    <button
      type="button"
      class="btn btn--secondary btn--compact"
      data-testid="market-setup-plan-retry-button"
      @click="$emit('retry')"
    >
      Retry
    </button>
  </span>
  <span
    v-else-if="status === 'refused'"
    class="plan-save-status plan-save-status--refused"
    role="alert"
    data-testid="market-setup-plan-refused"
  >
    {{ message }}
  </span>
</template>

<style scoped>
.plan-save-status {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.plan-save-status--saved {
  color: var(--mm-green);
}

.plan-save-status--failed {
  color: var(--mm-text-yellow);
}

.plan-save-status--refused {
  color: var(--mm-red);
  text-align: right;
  max-width: 60ch;
  /* The server's sentence runs to several lines; no last word stands alone. */
  text-wrap: pretty;
}

.plan-save-failed {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: var(--space-3);
}
</style>
