<script setup lang="ts">
/**
 * The charts (T201): the Stats tab's figures, drawn in the app's own HTML and CSS (ADR 0015), on the
 * fixture's data at a desk and on a phone, in the tab's order. Who applied: the 359 applications
 * over time as a `ColumnChart`, a column a day over 17 days and a column a week over a long intake,
 * and the review's state as a `SplitBar`. Then the room: each day's and tier's tables asked against
 * the plan's as a `MeterBar` a row, the mark at the tables, and the tables alone before anyone
 * applies. Then how full: the seats as a `FillGrid` of sections against days, every table taken,
 * then the seats partway placed, a cell at each step, and over nine days, scrolling in its box.
 * Then what they answered: `BarLedger` as the tab passes it,
 * its answers most chosen first and folded past 8, each answer one line in a card wider than 32rem
 * and stacked in a narrower one.
 */
import { MarketPhase } from '@/assets/types/datatypes';
import BarLedger from '@/components/BarLedger.vue';
import ColumnChart from '@/components/charts/ColumnChart.vue';
import FillGrid from '@/components/charts/FillGrid.vue';
import MeterBar from '@/components/charts/MeterBar.vue';
import SplitBar from '@/components/charts/SplitBar.vue';
import { applicantStats } from '@/utils/applicantStats';
import { appliedOverTime, type AppliedOverTime } from '@/utils/appliedOverTime';
import { ledgerRows } from '@/utils/barLedger';
import { fillGrid, type FillCounts } from '@/utils/fillGrid';
import { roomCards } from '@/utils/roomRows';
import LibraryPanel from '../parts/LibraryPanel.vue';
import ReadOut from '../parts/ReadOut.vue';
import LibrarySection from '../parts/LibrarySection.vue';
import { fixture } from '../fixture';

const { applications, question, room, fill, seats } = fixture;

const submittedAt = applications.map((application) => application.submittedAt);
const statuses: Record<string, number> = {};
for (const { status } of applications) statuses[status] = (statuses[status] ?? 0) + 1;

/**
 * The file holds when each applied, not when the market opened or closed: here applications open
 * two days before the first response and close three days after the last, so quiet days at either
 * end show as gaps. The long intake opens eight weeks before the first response, past the 42 days
 * that turn a column into a week.
 */
const OPENED = '2024-02-23T09:00:00';
const CLOSED = '2024-03-15T18:00:00';
const OPENED_LONG = '2023-12-31T09:00:00';

function columns(chart: AppliedOverTime) {
  return chart.buckets.map((bucket) => ({ ...bucket, key: bucket.start }));
}
const byDay = appliedOverTime(
  { submittedAt, openedAt: OPENED, closedAt: CLOSED },
  MarketPhase.Assignment,
)!;
const byWeek = appliedOverTime(
  { submittedAt, openedAt: OPENED_LONG, closedAt: CLOSED },
  MarketPhase.Assignment,
)!;

// As the Stats tab counts the review, linking each status to the Applications tab's filter.
const review = applicantStats(
  {
    total: applications.length,
    addedByHand: 0,
    statuses,
    submittedAt,
    openedAt: OPENED,
    closedAt: CLOSED,
  },
  'library',
).byStatus;
const noFollowUp = review.map((part) =>
  part.value === 'needs_follow_up' ? { ...part, count: 0 } : part,
);

// As the Stats tab draws the room once someone applied, and before anyone has.
const [roomDays, roomTiers] = roomCards(room, true);
const [emptyDays] = roomCards(room, false);

// As the Stats tab draws How full: the fixture's seats, every table taken.
const full = fillGrid(fill)!;

/**
 * The same seats partway placed, a cell at each step: on each date, a section keeps its seats up to
 * the table numbered here and lets the rest go.
 */
