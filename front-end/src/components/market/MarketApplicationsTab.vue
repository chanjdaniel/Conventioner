<script setup lang="ts">
/**
 * The applications tab's body (E18/F02/S01).
 *
 * Extracted from `MarketSetupView`, which held all four tab bodies inline across 1300 lines. The
 * DOM and every `data-testid` are unchanged - this is the prefactor that makes `S02`'s shell
 * change a shell change rather than a whole-file rewrite carrying a fifteen-spec migration.
 *
 * State arrives as props rather than being reached for, so a later story can mount this under a
 * different parent without rewriting it.
 */
import { computed, ref } from 'vue';
import { marketPath } from '@/utils/market';
import { useRoute, useRouter } from 'vue-router';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import ApplicationsAll from '@/components/application/ApplicationsAll.vue';
import PublishResults from '@/components/application/PublishResults.vue';
import { withoutQueryKey } from '@/utils/routeQuery';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { intakeModeOf } from '@/utils/marketGuide';
import { canImportInto } from '@/utils/importPhase';
import { reviewView, type ReviewView } from '@/utils/reviewQueue';

const props = defineProps<{
  market: Market | null;
  visible: boolean;
  importRefusalReason: string | null;
}>();

const router = useRouter();
const route = useRoute();

/** The application this page's address names, as an assignment that refused links to it (bug 42). */
const namedApplication = computed(() => String(route.query.application ?? ''));

/**
 * All, or One by one (E34/F04/S01): the review's two views, the choice in the address so a reload
 * or a shared link opens the same one. All is first and the default (E38/F05/S01), so it drops
 * `view`, and the application a link named with it: a named application is One by one's card.
 */
const view = computed(() => reviewView(route.query));
function showView(next: ReviewView) {
  const query = withoutQueryKey(withoutQueryKey(route.query, 'view'), 'application');
  void router.replace({ query: next === 'one' ? { ...route.query, view: 'one' } : query });
}

/**
 * Published by the review's view once it has read its list, so this surface can lead with it while
 * reviewing; null until then, so a list that failed to load is not counted as nothing left.
 */
const undecided = ref<number | null>(null);

/** Its vendors apply on the organizer's own Google Form and arrive by import (E31/F03). */
const csvMarket = computed(() => intakeModeOf(props.market) === IntakeMode.Csv);

/**
 * Importing is offered only while the market is importing (E32/F02/S03). Reviewing is a step of its
 * own: the line above the queue says which phase this is in words, and the way back to importing is
 * the rail's "Import more responses", so a disabled Import button in review only blurred the two.
 */
const importing = computed(() => csvMarket.value && canImportInto(props.market?.phase));

/**
 * Which of its three phases this surface is in, IN WORDS (E18/F02/S03).
 *
 * One surface serves applications-open, applications-closed and review, because ticket 11 measured
 * the difference and found it small: recording a verdict has no phase gate at all, importing spans
 * two of the three, and applications-closed changes nothing for a CSV market. Three screens would
 * have meant two near-identical ones on every market this product currently serves.
 *
 * The cost of that is the rail showing three steps over one place, and the mitigation is this
 * line. Hiding the Import button is NOT stating the condition: a surface whose only difference is
 * a missing control teaches an organizer that the phases are arbitrary, and this project has been
 * caught by exactly that before - a terminal state signalled only by strikethrough read as
 * "stopped" rather than "archived".
 */
const condition = computed(() => {
  const undecidedPhrase =
    undecided.value === 1 ? '1 application' : `${undecided.value} applications`;
  switch (props.market?.phase) {
    // What arrives here, and how. The next step is the rail's to say (E31/F02/S02), so these
    // describe the page rather than repeat it.
    case MarketPhase.ApplicationsOpen:
      // Only a form market's applications arrive by themselves; a CSV market's come in by import
      // (bug 16), and nothing on it suggests vendors apply here (E31/F03/S03).
      return csvMarket.value
        ? 'The responses you import from your Google Form arrive here, ready to review.'
        : 'This market is open for applications. New ones will keep arriving here.';
    case MarketPhase.ApplicationsClosed:
      // Reached on the Google Form path only by the single edge, and still importing as far as
      // this page is concerned (E32/F02/S01): nothing has been decided about what arrived.
      return csvMarket.value
        ? 'Review has not begun. The responses you import from your Google Form arrive here.'
        : 'This market is no longer taking applications. No new ones will arrive.';
    case MarketPhase.Review:
      if (undecided.value === null) {
        return 'Every application must be decided before this market can assign.';
      }
      return undecided.value === 0
        ? 'Every application has been decided. This market is ready to assign.'
        : `${undecidedPhrase} still to decide. Every one must be decided before this market can assign.`;
    // Past review every application is decided, and the assignment is made from them (ticket 02).
    // The verdicts settled on the way in (E36/F01/S01): a mistake is fixed with a seat.
    case MarketPhase.Assignment:
      return 'The review is closed: every verdict settled when the assignment began. The assignment works from the ones you approved, and a seat is changed by hand on the Result page.';
    case MarketPhase.Offers:
    case MarketPhase.MarketDays:
      return 'The review is closed: every verdict settled when the assignment began. The assignment was made from the ones you approved.';
    default:
      return '';
  }
});
</script>

