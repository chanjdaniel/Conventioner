<script setup lang="ts">
/**
 * The charts (T201): the Stats tab's figures, drawn in the app's own HTML and CSS (ADR 0015), on the
 * fixture's data at a desk and on a phone. It starts with what they answered: `BarLedger` as the tab
 * passes it, its answers most chosen first and folded past 8, each answer one line in a card wider
 * than 32rem and stacked in a narrower one.
 */
import BarLedger from '@/components/BarLedger.vue';
import { ledgerRows } from '@/utils/barLedger';
import LibraryPanel from '../parts/LibraryPanel.vue';
import LibrarySection from '../parts/LibrarySection.vue';
import { fixture } from '../fixture';

const { applications, question } = fixture;

/** As the Stats tab folds a question's answers. */
const ANSWERS_SHOWN = 8;

// A share is of every application, as the Stats tab's is of everyone in the group.
const answers = ledgerRows(
  question.options.map(({ label, count }) => ({ label, value: label, count })),
  applications.length,
);
</script>

<template>
  <LibrarySection
    title="What they answered: BarLedger"
    :about="`The tab's card per question, here the fixture's ${answers.length} answers, the ${ANSWERS_SHOWN} most chosen first and the rest one press away. In a window 1280px wide or more the tab's cards stand two to a row, each wider than 32rem, so an answer is one line: its label, its bar and its count.`"
  >
    <LibraryPanel
      :label="`Half a desk's tab, 40rem at most: one line each past 32rem, folded past ${ANSWERS_SHOWN}`"
      class="library-wide"
    >
      <BarLedger
        class="library-half"
        :title="question.label"
        :rows="answers"
        testid="library-charts-answers"
        whole="applications"
        :fold="ANSWERS_SHOWN"
      />
    </LibraryPanel>
    <LibraryPanel label="A card narrower than 32rem: the bar under each answer">
      <BarLedger
        class="library-full"
        :title="question.label"
        :rows="answers"
        testid="library-charts-narrow"
        whole="applications"
        :fold="ANSWERS_SHOWN"
      />
    </LibraryPanel>
    <LibraryPanel label="A short question: every answer, no button">
      <BarLedger
        class="library-full"
        title="A question of five answers"
        :rows="answers.slice(0, 5)"
        testid="library-charts-short"
        whole="applications"
        :fold="ANSWERS_SHOWN"
      />
    </LibraryPanel>
  </LibrarySection>
</template>

<style scoped>
.library-wide {
  grid-column: 1 / -1;
}

.library-full {
  width: 100%;
}

/* About half the tab's content at a 1440 desk, the width a lone card takes there. */
.library-half {
  width: 100%;
  max-width: 40rem;
}
</style>