const KEPT: Record<string, number[]> = {
  'North Wing': [31, 27, 18, 9],
  'South Wing': [25, 15, 5, 0],
};
function partway(dates: string[]): FillCounts {
  return {
    dates,
    sections: fill.sections.map((section) => ({
      ...section,
      cells: dates.map((date, index) => {
        const kept = KEPT[section.section]![index % fill.dates.length]!;
        const on = fill.dates[index % fill.dates.length];
        const held = seats.filter(
          (seat) => seat.section === section.section && seat.date === on && seat.table <= kept,
        );
        return { date, used: held.length, tables: section.cells[0]!.tables };
      }),
    })),
  };
}
const steps = fillGrid(partway(fill.dates))!;
/** Nine days from the first, the four days' cells over again: more than a phone's width holds. */
const NINE_DAYS = Array.from({ length: 9 }, (_, i) => `2024-04-${String(22 + i).padStart(2, '0')}`);
const nineDays = fillGrid(partway(NINE_DAYS))!;

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
    title="Who applied: ColumnChart"
    :about="`The tab's applications over time, here the fixture's ${submittedAt.length}, a column for each of the ${byDay.buckets.length} days from the day applications opened to the day they closed, so a quiet day is a gap; past 42 days a column is a week. The chart is one image named by its sentence, and its numbers are a table behind the disclosure.`"
  >
    <LibraryPanel label="A column a day: the tab's full width" class="library-wide">
      <ColumnChart
        class="library-full"
        title="When they applied"
        :columns="columns(byDay)"
        :summary="byDay.summary"
        numbers="Numbers by day"
        key-head="Day"
        count-head="Applications"
        testid="library-charts-days"
      />
      <ReadOut label="Its sentence" :value="byDay.summary" />
    </LibraryPanel>
    <LibraryPanel label="A column a week: an intake longer than six weeks" class="library-wide">
      <ColumnChart
        class="library-full"
        title="When they applied"
        :columns="columns(byWeek)"
        :summary="byWeek.summary"
        numbers="Numbers by week"
        key-head="Week"
        count-head="Applications"
        testid="library-charts-weeks"
      />
      <ReadOut label="Its sentence" :value="byWeek.summary" />
    </LibraryPanel>
  </LibrarySection>
  <LibrarySection
    title="Where the review stands: SplitBar"
    about="The tab's review, one bar of every application split by status in the Applications tab's order, each part its own fill with a white gap between; the legend under it is the text, each count a link to its filter, a zero told but not linked."
  >
    <LibraryPanel label="The fixture's review: every status" class="library-wide">
      <SplitBar
        class="library-full"
        title="Where the review stands"
        :parts="review"
        whole="applications"
        testid="library-charts-review"
      />
    </LibraryPanel>
    <LibraryPanel label="Nobody needs a follow-up: a zero, told but not linked">
      <SplitBar
        class="library-full"
        title="Where the review stands"
        :parts="noFollowUp"
        whole="applications"
        testid="library-charts-review-zero"
      />
    </LibraryPanel>
  </LibrarySection>
  <LibrarySection
    title="Is there room: MeterBar"
    about="The tab's room, a row per market day and per tier: the label, the words that carry every figure, and a bar of the tables asked against the card's largest asked or tables, so the rows compare. A 2px line marks the tables, and what is asked past them is in the attention fill. The bar is hidden from a screen reader, which reads the words. Before anyone applies a row reads its tables alone, with no bar."
  >
    <LibraryPanel v-for="card in [roomDays!, roomTiers!]" :key="card.id" :label="card.title">
      <ul class="library-meters">
        <li v-for="row in card.rows" :key="row.key">
          <MeterBar
            :label="row.label"
            :words="row.words"
            :value="row.asked"
            :mark="row.tables"
            :scale="card.scale"
            :testid="`library-charts-room-${card.id}`"
            :data-testid="`library-charts-room-${card.id}`"
          />
        </li>
      </ul>
      <p class="library-note">{{ card.note }}</p>
    </LibraryPanel>
    <LibraryPanel label="Before anyone applies: the tables alone">
      <ul class="library-meters">
        <li v-for="row in emptyDays!.rows" :key="row.key">
          <MeterBar
            :label="row.label"
            :words="row.words"
            :value="row.asked"
            :mark="row.tables"
            :scale="emptyDays!.scale"
            testid="library-charts-room-empty"
            data-testid="library-charts-room-empty"
          />
        </li>
      </ul>
    </LibraryPanel>
  </LibrarySection>
  <LibrarySection
    title="How full: FillGrid"
    about="The tab's How full, once an assignment is stored: a table of sections down the side and market days across, each cell its tables used of its tables, shaded a step darker from empty to up to a third, two thirds, past that and full, with a total row per day. Each cell's step is said in words to a screen reader, so the shade carries nothing alone. A table wider than its card scrolls in its own box, the sections held at the left."
  >
    <LibraryPanel label="The fixture's seats: every table taken" class="library-wide">
      <FillGrid
        class="library-full"
        title="Tables used of each section's tables, each day"
        :grid="full"
        testid="library-charts-fill"
      />
    </LibraryPanel>
    <LibraryPanel label="Partway placed: a cell at each step" class="library-wide">
      <FillGrid
        class="library-full"
        title="Tables used of each section's tables, each day"
        :grid="steps"
        testid="library-charts-fill-steps"
      />
    </LibraryPanel>
    <LibraryPanel label="Nine days: wider than a phone, scrolling in its box" class="library-wide">
      <FillGrid
        class="library-full"
        title="Tables used of each section's tables, each day"
        :grid="nineDays"
        testid="library-charts-fill-days"
      />
    </LibraryPanel>
  </LibrarySection>
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

.library-meters {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}

.library-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

/* About half the tab's content at a 1440 desk, the width a lone card takes there. */
.library-half {
  width: 100%;
  max-width: 40rem;
}
</style>
