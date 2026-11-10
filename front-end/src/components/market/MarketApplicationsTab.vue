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
import { useRoute, useRouter } from 'vue-router';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import ApplicationsAll from '@/components/application/ApplicationsAll.vue';
import PublishResults from '@/components/application/PublishResults.vue';
import ReviewersPanel from '@/components/market/ReviewersPanel.vue';
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

/**
 * Bumped by every change of reviewers (E38/F07/S02): the deal moved applications between them, so
 * the open view reads its list again to show whom each went to.
 */
const dealt = ref(0);

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
    // What arrives here, and how: only a form market's applications arrive by themselves. A CSV
    // market's come in by import (bug 16), which the rail's sentence just above already says
    // ("Every imported response is here."), so the page says nothing more (T96). How many are left
    // to decide is the rail's to say, with the step they hold.
    case MarketPhase.Applications:
      return csvMarket.value
        ? ''
        : props.market?.applicationsStopped
          ? 'This market is not taking applications. No new ones will arrive.'
          : 'This market is open for applications. New ones keep arriving here.';
    // Past the stage the review is closed (E36/F01/S01), and the server says why and what to do
    // instead in the words of where the market stands (T207): Back to review while tables are
    // allocated, a seat on Assignments once results are published or the market went live. Said
    // here once, over both views, where the review's controls were; the browser keeps no copy.
    case MarketPhase.Assignment:
    case MarketPhase.Offers:
    case MarketPhase.MarketDays:
      return props.market?.verdictsSettledReason ?? '';
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
    <!-- Who reviews which application, while the review is open (E38/F07/S02). -->
    <ReviewersPanel :market="market" @saved="dealt++" />
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
    <ApplicationsAll v-if="view === 'all'" :market="market" :dealt="dealt" />
    <ApplicationMonitor
      v-else
      :market="market"
      :visible="visible"
      :named="namedApplication"
      :dealt="dealt"
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

/* "All" is a word wide; a target is never narrower than it is tall. */
.review-views-switch .btn {
  min-width: var(--target-min);
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
}

/* The phone's gutter, as the other pages that fit a phone take it (T180). */
@media (width <= 640px) {
  .settings-body.settings-body-stacked {
    padding: var(--space-4);
  }
}
</style>
