<script setup lang="ts">
/**
 * The Stats tab (E45/F01/S01): the market's figures, from its first application to its archive,
 * open in every phase and to anyone who reads the market.
 *
 * Both sections are counted on the server and read in one small answer (`utils/marketStats.ts`),
 * so the page never downloads the applications to count them. It starts with who applied: every
 * application by its status, counted as the Applications tab's All view filters them, and by the
 * day it arrived, as a ledger of bars (`BarLedger`, `utils/applicantStats.ts`). Then what they
 * answered: a card per choice question of the form (`utils/answerCounts.ts`), narrowed by a
 * switch, kept in the address as `among`, to the approved or the placed (E45/F01/S02). Stats
 * reads; it changes nothing, so a Viewer sees all of it and nothing here is disabled.
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import { getApiErrorMessage } from '@/utils/api';
import { applicantStats } from '@/utils/applicantStats';
import { ANSWER_GROUPS, answerGroup, questionLedgers } from '@/utils/answerCounts';
import { fetchMarketStats, type MarketStats } from '@/utils/marketStats';
import { useOpenMarket } from '@/utils/openMarket';
import BarLedger from '@/components/BarLedger.vue';
import MarketFrame from '@/components/MarketFrame.vue';

const route = useRoute();
const router = useRouter();
const marketId = computed(() => String(route.params.marketId ?? ''));
const { market } = useOpenMarket(marketId);

const figures = ref<MarketStats | null>(null);
const errorMessage = ref('');

async function load(): Promise<void> {
  if (!marketId.value) return;
  errorMessage.value = '';
  try {
    figures.value = await fetchMarketStats(marketId.value);
  } catch (err: unknown) {
    errorMessage.value = getApiErrorMessage(err, 'The figures could not be counted.');
  }
}
watch(marketId, load, { immediate: true });

const stats = computed(() =>
  figures.value ? applicantStats(figures.value.applicants, marketId.value) : null,
);
const answers = computed(() => figures.value?.answers ?? null);

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
        <p v-else-if="!stats" class="stats-note">Counting…</p>
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
        v-if="answers?.groups.all"
        class="stats-section"
        aria-labelledby="stats-answers-title"
        data-testid="stats-answers"
      >
        <h2 id="stats-answers-title" class="stats-title">What they answered</h2>
        <p v-if="!answers.questions.length" class="stats-note" data-testid="stats-answers-none">
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

/* The cards share the page's whole width rather than leaving its right half empty (Daniel, T104);
   a card added later may want columns of one width again. */
.stats-ledgers {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
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
