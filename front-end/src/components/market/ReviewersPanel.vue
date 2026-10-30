<script setup lang="ts">
/**
 * Who reviews this market's applications, on the Applications tab while the review is open
 * (E38/F07/S02): every reader sees the reviewers, each one who no longer holds a role on the market
 * marked as no longer able to review here, and someone the table's "Choose reviewers" row
 * lets choose changes them here. Saving deals every open application again among them, on the
 * server (`back-end/review_team.py`).
 */
import { computed, ref } from 'vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import ReviewerPicker from '@/components/market/ReviewerPicker.vue';
import { getApiErrorMessage } from '@/utils/api';
import { MarketAction, mayTake } from '@/utils/marketActions';
import { NONE_CHOSEN, RESHUFFLE, chooseReviewers, reviewerAddresses } from '@/utils/reviewTeam';
import { signedInEmail } from '@/utils/signedIn';
import { useMarketStore } from '@/stores/market';

const props = defineProps<{ market: Market | null }>();
/** The choice landed: the views read their lists again, to show whom each application went to. */
const emit = defineEmits<{ saved: [] }>();

/** From Assignment on the review is closed and the reviewers no longer change, so it is gone. */
const shown = computed(
  () =>
    !!props.market &&
    props.market.phase !== MarketPhase.Archived &&
    !props.market.verdictsSettledReason,
);
const reviewers = computed(() => props.market?.reviewTeam?.reviewers ?? []);
const chooses = computed(() => mayTake(props.market, MarketAction.ChooseReviewers));
const me = computed(() => (signedInEmail() ?? '').toLowerCase());
const action = computed(() => (reviewers.value.length ? 'Change reviewers' : 'Choose reviewers'));

const open = ref(false);
const ticked = ref<string[]>([]);
const saving = ref(false);
const error = ref('');

function start() {
  ticked.value = reviewerAddresses(props.market);
  error.value = '';
  open.value = true;
}

async function save() {
  if (!props.market || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    await chooseReviewers(props.market.id, ticked.value);
    open.value = false;
    await useMarketStore().refresh();
    emit('saved');
  } catch (err) {
    error.value = getApiErrorMessage(err, 'Could not save the reviewers.');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section v-if="shown" class="reviewers" aria-labelledby="reviewers-title" data-testid="reviewers">
    <div class="reviewers-head">
      <!-- The page's h1 is the market bar's; this tab has no heading over the panel. -->
      <h2 id="reviewers-title" class="field-label reviewers-title">Reviewers</h2>
      <button
        v-if="chooses"
        type="button"
        class="btn btn--secondary btn--compact"
        data-testid="reviewers-change"
        @click="start"
      >
        {{ action }}
      </button>
    </div>
    <ul v-if="reviewers.length" class="reviewers-list" data-testid="reviewers-list">
      <li
        v-for="reviewer in reviewers"
        :key="reviewer.email"
        class="reviewers-person"
        data-testid="reviewers-person"
      >
        {{ reviewer.email
        }}<span v-if="reviewer.email.toLowerCase() === me" class="reviewers-note"> (you)</span>
        <!-- No longer holds a role here: dealt nothing until an Admin removes them (E38/F07/S02). -->
        <span v-if="!reviewer.able" class="chip chip--attention" data-testid="reviewers-unable"
          >Can no longer review here</span
        >
      </li>
    </ul>
    <p v-else class="reviewers-none" data-testid="reviewers-none">{{ NONE_CHOSEN }}</p>

    <AppDialog
      :open="open"
      :title="action"
      testid="reviewers-dialog"
      :confirm-label="saving ? 'Saving…' : 'Save reviewers'"
      :confirm-disabled="saving"
      :error="error"
      anchored
      @close="open = false"
      @submit="save"
    >
      <p class="reviewers-reshuffle">{{ RESHUFFLE }}</p>
      <ReviewerPicker
        v-model="ticked"
        :candidates="market?.reviewerCandidates ?? []"
        :current="reviewerAddresses(market)"
        :disabled="saving"
      />
    </AppDialog>
  </section>
</template>

<style scoped>
.reviewers {
  margin-bottom: var(--space-4);
}

.reviewers-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.reviewers-title {
  margin: 0;
}

.reviewers-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin: var(--space-1) 0 0;
  padding: 0;
  list-style: none;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.reviewers-person {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  min-width: 0;
  overflow-wrap: anywhere;
}

.reviewers-note {
  color: var(--mm-text-muted);
}

.reviewers-none {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.reviewers-reshuffle {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  color: var(--mm-black);
  line-height: 1.4;
}
</style>
