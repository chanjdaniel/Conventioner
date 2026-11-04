<script setup lang="ts">
/**
 * The folds (T200): L11's answer bars on the Stats tab, folded past 10 beside today's every bar, and
 * L7's seats on the Assignments page by date and section, each section folded past 20. The seats are
 * real `ResultSeat`s, whose presses are only read out.
 *
 * Today's bars sit in a box of their own, or the rest of this page would lie 228 bars below them. The
 * label says so, since on the tab they run the page's length.
 */
import { ref } from 'vue';
import BarLedger from '@/components/BarLedger.vue';
import RowGroup from '@/components/RowGroup.vue';
import { ledgerRows } from '@/utils/barLedger';
import { statusLabel } from '@/utils/verdicts';
import { getFormattedDate } from '@/utils/utils';
import { vendorHeadline, type VendorNames } from '@/utils/vendorIdentity';
import ChoicesForYou from '../parts/ChoicesForYou.vue';
import LibraryPanel from '../parts/LibraryPanel.vue';
import LibrarySection from '../parts/LibrarySection.vue';
import ReadOut from '../parts/ReadOut.vue';
import SeatRow from '../parts/SeatRow.vue';
import TodayAndProposed from '../parts/TodayAndProposed.vue';
import { fixture, type LibraryFixture } from '../fixture';
import { LIBRARY_PATH } from '../catalog';

const { applications, question, seats } = fixture;

/** Where the bars fold and where the sections do, to start: Daniel's to choose. */
const BARS = 10;
const ROWS = 20;

// L11: a share is of every application, as the Stats tab's is of everyone in the group.
const answers = ledgerRows(
  question.options.map(({ label, count }) => ({ label, value: label, count })),
  applications.length,
);
/** The same rows out of count order, as a form's order would have them. */
const answersByLabel = [...answers].sort((a, b) => a.label.localeCompare(b.label));

