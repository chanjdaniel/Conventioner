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
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import ApplicationsAll from '@/components/application/ApplicationsAll.vue';
import PublishResults from '@/components/application/PublishResults.vue';
import { withoutQueryKey } from '@/utils/routeQuery';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { intakeModeOf } from '@/utils/marketGuide';
import { reviewView, type ReviewView } from '@/utils/reviewQueue';

const props = defineProps<{
  market: Market | null;
  visible: boolean;
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

/** Its vendors apply on the organizer's own Google Form and arrive by import (E31/F03). */
const csvMarket = computed(() => intakeModeOf(props.market) === IntakeMode.Csv);

/**
 * Where the market stands, IN WORDS (E18/F02/S03).
 *
 * One surface serves the whole stage where applications arrive and are reviewed (E38/F04/S01), on
 * both paths, so this line says what is true of it now. It offers no import on either path: a
 * Google Form market's first import is the rail's step out of draft and a late export its Redo
 * import, and an own-form market takes nothing from a file. The next step is the rail's to say
 * (E31/F02/S02), so these describe the page rather than repeat it.
 */
const condition = computed(() => {
  switch (props.market?.phase) {
    // What arrives here, and how: only a form market's applications arrive by themselves; a CSV
    // market's come in by import (bug 16), and nothing on it suggests vendors apply here. How many
    // are left to decide is the rail's to say, with the step they hold.
    case MarketPhase.Applications:
      return csvMarket.value
        ? 'Every response you imported from your Google Form is here.'
        : props.market?.applicationsStopped
          ? 'This market is not taking applications. No new ones will arrive.'
          : 'This market is open for applications. New ones keep arriving here.';
    // Past the stage every application is decided, and the assignment is made from them (ticket
    // 02). The verdicts settled on the way in (E36/F01/S01): a mistake is fixed with an assignment.
    case MarketPhase.Assignment:
      return 'The review is closed: every verdict settled when the market entered Assignment. Tables are allocated from the ones you approved, and an assignment is changed by hand on the Result page.';
    case MarketPhase.Offers:
    case MarketPhase.MarketDays:
      return 'The review is closed: every verdict settled when the market entered Assignment. Tables were allocated from the ones you approved.';
    default:
      return '';
  }
});
</script>

<template>
  <!-- `settings-body` lays its children out in a row, which is right for the two-card tabs.
       This one stacks. -->
  <div class="settings-body settings-body-stacked">
    <!-- Where the market stands, said rather than implied. -->
    <p
      v-if="condition"
      class="applications-condition"
      data-testid="market-setup-applications-condition"
    >
      {{ condition }}
    </p>
    <!-- A step for the market, over whichever view is open (E38/F05/S01). -->
    <PublishResults :market="market" />
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
    <ApplicationsAll v-if="view === 'all'" :market="market" />
    <ApplicationMonitor v-else :market="market" :visible="visible" :named="namedApplication" />
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
</style>
