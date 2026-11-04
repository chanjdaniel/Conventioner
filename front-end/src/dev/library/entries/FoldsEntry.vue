<script setup lang="ts">
/**
 * The folds (T200): L11's answer bars on the Stats tab, folded past 10 beside today's every bar, and
 * L7's tables on the Assignments page by date and section, each section folded past 20. The seats
 * are real `ResultSeat`s, each row reading out its own presses (`SeatRow`).
 *
 * Today's bars sit in a box of their own, or the rest of this page would lie 228 bars below them. The
 * label says so, since on the tab they run the page's length.
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import BarLedger from '@/components/BarLedger.vue';
import RowGroup from '@/components/RowGroup.vue';
import { ledgerRows } from '@/utils/barLedger';
import { getFormattedDate } from '@/utils/utils';
import type { VendorNames } from '@/utils/vendorIdentity';
import ChoicesForYou from '../parts/ChoicesForYou.vue';
import LibraryPanel from '../parts/LibraryPanel.vue';
import LibrarySection from '../parts/LibrarySection.vue';
import ReadOut from '../parts/ReadOut.vue';
import SeatRow from '../parts/SeatRow.vue';
import TodayAndProposed from '../parts/TodayAndProposed.vue';
import { fixture, type LibraryFixture } from '../fixture';
import { LIBRARY_PATH } from '../catalog';

const { applications, question, seats } = fixture;

/** How many bars and how many tables show before the fold, to start: Daniel's to choose. */
const BARS_SHOWN = 10;
const TABLES_SHOWN = 20;

// L11: a share is of every application, as the Stats tab's is of everyone in the group.
const counted = question.options.map(({ label, count }) => ({ label, value: label, count }));
const answers = ledgerRows(counted, applications.length);
/** The same rows out of count order, as a form's order would have them. */
const answersByLabel = [...answers].sort((a, b) => a.label.localeCompare(b.label));
/** A few rows that lead somewhere; on this page, back to it with the answer in the address. */
const answersThatLead = ledgerRows(
  counted.slice(0, 4).map((row) => ({
    ...row,
    to: { path: `${LIBRARY_PATH}/folds`, query: { answer: row.value } },
  })),
  applications.length,
);
const route = useRoute();
const answerLedTo = computed(() =>
  typeof route.query.answer === 'string' ? route.query.answer : null,
);

// L7: the seats by date, then by section, each table with the address and name of who holds it.
type Seat = LibraryFixture['seats'][number];

const emailOf = new Map(applications.map(({ id, email }) => [id, email]));
const names: VendorNames = Object.fromEntries(
  applications.map(({ email, name }) => [email.toLowerCase(), name]),
);
const seatEmail = (seat: Seat) => emailOf.get(seat.application)!;
const seatCode = (seat: Seat) => `${seat.section.charAt(0)}${seat.table}`;
const seatKey = (seat: Seat) => `${seat.date}-${seat.section}-${seat.table}`;
/** "North Wing" on a date, as a test id: `library-l7-2024-04-22-north`. */
const sectionTestid = (date: string, section: string) =>
  `library-l7-${date}-${section.split(' ')[0]!.toLowerCase()}`;

const dates = [...new Set(seats.map((seat) => seat.date))].map((date) => {
  const onDate = seats.filter((seat) => seat.date === date);
  return {
    date,
    label: getFormattedDate(date),
    count: onDate.length,
    sections: [...new Set(onDate.map((seat) => seat.section))].map((section) => ({
      section,
      seats: onDate.filter((seat) => seat.section === section),
    })),
  };
});
const firstSection = dates[0]!.sections[0]!;

/** The fixture's three longest answers, standing for a section whose name runs over the line. */
const longName = question.options
  .map(({ label }) => label)
  .sort((a, b) => b.length - a.length)
  .slice(0, 3)
  .join(', ');

