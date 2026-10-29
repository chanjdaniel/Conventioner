<script setup lang="ts">
/**
 * The Stats tab (E45/F01/S01): the market's figures, from its first application to its archive,
 * open in every phase and to anyone who reads the market.
 *
 * It starts with who applied: every application by its status and by the day it arrived, as a
 * ledger of bars (`BarLedger`), counted from the list the Applications tab reads
 * (`utils/applicantStats.ts`), so the two never disagree. Stats reads; it changes nothing, so a
 * Viewer sees all of it and nothing here is disabled.
 */
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { Application } from '@/assets/types/datatypes';
import { fetchMarketApplications } from '@/utils/applicantApi';
import { getApiErrorMessage } from '@/utils/api';
import { applicantStats } from '@/utils/applicantStats';
import { useOpenMarket } from '@/utils/openMarket';
import BarLedger from '@/components/BarLedger.vue';
import MarketFrame from '@/components/MarketFrame.vue';

const route = useRoute();
const marketId = computed(() => String(route.params.marketId ?? ''));
const { market } = useOpenMarket(marketId);

const applications = ref<Application[] | null>(null);
const errorMessage = ref('');

async function load(): Promise<void> {
  errorMessage.value = '';
  if (!marketId.value) return;
  try {
    applications.value = await fetchMarketApplications(marketId.value);
  } catch (err: unknown) {
    errorMessage.value = getApiErrorMessage(err, 'The applications could not be loaded.');
  }
}
watch(marketId, load, { immediate: true });

const stats = computed(() =>
  applications.value ? applicantStats(applications.value, marketId.value) : null,
);
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
