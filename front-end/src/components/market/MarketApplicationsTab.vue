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
import { withoutQueryKey } from '@/utils/routeQuery';
import { IntakeMode, MarketPhase, type Market } from '@/assets/types/datatypes';
import { intakeModeOf } from '@/utils/marketGuide';

const props = defineProps<{
  market: Market | null;
  visible: boolean;
}>();

const router = useRouter();
const route = useRoute();

/** The application this page's address names, as an assignment that refused links to it (bug 42). */
const namedApplication = computed(() => String(route.query.application ?? ''));

/**
 * One by one, or All (E34/F04/S01): the review's two views, the choice in the address so a reload
 * or a shared link opens the same one.
 */
const allView = computed(() => route.query.view === 'all');
function showView(all: boolean) {
  void router.replace({
    query: all ? { ...route.query, view: 'all' } : withoutQueryKey(route.query, 'view'),
  });
}

/** Published by the review queue, so this surface can lead with it while reviewing. */
const undecided = ref(0);

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
  const undecidedPhrase =
    undecided.value === 1 ? '1 application' : `${undecided.value} applications`;
  switch (props.market?.phase) {
    case MarketPhase.Applications: {
      // What arrives here, and how: only a form market's applications arrive by themselves; a CSV
      // market's come in by import (bug 16), and nothing on it suggests vendors apply here.
      const arriving = csvMarket.value
        ? 'Every response you imported from your Google Form is here.'
        : props.market?.applicationsStopped
          ? 'This market is not taking applications. No new ones will arrive.'
          : 'This market is open for applications. New ones keep arriving here.';
      const deciding =
        undecided.value === 0
          ? 'Every application has been decided.'
          : `${undecidedPhrase} still to decide. Every one must be decided before this market can assign.`;
      return `${arriving} ${deciding}`;
    }
    // Past the stage every application is decided, and the assignment is made from them (ticket
    // 02). The verdicts settled on the way in (E36/F01/S01): a mistake is fixed with a seat.
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
    <div class="review-views" role="group" aria-label="How to review">
      <button
        type="button"
        class="btn btn--compact"
        :class="allView ? 'btn--secondary' : 'btn--primary'"
        :aria-pressed="!allView"
        data-testid="applications-view-one"
        @click="showView(false)"
      >
        One by one
      </button>
      <button
        type="button"
        class="btn btn--compact"
        :class="allView ? 'btn--primary' : 'btn--secondary'"
        :aria-pressed="allView"
        data-testid="applications-view-all"
        @click="showView(true)"
      >
        All
      </button>
    </div>
    <ApplicationsAll v-if="allView" :market="market" @update:undecidedCount="undecided = $event" />
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
  display: flex;
  gap: var(--space-1);
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

.settings-body-stacked {
  flex-direction: column;
  gap: 0;
  /* The review queue grows with the application in front of the organizer, and the reviewed list
     grows with the market. Without its own scroll the content spilled out past the white panel,
     where it was unreachable. The other tabs each scroll inside their own card; this one has no
     card to scroll inside. */
  overflow-y: auto;
}
</style>