/** RowGroup at each count it can be given, on the first section's tables. */
const groupStates = [
  {
    id: 'under',
    label: `Under the fold: ${TABLES_SHOWN - 8} tables, no button`,
    heading: firstSection.section,
    items: firstSection.seats.slice(0, TABLES_SHOWN - 8),
    fold: TABLES_SHOWN,
  },
  {
    id: 'at',
    label: `At the fold: ${TABLES_SHOWN} tables, no button`,
    heading: firstSection.section,
    items: firstSection.seats.slice(0, TABLES_SHOWN),
    fold: TABLES_SHOWN,
  },
  {
    id: 'past',
    label: `One past: ${TABLES_SHOWN + 1} tables`,
    heading: firstSection.section,
    items: firstSection.seats.slice(0, TABLES_SHOWN + 1),
    fold: TABLES_SHOWN,
  },
  {
    id: 'five',
    label: 'Folded past 5',
    heading: firstSection.section,
    items: firstSection.seats,
    fold: 5,
  },
  {
    id: 'long',
    label: 'A heading longer than the line: its button wraps',
    heading: longName,
    items: firstSection.seats,
    fold: 2,
  },
];
</script>

<template>
  <LibrarySection
    title="L11: An answer's bars, on the Stats tab"
    :about="`One bar per answer the question offers, ${answers.length} here, so one question fills the tab. The fold keeps the ${BARS_SHOWN} most chosen and says how many are left. The fixture keeps the answers most chosen first; a real question's come in the form's order.`"
  >
    <TodayAndProposed
      :today="`Today: every bar, all ${answers.length}, in a box here so this page goes on; on the tab they run its whole length`"
      :proposed="`Proposed: the first ${BARS_SHOWN} by count, the rest unfolding in place`"
    >
      <template #today>
        <div
          class="library-today-box"
          role="group"
          aria-label="Today's bars"
          tabindex="0"
          data-testid="library-l11-today-box"
        >
          <BarLedger
            :title="question.label"
            :rows="answers"
            testid="library-l11-today"
            whole="applicants"
          />
        </div>
      </template>
      <template #proposed>
        <BarLedger
          :title="question.label"
          :rows="answers"
          testid="library-l11"
          whole="applicants"
          :fold="BARS_SHOWN"
        />
      </template>
    </TodayAndProposed>

    <LibraryPanel :label="`Under the fold: ${BARS_SHOWN - 2} answers, no button`">
      <BarLedger
        class="library-full"
        title="A short question"
        :rows="answers.slice(0, BARS_SHOWN - 2)"
        testid="library-bars-under"
        whole="applicants"
        :fold="BARS_SHOWN"
      />
    </LibraryPanel>
    <LibraryPanel :label="`At the fold: ${BARS_SHOWN} answers, no button`">
      <BarLedger
        class="library-full"
        title="A question of just this many"
        :rows="answers.slice(0, BARS_SHOWN)"
        testid="library-bars-at"
        whole="applicants"
        :fold="BARS_SHOWN"
      />
    </LibraryPanel>
    <LibraryPanel :label="`One past: ${BARS_SHOWN + 1} answers`">
      <BarLedger
        class="library-full"
        title="One left to fold"
        :rows="answers.slice(0, BARS_SHOWN + 1)"
        testid="library-bars-past"
        whole="applicants"
        :fold="BARS_SHOWN"
      />
    </LibraryPanel>
    <LibraryPanel label="Given out of order: still the most chosen first">
      <BarLedger
        class="library-full"
        :title="question.label"
        :rows="answersByLabel"
        testid="library-bars-order"
        whole="applicants"
        :fold="BARS_SHOWN"
      />
    </LibraryPanel>
    <LibraryPanel label="Rows that lead somewhere, folded past 2">
      <BarLedger
        class="library-full"
        :title="question.label"
        :rows="answersThatLead"
        testid="library-bars-links"
        whole="applicants"
        action="Show these applications"
        :fold="2"
      />
      <ReadOut label="Led to" :value="answerLedTo" />
    </LibraryPanel>
    <LibraryPanel label="Folded past 5">
      <BarLedger
        class="library-full"
        :title="question.label"
        :rows="answers"
        testid="library-bars-five"
        whole="applicants"
        :fold="5"
      />
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="L7: The tables, on the Assignments page"
    :about="`Every table of every section draws today, ${seats.length} over these ${dates.length} dates. The groups stay, and each section keeps its first ${TABLES_SHOWN}. Change and a name only read out here, under the row pressed.`"
  >
    <LibraryPanel
      v-for="group in dates"
      :key="group.date"
      :label="`${group.label}: ${group.count} tables`"
      class="library-wide"
    >
      <div class="library-sections">
        <RowGroup
          v-for="{ section, seats: sectionSeats } in group.sections"
          :key="section"
          :heading="section"
          :items="sectionSeats"
          :itemKey="seatKey"
          :level="4"
          :fold="TABLES_SHOWN"
          :testid="sectionTestid(group.date, section)"
        >
          <template #row="{ item }">
            <SeatRow :code="seatCode(item)" :email="seatEmail(item)" :names="names" />
          </template>
        </RowGroup>
      </div>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="A group of rows, its states"
    about="RowGroup on the first section's tables, at each count it can be given."
  >
    <LibraryPanel v-for="state in groupStates" :key="state.id" :label="state.label">
      <RowGroup
        class="library-full"
        :heading="state.heading"
        :items="state.items"
        :itemKey="seatKey"
        :level="4"
        :fold="state.fold"
        :testid="`library-group-${state.id}`"
      >
        <template #row="{ item }">
          <SeatRow :code="seatCode(item)" :email="seatEmail(item)" :names="names" />
        </template>
      </RowGroup>
    </LibraryPanel>
  </LibrarySection>

  <ChoicesForYou>
    <li>
      <strong>Bars before the fold:</strong> {{ BARS_SHOWN }} to start. "Folded past 5" shows a
      shorter one.
    </li>
    <li>
      <strong>Unfolding the bars in place, or in a dialog:</strong> in place here, so every answer
      is one press away and the card just grows, up to {{ answers.length }} bars on the tab again. A
      dialog would keep the tab short and could find an answer.
    </li>
    <li>
      <strong>The bars' order:</strong> by count, folded or not, where the tab today keeps the
      form's order. Should a question of few answers keep the form's order, say one that never
      folds?
    </li>
    <li>
      <strong>Rows before a group folds:</strong> {{ TABLES_SHOWN }} to start, so the 31 of North
      Wing and the 28 of South Wing each show {{ TABLES_SHOWN }} with little left to hide. "Folded
      past 5" shows a shorter one.
    </li>
    <li>
      <strong>Unfolding a section in place:</strong> in place too, one section at a time. A press
      per section, on every date, to read it all: should there be one "Show all" for the page, too?
    </li>
    <li>
      <strong>Finding a vendor on the Assignments page:</strong> the browser's own find (Ctrl+F)
      cannot reach a folded row. The page's search narrows the rows first, so what it finds shows,
      unless more than {{ TABLES_SHOWN }} match in one section. Is that enough?
    </li>
    <li>
      <strong>"Show fewer" at the foot:</strong> the button stays under the rows, so after 228 bars
      it is a long way down. Keep it there, or put it at the top of the card as well?
    </li>
  </ChoicesForYou>
</template>

<style scoped>
.library-wide {
  grid-column: 1 / -1;
}

.library-full {
  width: 100%;
}

.library-sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  min-width: 0;
}

/* Tall enough to see the bars run on, short enough that the page does too. */
.library-today-box {
  max-height: 32rem;
  overflow-y: auto;
  border-radius: var(--radius-card);
}

/* The box clips an outer halo, so the keyboard's is drawn inside it. */
.library-today-box:focus-visible {
  box-shadow: var(--focus-halo-inset);
}
</style>
