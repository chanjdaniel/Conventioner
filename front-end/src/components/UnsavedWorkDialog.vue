<script setup lang="ts">
/**
 * The leave question, "Leave without saving?" (T271): the one dialog every screen holding unsaved
 * work asks through, mounted once in `App.vue` beside the routed view (`utils/useUnsavedWork.ts`).
 *
 * A short question on `AppDialog`, so its focus, Escape, scrim and the page held inert are the
 * shell's. Leave is destructive, since it drops the work, so the dialog opens on Stay; Stay, the
 * close control, Escape and the scrim all answer "stay".
 */
import { computed } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import { answerLeaveQuestion, leaveQuestion } from '@/utils/useUnsavedWork';

const open = computed(() => leaveQuestion.value !== null);
</script>

<template>
  <AppDialog
    :open="open"
    title="Leave without saving?"
    testid="unsaved-work"
    confirm-label="Leave"
    cancel-label="Stay"
    destructive
    @close="answerLeaveQuestion(false)"
    @submit="answerLeaveQuestion(true)"
  >
    <p class="unsaved-work-text" data-testid="unsaved-work-sentence">
      {{ leaveQuestion?.sentence }}
    </p>
  </AppDialog>
</template>

<style scoped>
.unsaved-work-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}
</style>