<template>
  <!-- `settings-body` lays its children out in a row, which is right for the two-card tabs
       but put the import button in a dead column beside the list. This one stacks. -->
  <div class="settings-body settings-body-stacked">
    <!-- Which of the three phases this is, said rather than implied. -->
    <p
      v-if="condition"
      class="applications-condition"
      data-testid="market-setup-applications-condition"
    >
      {{ condition }}
    </p>
    <!-- A step for the market, over whichever view is open (E38/F05/S01). -->
    <PublishResults :market="market" />
    <!-- The button used to be live in every phase and navigate to a page whose only
         content was the refusal. It is drawn only while the market is importing now; the
         refusal it can still carry is the person's - only an admin imports (bug 37). -->
    <!-- Importing is the CSV path's (E31/F03/S04): a market whose vendors apply on its own page
         takes nothing from a file, and was offered it as its primary button. -->
    <div v-if="importing" class="applications-toolbar">
      <button
        class="import-entry-button"
        :disabled="importRefusalReason !== null"
        data-testid="market-setup-import-button"
        @click="market && router.push(marketPath(market.id, 'import'))"
      >
        Import from CSV
      </button>
      <span
        v-if="importRefusalReason"
        class="import-entry-hint import-entry-hint--blocked"
        data-testid="market-setup-import-blocked-reason"
      >
        {{ importRefusalReason }}
      </span>
      <span v-else class="import-entry-hint">
        Bring in the responses you already collected, as a CSV from any form tool or spreadsheet.
      </span>
    </div>
    <!-- Which view, said over the switch and named by those words (E38/F05/S01). -->
    <div class="review-views">
      <span id="review-views-label" class="field-label">How do you want to review?</span>
      <div
        class="review-views-switch"
        role="group"
        aria-labelledby="review-views-label"
        aria-describedby="review-views-hint"
      >
        <button
          type="button"
          class="btn btn--compact"
          :class="view === 'all' ? 'btn--primary' : 'btn--secondary'"
          :aria-pressed="view === 'all'"
          data-testid="applications-view-all"
          @click="showView('all')"
        >
          All
        </button>
        <button
          type="button"
          class="btn btn--compact"
          :class="view === 'one' ? 'btn--primary' : 'btn--secondary'"
          :aria-pressed="view === 'one'"
          data-testid="applications-view-one"
          @click="showView('one')"
        >
          One by one
        </button>
      </div>
      <p id="review-views-hint" class="review-views-hint">
        All lists every application, to filter and decide several at once. One by one shows one
        application at a time, with every answer.
      </p>
    </div>
    <ApplicationsAll
      v-if="view === 'all'"
      :market="market"
      @update:undecidedCount="undecided = $event"
    />
    <ApplicationMonitor
      v-else
      :market="market"
      :visible="visible"
      :named="namedApplication"
      @update:undecidedCount="undecided = $event"
    />
  </div>
</template>

<style scoped>
.review-views {
  margin-bottom: var(--space-4);
}

.review-views-switch {
  display: flex;
  gap: var(--space-1);
}

.review-views-hint {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.applications-condition {
  margin: 0 0 var(--space-4);
  font-size: var(--text-sm);
  color: var(--mm-black);
  line-height: 1.4;
}

.settings-body {
  align-self: stretch;
  display: flex;
  gap: var(--space-8);
  padding: var(--space-6);
}

/* Both classes, to outrank the 32px gap `MarketSetupView`'s own `.settings-body` puts on this root:
   the rows here space themselves. */
.settings-body.settings-body-stacked {
  flex-direction: column;
  gap: 0;
  /* The review queue grows with the application in front of the organizer, and the reviewed list
     grows with the market. Without its own scroll the content spilled out past the white panel,
     where it was unreachable. The other tabs each scroll inside their own card; this one has no
     card to scroll inside. */
  overflow-y: auto;
}

.applications-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.import-entry-button {
  height: 36px;
  padding: 0 var(--space-4);
  border-radius: var(--radius-control);
  border: 1px solid var(--mm-green);
  background: var(--mm-green);
  color: white;
  font-size: var(--text-sm);
  cursor: pointer;
}

.import-entry-button:disabled {
  background: var(--mm-border);
  border-color: var(--mm-border);
  color: var(--mm-black);
  cursor: not-allowed;
}

.import-entry-hint {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.import-entry-hint--blocked {
  color: var(--mm-text-yellow);
  max-width: 60ch;
}
</style>
