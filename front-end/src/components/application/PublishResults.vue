<script setup lang="ts">
/**
 * Publish Results, over both of the review's views (E38/F05/S01).
 *
 * It was in the one-by-one review's header, and the rail's "Publish results" leads to the
 * Applications page: with All the page's default, it would have led to a page without it. It is a
 * step for the market, not for a view, so it sits over the switch, from the assignment on.
 */
import { computed, ref, watch } from 'vue';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { publishResults } from '@/utils/applicantApi';
import { getApiErrorMessage } from '@/utils/api';
import { outcomeHeadline } from '@/utils/applicantOutcome';
import { useMarketStore } from '@/stores/market';
import AppDialog from '@/components/AppDialog.vue';

const props = defineProps<{ market: Market | null }>();

/**
 * Does publishing results mean anything on this market?
 *
 * `resultsPublished` is what makes a reviewer's verdict visible to the applicant instead of
 * `under_review` - and every endpoint that reads it goes through
 * `applicant_intake_market_by_slug`, which serves form-intake markets only. On a CSV market the
 * flag has no reader at all, so the button was a no-op with a confident label. It is absent
 * there, and the endpoint refuses too, because a hidden button is not a rule.
 */
const marketHasApplicants = computed(() => props.market?.intakeMode === IntakeMode.Form);
/**
 * Results go out from the assignment on, so it is drawn only from there (Daniel, 2026-10-29): before
 * it, a disabled button with its reason sat over the review it has nothing to do with.
 */
const FROM_THE_ASSIGNMENT: readonly string[] = [
  MarketPhase.Assignment,
  MarketPhase.Offers,
  MarketPhase.MarketDays,
];
const itsPhase = computed(() => FROM_THE_ASSIGNMENT.includes(props.market?.phase ?? ''));
/**
 * Whether this person may publish results at all: the table's Publish results row (E39/F01/S01),
 * served on its own (E38/F05), not the row that moves the phase. Whether they can yet is
 * `publishReason`, which disables the button and says why.
 */
// Null, not absent: a market read that does not say who may publish draws nothing.
const publishes = computed(() => props.market?.publishResultsActionReason === null);

/**
 * Why results cannot be published yet, as the server judges it (E36/F04/S01): they wait for a
 * current run in assignment, so each applicant is told whether they have a table.
 */
const publishReason = computed(() => props.market?.publishResultsReason ?? null);
const outcomes = computed(() => props.market?.publishOutcomes ?? null);
/** The two outcomes in the applicant's own words (E36/F05/S02), worded once. */
const HAS_A_TABLE = outcomeHeadline({ outcome: 'has_a_table' });
const NOT_ASSIGNED = outcomeHeadline({ outcome: 'not_assigned' });

const published = ref(false);
watch(
  () => props.market?.resultsPublished,
  (value) => (published.value = value ?? false),
  { immediate: true },
);
const confirming = ref(false);
const loading = ref(false);
const error = ref('');

async function publish() {
  if (!props.market || loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    await publishResults(props.market.id);
    published.value = true;
    confirming.value = false;
    void useMarketStore().refresh();
  } catch (err) {
    error.value = getApiErrorMessage(err, 'Failed to publish results');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div v-if="market && marketHasApplicants && itsPhase && publishes" class="publish-row">
    <button
      v-if="!published"
      class="publish-button"
      :disabled="loading || Boolean(publishReason)"
      data-testid="applications-publish-button"
      @click="confirming = true"
    >
      {{ loading ? 'Publishing...' : 'Publish Results' }}
    </button>
    <span
      v-if="!published && publishReason"
      class="publish-hint"
      data-testid="applications-publish-hint"
      >{{ publishReason }}</span
    >
    <!-- What it does, said beside it: optional, never the rail's next step (E31/F03/S04). -->
    <span v-else-if="!published" class="publish-hint" data-testid="applications-publish-hint">
      Tells every applicant, on their application page, whether they have a table.
    </span>
    <span v-if="published" class="chip chip--positive" data-testid="applications-published-badge">
      Results published
    </span>
    <p v-if="error && !confirming" class="publish-error">{{ error }}</p>

    <!-- What publishing tells whom, before it does (E36/F04/S01): it cannot be undone. -->
    <AppDialog
      :open="confirming"
      title="Publish results"
      testid="publish-results"
      :confirm-label="loading ? 'Publishing…' : 'Publish results'"
      :confirm-disabled="loading"
      :error="error"
      @close="confirming = false"
      @submit="publish"
    >
      <p v-if="outcomes" class="publish-outcomes">
        {{ outcomes.haveATable }}
        {{ outcomes.haveATable === 1 ? 'applicant will read' : 'applicants will read' }}
        "{{ HAS_A_TABLE }}". {{ outcomes.notAssigned }} will read "{{ NOT_ASSIGNED }}".
      </p>
      <p class="publish-outcomes">
        Publishing cannot be undone, and the assignment cannot be run again after it: seats change
        only by hand.
      </p>
    </AppDialog>
  </div>
</template>

<style scoped>
.publish-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.publish-button {
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: var(--radius-control);
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
  font-family: 'Merge One';
  font-size: var(--text-sm);
}

.publish-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.publish-hint {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  max-width: 60ch;
}

.publish-error {
  flex-basis: 100%;
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-sm);
}

.publish-outcomes {
  margin: 0 0 var(--space-3);
  font-size: var(--text-sm);
  color: var(--mm-black);
}
</style>
