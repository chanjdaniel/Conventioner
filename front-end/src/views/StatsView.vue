<script setup lang="ts">
/**
 * The Stats tab (E45/F01/S01): the market's figures, from its first application to its archive,
 * open in every phase and to anyone who reads the market.
 *
 * It starts with who applied: every application by its status and by the day it arrived, as a
 * ledger of bars (`BarLedger`), counted from the list the Applications tab reads
 * (`utils/applicantStats.ts`), so the two never disagree. Then what they answered: a card per
 * choice question of the form, counted on the server (`utils/answerCounts.ts`) and narrowed by a
 * switch, kept in the address as `among`, to the approved or the placed (E45/F01/S02). Stats
 * reads; it changes nothing, so a Viewer sees all of it and nothing here is disabled.
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import type { Application } from '@/assets/types/datatypes';
import { fetchMarketApplications } from '@/utils/applicantApi';
import { getApiErrorMessage } from '@/utils/api';
import { applicantStats } from '@/utils/applicantStats';
import {
  ANSWER_GROUPS,
  answerGroup,
  fetchAnswerCounts,
  questionLedgers,
  type AnswerCounts,
} from '@/utils/answerCounts';
import { useOpenMarket } from '@/utils/openMarket';
import BarLedger from '@/components/BarLedger.vue';
import MarketFrame from '@/components/MarketFrame.vue';

const route = useRoute();
const router = useRouter();
const marketId = computed(() => String(route.params.marketId ?? ''));
const { market } = useOpenMarket(marketId);

const applications = ref<Application[] | null>(null);
const errorMessage = ref('');

const answers = ref<AnswerCounts | null>(null);
const answersError = ref('');

async function loadApplications(): Promise<void> {
  errorMessage.value = '';
  try {
    applications.value = await fetchMarketApplications(marketId.value);
  } catch (err: unknown) {
    errorMessage.value = getApiErrorMessage(err, 'The applications could not be loaded.');
  }
}

async function loadAnswers(): Promise<void> {
  answersError.value = '';
  try {
    answers.value = await fetchAnswerCounts(marketId.value);
  } catch (err: unknown) {
    answersError.value = getApiErrorMessage(err, 'The answers could not be counted.');
  }
}

async function load(): Promise<void> {
  if (!marketId.value) return;
  await Promise.all([loadApplications(), loadAnswers()]);
}
watch(marketId, load, { immediate: true });

const stats = computed(() =>
  applications.value ? applicantStats(applications.value, marketId.value) : null,
);

/** Who the charts count, in the address beside the page. */
const among = computed(() => answerGroup(route.query.among));
const amongGroup = computed(() => ANSWER_GROUPS.find((group) => group.id === among.value)!);
function narrowTo(group: string) {
  const query: LocationQuery = { ...route.query };
  if (group === 'all') delete query.among;
  else query.among = group;
  void router.replace({ query });
}
const ledgers = computed(() => (answers.value ? questionLedgers(answers.value, among.value) : []));
/** Nobody in the group yet, said instead of charts of noughts. */
const NOBODY: Record<string, string> = {
  approved: 'Nobody is approved yet.',
  placed: 'Nobody has a table yet.',
};
</script>

<template>
  <MarketFrame :market="market" @retry="load">
    <div class="stats">
      <section class="stats-section" aria-labelledby="stats-applicants-title">
        <h2 id="stats-applicants-title" class="stats-title">Who applied</h2>
        <p v-if="errorMessage" class="stats-error" role="alert">{{ errorMessage }}</p>
        <p v-else-if="!stats" class="stats-note">Loading applications…</p>
        <p v-else-if="!stats.total" class="stats-note" data-testid="stats-applicants-none">
          Nobody has applied yet.
        </p>
        <template v-else>
          <p class="stats-total" data-testid="stats-applicants-total">
            <strong>{{ stats.total }}</strong>
            {{ stats.total === 1 ? 'application' : 'applications' }} in all<template
              v-if="stats.addedByHand"
              >, {{ stats.addedByHand }} of them added by hand</template
            >
          </p>
          <div class="stats-ledgers">
            <BarLedger
              title="By status"
              :rows="stats.byStatus"
              testid="stats-status"
              whole="applications"
              action="Show these applications"
              data-testid="stats-by-status"
            />
            <BarLedger
              title="Applied per day"
              :rows="stats.byDay"
              testid="stats-day"
              whole="those who applied"
              data-testid="stats-by-day"
            />
          </div>
        </template>
      </section>
      <!-- Nobody applied: the section above says so, and a chart of noughts says nothing more. -->
      <section
        v-if="answersError || !answers || answers.groups.all"
        class="stats-section"
        aria-labelledby="stats-answers-title"
        data-testid="stats-answers"
      >
        <h2 id="stats-answers-title" class="stats-title">What they answered</h2>
        <p v-if="answersError" class="stats-error" role="alert">{{ answersError }}</p>
        <p v-else-if="!answers" class="stats-note">Counting answers…</p>
        <p
          v-else-if="!answers.questions.length"
          class="stats-note"
          data-testid="stats-answers-none"
        >
          The form asks no question with choices to count.
        </p>
        <template v-else>
          <div class="stats-among">
            <div class="stats-among-switch" role="group" aria-label="Count the answers of">
              <button
                v-for="group in ANSWER_GROUPS"
                :key="group.id"
                type="button"
                class="btn btn--compact"
                :class="group.id === among ? 'btn--primary' : 'btn--secondary'"
                :aria-pressed="group.id === among"
                :data-testid="`stats-among-${group.id}`"
                @click="narrowTo(group.id)"
              >
                {{ group.label }}
              </button>
            </div>
            <span class="stats-among-count" data-testid="stats-among-count">
              {{ answers.groups[among] }} of {{ answers.groups.all }}
            </span>
          </div>
          <p v-if="!answers.groups[among]" class="stats-note" data-testid="stats-among-nobody">
            {{ NOBODY[among] }}
          </p>
          <div v-else class="stats-ledgers">
            <BarLedger
              v-for="ledger in ledgers"
              :key="ledger.key"
              :title="ledger.title"
              :rows="ledger.rows"
              testid="stats-answer"
              :whole="amongGroup.whole"
              data-testid="stats-question"
              :data-key="ledger.key"
            />
          </div>
        </template>
      </section>
    </div>
  </MarketFrame>
</template>

<style scoped>
.stats {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  padding: var(--space-6);
  color: var(--mm-black);
}

.stats-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.stats-title {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  font-weight: 400;
}

.stats-total {
  margin: 0;
  font-size: var(--text-sm);
}

.stats-total strong {
  font-size: var(--text-lg);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* Cards of one width however many there are, so a card added later lines up with these. */
.stats-ledgers {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  align-items: start;
  gap: var(--space-4);
}

.stats-among {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.stats-among-switch {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

/* Beside the switch, not at the frame's far edge: the cards under it may fill only its left. */
.stats-among-count {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  font-variant-numeric: tabular-nums;
}

.stats-note {
  margin: 0;
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.stats-error {
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-sm);
}
</style>
