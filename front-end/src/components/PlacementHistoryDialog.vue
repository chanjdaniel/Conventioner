<script setup lang="ts">
/**
 * The market's placement trail, in a dialog opened from the results' action row (E35/F03/S03).
 *
 * It sat at the bottom of the Result page, below every table of every date, where nobody found it.
 * The trail is read each time the dialog opens, so a placement made a moment ago on the page is
 * in it with no reload. Read-only: a close control, Escape and the backdrop, and nothing to confirm.
 */
import AppDialog from '@/components/AppDialog.vue';
import PlacementHistory from '@/components/PlacementHistory.vue';

defineProps<{ open: boolean; marketId: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <AppDialog
    :open="open"
    title="Assignment history"
    testid="placement-history-dialog"
    wide
    @close="emit('close')"
  >
    <PlacementHistory v-if="open" :marketId="marketId" />
  </AppDialog>
</template>
