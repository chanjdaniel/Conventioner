<script setup lang="ts">
/**
 * Who reviews this market's applications, on the Applications tab while the review is open
 * (E38/F07/S02): every reader sees the reviewers in one line (T204), and someone the table's "Choose
 * reviewers" row lets choose changes them here. Saving deals every open application again among
 * them, on the server (`back-end/review_team.py`).
 *
 * A reviewer who no longer holds a role on the market is marked as no longer able to review here,
 * and is never folded out of sight: they lead the line, and it ends with how many more of them are
 * folded. "and N more" opens the Change dialog, whose chips are the whole list and mark them too,
 * for someone who may choose, and for anyone else a read-only list.
 */
import { computed, nextTick, ref } from 'vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import NameList from '@/components/NameList.vue';
import ReviewerName from '@/components/market/ReviewerName.vue';
import ReviewerPicker from '@/components/market/ReviewerPicker.vue';
import { getApiErrorMessage } from '@/utils/api';
import { MarketAction, mayTake } from '@/utils/marketActions';
import {
  NONE_CHOSEN,
  RESHUFFLE,
  chooseReviewers,
  rememberTeamSaved,
  reviewerAddresses,
  teamToChange,
} from '@/utils/reviewTeam';
import { useMarketStore } from '@/stores/market';

/** How many the line names before "and N more". */
const NAMED = 3;
const REVIEWER = { one: 'reviewer', many: 'reviewers' };

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
/** Those who can no longer review first, each side in the order they are dealt to. */
const reviewers = computed(() => {
  const team = props.market?.reviewTeam?.reviewers ?? [];
  return [...team.filter(({ able }) => !able), ...team.filter(({ able }) => able)];
});
const addresses = computed(() => reviewers.value.map(({ email }) => email));
const unable = computed(() =>
  reviewers.value.filter(({ able }) => !able).map(({ email }) => email),
);
/** Who can no longer review here past those the line names, as they come first. */
const unableFolded = computed(() => Math.max(unable.value.length - NAMED, 0));
const chooses = computed(() => mayTake(props.market, MarketAction.ChooseReviewers));
const action = computed(() => (reviewers.value.length ? 'Change reviewers' : 'Choose reviewers'));

const changeButton = ref<HTMLButtonElement | null>(null);
const open = ref(false);
/** The read-only list, for someone who may not choose. */
const listOpen = ref(false);
const ticked = ref<string[]>([]);
const saving = ref(false);
const error = ref('');

function start() {
  ticked.value = teamToChange(props.market);
  error.value = '';
  open.value = true;
}

function showAll() {
  if (chooses.value) start();
  else listOpen.value = true;
}

/**
 * The dialog goes only once the re-read has answered: until then the panel behind it says the team
 * before this save, and a close would hide a refusal. No close takes it meanwhile (`close-disabled`).
 */
async function save() {
  if (!props.market || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    await chooseReviewers(props.market.id, ticked.value);
    if (props.market) rememberTeamSaved(props.market, ticked.value);
    await useMarketStore().refresh();
    open.value = false;
    emit('saved');
    await nextTick();
    // "and N more" may have opened this and gone with the save, so focus has nowhere to go back to.
    if (reviewers.value.length <= NAMED && document.activeElement === document.body) {
      changeButton.value?.focus();
    }
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
        ref="changeButton"
        type="button"
        class="btn btn--secondary btn--compact"
        data-testid="reviewers-change"
        @click="start"
      >
        {{ action }}
      </button>
    </div>
    <NameList
      v-if="reviewers.length"
      :names="addresses"
      :noun="REVIEWER"
      :named="NAMED"
      testid="reviewers-line"
      @more="showAll"
    >
      <template #name="{ index }">
        <ReviewerName :reviewer="reviewers[index]!" />
      </template>
      <template v-if="unableFolded" #end>
        <span class="visually-hidden">,</span>{{ ' '
        }}<span class="chip chip--attention" data-testid="reviewers-unable-more"
          >{{ unableFolded }} more can no longer review here</span
        >
      </template>
    </NameList>
    <p v-else class="reviewers-none" data-testid="reviewers-none">{{ NONE_CHOSEN }}</p>

    <AppDialog
      :open="open"
      :title="action"
      testid="reviewers-dialog"
      scroll="body"
      :confirm-label="saving ? 'Saving…' : 'Save reviewers'"
      :confirm-disabled="saving"
      :close-disabled="saving"
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
        :unable="unable"
        :disabled="saving"
      />
    </AppDialog>

    <AppDialog
      :open="listOpen"
      title="Reviewers"
      testid="reviewers-all"
      size="wide"
      scroll="body"
      @close="listOpen = false"
    >
      <ul class="reviewers-all">
        <li
          v-for="reviewer in reviewers"
          :key="reviewer.email"
          class="reviewers-person"
          data-testid="reviewers-person"
        >
          <ReviewerName :reviewer="reviewer" />
        </li>
      </ul>
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
  margin-bottom: var(--space-1);
}

.reviewers-title {
  margin: 0;
}

.reviewers-none {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.reviewers-all {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.reviewers-person {
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--mm-border);
}

.reviewers-person:last-child {
  border-bottom: none;
}

.reviewers-reshuffle {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  color: var(--mm-black);
  line-height: 1.4;
}
</style>
