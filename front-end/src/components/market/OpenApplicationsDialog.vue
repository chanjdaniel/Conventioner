<script setup lang="ts">
/**
 * "Open Applications" on a market whose vendors apply on its own page (E38/F07/S02): the reviewers
 * are offered in the same step, so the review is divided from the first submission. The rail opens
 * this only for someone the table's "Choose reviewers" row lets choose.
 *
 * Confirming writes the reviewers only when the choice differs from the stored team, and says so to
 * the rail, which then moves the phase as it always has. A write that fails keeps the dialog open
 * with its error, and the rail does not move.
 */
import { ref, watch } from 'vue';
import type { Market } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import ReviewerPicker from '@/components/market/ReviewerPicker.vue';
import { getApiErrorMessage } from '@/utils/api';
import { chooseReviewers, reviewerAddresses } from '@/utils/reviewTeam';

const props = defineProps<{
  open: boolean;
  market: Market | null;
  /** The move is under way: the confirm waits on it. */
  moving?: boolean;
}>();
/** `chosen` once the reviewers are as ticked; `wrote` says whether that took a write. */
const emit = defineEmits<{ close: []; chosen: [wrote: boolean] }>();

const ticked = ref<string[]>([]);
const saving = ref(false);
const error = ref('');

/* Each opening starts from the stored team: none, or whoever was chosen in draft before. */
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    ticked.value = reviewerAddresses(props.market);
    error.value = '';
  },
  { immediate: true },
);

function sameTeam(chosen: readonly string[], stored: readonly string[]): boolean {
  const key = (addresses: readonly string[]) =>
    [...new Set(addresses.map((address) => address.trim().toLowerCase()))].sort().join('\n');
  return key(chosen) === key(stored);
}

async function confirm() {
  if (!props.market || saving.value || props.moving) return;
  if (sameTeam(ticked.value, reviewerAddresses(props.market))) {
    emit('chosen', false);
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    await chooseReviewers(props.market.id, ticked.value);
  } catch (err) {
    error.value = getApiErrorMessage(err, 'Could not save the reviewers.');
    return;
  } finally {
    saving.value = false;
  }
  emit('chosen', true);
}
</script>

<template>
  <AppDialog
    :open="open"
    title="Open applications"
    testid="open-applications"
    :confirm-label="saving ? 'Saving…' : 'Open Applications'"
    :confirm-disabled="saving || moving"
    :error="error"
    anchored
    @close="emit('close')"
    @submit="confirm"
  >
    <ReviewerPicker
      v-model="ticked"
      :candidates="market?.reviewerCandidates ?? []"
      :current="reviewerAddresses(market)"
      :disabled="saving || moving"
    />
  </AppDialog>
</template>
