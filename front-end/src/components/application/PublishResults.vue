<script setup lang="ts">
/**
 * Publish results, over both of the review's views (E38/F05/S01).
 *
 * It was in the one-by-one review's header, and the rail's "Publish results" leads to the
 * Applications page: with All the page's default, it would have led to a page without it. It is a
 * step for the market, not for a view, so it sits over the switch, from the assignment on.
 */
import { computed, ref, watch } from 'vue';
import { MarketPhase, type Market } from '@/assets/types/datatypes';
import { publishResults } from '@/utils/applicantApi';
import { getApiErrorMessage } from '@/utils/api';
import { MarketAction, actionRefusal, mayTake } from '@/utils/marketActions';
import { outcomeHeadline } from '@/utils/applicantOutcome';
import { useMarketStore } from '@/stores/market';
import { useCopyAddress } from '@/utils/useCopyAddress';
import AppDialog from '@/components/AppDialog.vue';

const props = defineProps<{ market: Market | null }>();

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
 * Whether this person may publish results at all: the table's Publish results row (E39/F01/S02),
 * not the row that moves the phase. Whether they can yet is `publishReason`, which disables the
 * button and says why.
 */
const publishes = computed(() => mayTake(props.market, MarketAction.PublishResults));

/**
 * Why results cannot be published yet, as the server judges it: who may, the table's row
 * (E39/F01/S02), then that they wait for a current run in assignment, so each applicant is told
 * whether they have a table (E36/F04/S01).
 */
const publishReason = computed(
  () =>
    actionRefusal(props.market, MarketAction.PublishResults) ||
    props.market?.publishWaitsReason ||
    null,
);
const outcomes = computed(() => props.market?.publishOutcomes ?? null);
/** The two outcomes in the applicant's own words (E36/F05/S02), worded once. */
const HAS_A_TABLE = outcomeHeadline({ outcome: 'has_a_table' });
const NOT_ASSIGNED = outcomeHeadline({ outcome: 'not_assigned' });

/**
 * Where vendors read their result: the market's vendor page (ADR 0022). Publishing sends nothing,
 * so the confirmation gives the organizer the address to share.
 */
const vendorPageUrl = computed(() =>
  props.market?.slug ? `${window.location.origin}/${props.market.slug}` : '',
);
const { copied, copy } = useCopyAddress();

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
    error.value = getApiErrorMessage(err, 'The results were not published.');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div v-if="market && itsPhase && publishes" class="publish-row">
    <button
      v-if="!published"
      class="publish-button"
      :disabled="loading || Boolean(publishReason)"
      data-testid="applications-publish-button"
      @click="confirming = true"
    >
      {{ loading ? 'Publishing…' : 'Publish results' }}
    </button>
    <span
      v-if="!published && publishReason"
      class="publish-hint"
      data-testid="applications-publish-hint"
      >{{ publishReason }}</span
    >
    <!-- What it does, said beside it: optional, never the rail's next step (E31/F03/S04). -->
    <span v-else-if="!published" class="publish-hint" data-testid="applications-publish-hint">
      Vendors read whether they have a table on the market's vendor page. No email is sent.
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
        {{ outcomes.haveATable === 1 ? 'vendor will read' : 'vendors will read' }}
        "{{ HAS_A_TABLE }}". {{ outcomes.notAssigned }} will read "{{ NOT_ASSIGNED }}".
      </p>
      <p class="publish-outcomes" data-testid="publish-results-telling">
        Vendors read their result on the market's vendor page. No email is sent, so share the page's
        address with them.
      </p>
      <div v-if="vendorPageUrl" class="publish-address" data-testid="publish-results-address">
        <a
          class="publish-address-url"
          :href="vendorPageUrl"
          target="_blank"
          rel="noopener"
          data-testid="publish-results-address-url"
          >{{ vendorPageUrl }}</a
        >
        <button
          type="button"
          class="btn btn--secondary btn--compact"
          data-testid="publish-results-address-copy"
          @click="copy(vendorPageUrl)"
        >
          {{ copied === vendorPageUrl ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <p class="publish-outcomes">
        Publishing cannot be undone, and tables cannot be allocated again after it: assignments
        change only by hand.
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
  min-height: var(--target-min);
  background: var(--mm-green);
  color: white;
  /* Transparent at rest, so the disabled state draws its line without a shift (`.btn`). */
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  /* Less the line's 1px, so the button stands as tall as before it had one. */
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- a border's width, not spacing: no token says 1px, and --space-hairline is 2px */
  padding: calc(var(--space-2) - 1px) var(--space-4);
  cursor: pointer;
  font-family: 'Merge One';
  font-size: var(--text-sm);
}

.publish-button:disabled {
  /* The primitives' one disabled state (`.btn:disabled`): readable, never dimmed by opacity. */
  background: var(--mm-beige);
  color: var(--mm-text-muted-on-beige);
  border-color: var(--mm-border);
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

/* The page's address on a line of its own, Copy at its end. */
.publish-address {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
}

.publish-address-url {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--mm-text-link);
  font-size: var(--text-sm);
}
</style>