const statusCounts = new Map<string, number>();
for (const { status } of applications) {
  statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
}
const byStatus = ledgerRows(
  [...statusCounts].map(([status, count]) => ({
    label: statusLabel(status),
    value: status,
    count,
    to: { path: `${LIBRARY_PATH}/folds`, query: { status } },
  })),
  applications.length,
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
const someSeats = (count: number) => firstSection.seats.slice(0, count);

/** The longest answer the fixture holds, standing for a section with a long name. */
const longName = question.options
  .map(({ label }) => label)
  .reduce((a, b) => (b.length > a.length ? b : a));

const pressed = ref<string | null>(null);
function pressedChange(seat: Seat) {
  pressed.value = `Change ${seatCode(seat)}, ${vendorHeadline(seatEmail(seat), names)}`;
}
function pressedName(seat: Seat) {
  pressed.value = `The drawer of ${vendorHeadline(seatEmail(seat), names)}`;
}
</script>

<template>
  <LibrarySection
    title="L11: An answer's bars, on the Stats tab"
    :about="`One bar per answer the question offers, ${answers.length} here, so one question fills the tab. The fold keeps the ${BARS} most chosen and says how many are left. The fixture keeps the answers most chosen first; a real question's come in the form's order.`"
  >
    <TodayAndProposed
      :today="`Today: every bar, all ${answers.length}, in a box here so this page goes on; on the tab they run its whole length`"
      :proposed="`Proposed: the first ${BARS} by count, the rest unfolding in place`"
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
            whole="applications"
          />
        </div>
      </template>
      <template #proposed>
        <BarLedger
          :title="question.label"
          :rows="answers"
          testid="library-l11"
          whole="applications"
          :fold="BARS"
        />
      </template>
    </TodayAndProposed>

    <LibraryPanel :label="`Under the fold: ${BARS - 2} answers, no button`">
      <BarLedger
        class="library-full"
        title="A short question"
        :rows="answers.slice(0, BARS - 2)"
        testid="library-bars-under"
        whole="applications"
        :fold="BARS"
      />
    </LibraryPanel>
    <LibraryPanel :label="`At the fold: ${BARS} answers, no button`">
      <BarLedger
        class="library-full"
        title="A question of just this many"
        :rows="answers.slice(0, BARS)"
        testid="library-bars-at"
        whole="applications"
        :fold="BARS"
      />
    </LibraryPanel>
    <LibraryPanel :label="`One past: ${BARS + 1} answers`">
      <BarLedger
        class="library-full"
        title="One left to fold"
        :rows="answers.slice(0, BARS + 1)"
        testid="library-bars-past"
        whole="applications"
        :fold="BARS"
      />
    </LibraryPanel>
    <LibraryPanel label="Given out of order: still the most chosen first">
      <BarLedger
        class="library-full"
        :title="question.label"
        :rows="answersByLabel"
        testid="library-bars-order"
        whole="applications"
        :fold="BARS"
      />
    </LibraryPanel>
    <LibraryPanel label="Rows that lead somewhere, folded past 2">
      <BarLedger
        class="library-full"
        title="By status"
        :rows="byStatus"
        testid="library-bars-links"
        whole="applications"
        action="Show these applications"
        :fold="2"
      />
    </LibraryPanel>
    <LibraryPanel label="Folded past 5">
      <BarLedger
        class="library-full"
        :title="question.label"
        :rows="answers"
        testid="library-bars-five"
        whole="applications"
        :fold="5"
      />
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="L7: The tables, on the Assignments page"
    :about="`Every table of every section draws today, ${seats.length} over these ${dates.length} dates. The groups stay, and each section keeps its first ${ROWS}. Change and a name only read out here.`"
  >
    <LibraryPanel label="What a seat's press would do" class="library-wide">
      <ReadOut label="Pressed" :value="pressed" />
    </LibraryPanel>
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
          :fold="ROWS"
          :testid="`library-l7-${group.date}-${section.split(' ')[0]!.toLowerCase()}`"
        >
          <template #row="{ item }">
            <SeatRow
              :code="seatCode(item)"
              :email="seatEmail(item)"
              :names="names"
              @open="pressedChange(item)"
              @view="pressedName(item)"
            />
          </template>
        </RowGroup>
      </div>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    title="A group of rows, its states"
    about="RowGroup on the first section's tables, at each count it can be given."
  >
    <LibraryPanel label="Under the fold: 12 tables, no button">
      <RowGroup
        class="library-full"
        :heading="firstSection.section"
        :items="someSeats(12)"
        :itemKey="seatKey"
        :level="4"
        testid="library-group-under"
      >
        <template #row="{ item }">
          <SeatRow :code="seatCode(item)" :email="seatEmail(item)" :names="names" readOnly />
        </template>
      </RowGroup>
    </LibraryPanel>
    <LibraryPanel :label="`At the fold: ${ROWS} tables, no button`">
      <RowGroup
        class="library-full"
        :heading="firstSection.section"
        :items="someSeats(ROWS)"
        :itemKey="seatKey"
        :level="4"
        testid="library-group-at"
      >
        <template #row="{ item }">
          <SeatRow :code="seatCode(item)" :email="seatEmail(item)" :names="names" readOnly />
        </template>
      </RowGroup>
    </LibraryPanel>
    <LibraryPanel :label="`One past: ${ROWS + 1} tables`">
      <RowGroup
        class="library-full"
        :heading="firstSection.section"
        :items="someSeats(ROWS + 1)"
        :itemKey="seatKey"
        :level="4"
        testid="library-group-past"
      >
        <template #row="{ item }">
          <SeatRow :code="seatCode(item)" :email="seatEmail(item)" :names="names" readOnly />
        </template>
      </RowGroup>
    </LibraryPanel>
    <LibraryPanel label="Folded past 5">
      <RowGroup
        class="library-full"
        :heading="firstSection.section"
        :items="firstSection.seats"
        :itemKey="seatKey"
        :level="4"
        :fold="5"
        testid="library-group-five"
      >
        <template #row="{ item }">
          <SeatRow :code="seatCode(item)" :email="seatEmail(item)" :names="names" readOnly />
        </template>
      </RowGroup>
    </LibraryPanel>
    <LibraryPanel label="A heading longer than the line: its button wraps">
      <RowGroup
        class="library-full"
        :heading="longName"
        :items="firstSection.seats"
        :itemKey="seatKey"
        :level="4"
        :fold="2"
        testid="library-group-long"
      >
        <template #row="{ item }">
          <SeatRow :code="seatCode(item)" :email="seatEmail(item)" :names="names" readOnly />
        </template>
      </RowGroup>
    </LibraryPanel>
  </LibrarySection>

  <ChoicesForYou>
    <li>
      <strong>Bars before the fold:</strong> {{ BARS }} to start. "Folded past 5" shows a shorter
      one.
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
      <strong>Rows before a group folds:</strong> {{ ROWS }} to start, so the 31 of North Wing and
      the 28 of South Wing each show {{ ROWS }} with little left to hide. "Folded past 5" shows a
      shorter one.
    </li>
    <li>
      <strong>Unfolding a section in place:</strong> in place too, one section at a time. A press
      per section, on every date, to read it all: should there be one "Show all" for the page, too?
    </li>
    <li>
      <strong>Finding a vendor on the Assignments page:</strong> the browser's own find (Ctrl+F)
      cannot reach a folded row. The page's search would have to unfold a section it matches in,
      which the fold does not do yet. Is that enough?
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
  outline-offset: -2px;
}
</style>
