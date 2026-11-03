<script setup lang="ts">
/**
 * "Open applications" on a market whose vendors apply on its own page (E38/F07/S02): the reviewers
 * are offered in the same step, so the review is divided from the first submission. The rail opens
 * this only for someone the table's "Choose reviewers" row lets choose.
 *
 * Confirming writes the reviewers only when the choice differs from the stored team, and says so to
 * the rail, which then moves the phase as it always has. A write that fails keeps the dialog open
 * with its error, and the rail does not move.
 *
 * Below the picker it names the review setup the organizer is about to open (T206): what a reviewer
 * reads first and the automatic rejections, as the market serves them. The rail opens this only
 * while the move has no blocker, so both read decided. Its "Change" leads to Review setup and
 * closes the dialog, for someone the table lets change the form.
 */
import { computed, ref, watch } from 'vue';
import type { Market } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import ReviewerPicker from '@/components/market/ReviewerPicker.vue';
import { getApiErrorMessage } from '@/utils/api';
import { resolutionPath } from '@/utils/market';
import { MarketAction, mayTake } from '@/utils/marketActions';
import { rejectingRules } from '@/utils/rejectionRules';
import { leadingLabels } from '@/utils/reviewHighlights';
import { chooseReviewers, reviewerAddresses, sameTeam } from '@/utils/reviewTeam';

const props = defineProps<{
  open: boolean;
  market: Market | null;
  /** The move is under way: the confirm waits on it. */
  moving?: boolean;
}>();
/** `chosen` once the reviewers are as ticked; `wrote` says whether that took a write. */
const emit = defineEmits<{ close: []; chosen: [wrote: boolean] }>();

const ticked = ref<string[]>([]);

/** What a reviewer reads first, as one line. */
const leads = computed(() => {
  const labels = props.market ? leadingLabels(props.market) : [];
  if (labels.length) return `What a reviewer reads first: ${labels.join(', ')}`;
  return props.market?.nothingLeadsTheCard
    ? 'Nothing leads the card'
    : 'What a reviewer reads first: not decided yet';
});

/** The automatic rejections, as one line. */
const rejections = computed(() => {
  const count = rejectingRules(
    props.market?.rejectionRules ?? [],
    props.market?.rejectionQuestions ?? [],
  ).length;
  if (count) return `Automatic rejections: ${count} ${count === 1 ? 'rule' : 'rules'}`;
  return props.market?.noAutomaticRejections
    ? 'Automatic rejections: None'
    : 'Automatic rejections: not decided yet';
});

/** Review setup, for someone who may change it. */
const changeTo = computed(() =>
  props.market && mayTake(props.market, MarketAction.ChangeForm)
    ? resolutionPath(props.market.id, 'form?step=review')
    : null,
);
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
    :confirm-label="saving ? 'Saving…' : 'Open applications'"
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
    <section class="review-setup" aria-labelledby="open-applications-review-setup">
      <div class="review-setup-head">
        <h3 id="open-applications-review-setup" class="field-label">Review setup</h3>
        <RouterLink
          v-if="changeTo"
          :to="changeTo"
          class="link-alone"
          data-testid="open-applications-change-review-setup"
          @click="emit('close')"
          >Change<span class="visually-hidden"> the review setup</span></RouterLink
        >
      </div>
      <p class="review-setup-line" data-testid="open-applications-leads">{{ leads }}</p>
      <p class="review-setup-line" data-testid="open-applications-rejections">{{ rejections }}</p>
    </section>
  </AppDialog>
</template>

<style scoped>
.review-setup {
  margin-top: var(--space-4);
}

.review-setup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.review-setup-head h3 {
  margin: 0;
}

.review-setup-line {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}
</style>
