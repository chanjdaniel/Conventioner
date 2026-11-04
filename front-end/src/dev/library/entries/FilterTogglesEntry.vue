<script setup lang="ts">
/**
 * The filter toggles (T200): `FilterToggles`, the one row eight of the ten toggle places each draw
 * their own way, on the fixture's counts. It opens on Applications All's status filter, today's row
 * beside the proposed one with what each status holds, then a view switch and several phases at
 * once, the states a row meets, and all ten places, of which it would replace the first eight. Every
 * row here is the real component; the line under each reads out what it holds, so a press is seen to
 * land.
 */
import { computed, ref } from 'vue';
import { ApplicationStatus, MarketPhase } from '@/assets/types/datatypes';
import FilterToggles, { type FilterToggle } from '@/components/FilterToggles.vue';
import { FILTERABLE_PHASES } from '@/utils/marketList';
import { phaseLabel } from '@/utils/phase';
import { ALL_VIEW_FILTERS, allViewLists, type AllViewFilter } from '@/utils/reviewQueue';
import { statusLabel } from '@/utils/verdicts';
import LibrarySection from '../parts/LibrarySection.vue';
import LibraryPanel from '../parts/LibraryPanel.vue';
import TodayAndProposed from '../parts/TodayAndProposed.vue';
import ChoicesForYou from '../parts/ChoicesForYou.vue';
import ReadOut from '../parts/ReadOut.vue';
import { fixture } from '../fixture';

const { applications, people, reviewers, export: offered } = fixture;

/** Each of the All view's filters, counted from the fixture by the view's own rule. */
const statusOptions: FilterToggle[] = ALL_VIEW_FILTERS.map(({ id, label }) => ({
  id,
  label,
  count: applications.filter(({ status }) => allViewLists(id, status)).length,
}));
const labelOf = (options: FilterToggle[], ids: string | string[]) =>
  [ids]
    .flat()
    .map((id) => options.find((option) => option.id === id)?.label ?? id)
    .join(', ');

const todayStatus = ref<AllViewFilter>('all');
const status = ref('all');
const statusRead = computed(() => {
  const chosen = statusOptions.find(({ id }) => id === status.value)!;
  return `${chosen.label}, ${chosen.count} applications`;
});

const viewOptions: FilterToggle[] = [
  { id: 'all', label: 'All' },
  { id: 'one', label: 'One by one' },
];
const view = ref('all');

/** As the markets list names them: the stage is Review on a Google Form market. */
const phaseOptions: FilterToggle[] = FILTERABLE_PHASES.map((phase) => ({
  id: phase,
  label: phase === MarketPhase.Applications ? 'Applications / Review' : phaseLabel(phase),
}));
const phases = ref<string[]>([MarketPhase.Applications, MarketPhase.Assignment]);
const phasesRead = computed(() =>
  phases.value.length ? labelOf(phaseOptions, phases.value) : 'All phases',
);

/** Approved beside two statuses the deriver never deals, each counted from the fixture. */
const zeroOptions: FilterToggle[] = [
  ApplicationStatus.ReviewerApproved,
  ApplicationStatus.VendorRefused,
  ApplicationStatus.Cancelled,
].map((id) => ({
  id,
  label: statusLabel(id),
  count: applications.filter(({ status: held }) => held === id).length,
}));
const zeroChosen = ref<string>(ApplicationStatus.ReviewerApproved);

/** The form's longest questions, wider than a phone's row. */
const longOptions: FilterToggle[] = [...offered.questions]
  .sort((a, b) => b.label.length - a.label.length)
  .slice(0, 3)
  .map(({ key, label }) => ({ id: key, label }));
const longChosen = ref<string[]>([longOptions[0]!.id]);

/** Each reviewer, by the address an account holds, and their share: a row that wraps on any window. */
const reviewerOptions: FilterToggle[] = reviewers.map((id) => ({
  id,
  label: people.find((person) => person.id === id)!.email,
  count: applications.filter(({ reviewer }) => reviewer === id).length,
}));
const reviewersChosen = ref<string[]>([]);

const PLACES = [
  {
    place: 'Applications, All: the status filter',
    file: 'components/application/ApplicationsAll.vue',
    today: 'One choice, no counts.',
  },
  {
    place: 'Applications: All or One by one',
    file: 'components/market/MarketApplicationsTab.vue',
    today: 'One choice, a view switch.',
  },
  {
    place: 'Vendors: Unassigned only, Rejected only',
    file: 'views/VendorsView.vue',
    today: 'At most one; a second press lets go, and a pressed one draws a cross.',
  },
  {
    place: 'Payments: what is shown',
    file: 'views/PaymentsView.vue',
    today: 'At most one, its count in brackets; a second press lets go, with a cross.',
  },
  {
    place:
      'Attendance: the dates, and All, Not yet (Did not come once the day is over), Checked in',
    file: 'views/AttendanceStatusView.vue',
    today: 'Two rows, one choice each; a date counts "here of expected", two figures.',
  },
  {
    place: 'Assignments: the status pills',
    file: 'views/ResultView.vue',
    today:
      'A count-badge, the count before its label, a tone per status, a 0 disabled; a second press lets go.',
  },
  {
    place: 'Stats: among whom',
    file: 'views/StatsView.vue',
    today: 'One choice; the count stands beside the row, not on a toggle.',
  },
  {
    place: 'Markets: the phases',
    file: 'views/MarketsView.vue',
    today: 'Several at once, with an "All phases" toggle that lets them all go.',
  },
  {
    place: 'Market Setup: the market days',
    file: 'components/elements/ElementMarketDates.vue',
    today: 'Several at once, but a month grid of its own calendar-day buttons, not a wrapping row.',
  },
  {
    place: 'Floorplan: Group Sections',
    file: 'components/floorplan/SectionGrouping.vue',
    today:
      'One button of its own look, on or off, whose words change with it: not a row of choices.',
  },
];
</script>

<template>
  <LibrarySection
    title="The three variants"
    about="Each on the fixture, the row a screen would mount. Application statuses are counted from the fixture's applications by the All view's own rule."
  >
    <TodayAndProposed
      today="Today: Applications All's filter, no counts"
      proposed="Proposed: one choice, with counts"
    >
      <template #today>
        <div class="library-demo">
          <div
            class="library-today-row"
            role="group"
            aria-label="Status, today"
            data-testid="library-toggles-today"
          >
            <button
              v-for="option in ALL_VIEW_FILTERS"
              :key="option.id"
              type="button"
              class="btn btn--compact"
              :class="option.id === todayStatus ? 'btn--primary' : 'btn--secondary'"
              :aria-pressed="option.id === todayStatus"
              @click="todayStatus = option.id"
            >
              {{ option.label }}
            </button>
          </div>
          <ReadOut label="Showing" :value="labelOf(statusOptions, todayStatus)" />
        </div>
      </template>
      <template #proposed>
        <div class="library-demo">
          <FilterToggles
            v-model="status"
            :options="statusOptions"
            label="Status"
            testid="library-toggles-statuses"
          />
          <ReadOut label="Showing" :value="statusRead" />
        </div>
      </template>
    </TodayAndProposed>

    <LibraryPanel label="One choice, a view switch, no counts">
      <div class="library-demo">
        <FilterToggles
          v-model="view"
          :options="viewOptions"
          label="View"
          testid="library-toggles-view"
        />
        <ReadOut label="View" :value="labelOf(viewOptions, view)" />
      </div>
    </LibraryPanel>

    <LibraryPanel label="Several at once: phases">
      <div class="library-demo">
        <FilterToggles
          v-model="phases"
          multiple
          :options="phaseOptions"
          label="Phase"
          testid="library-toggles-phases"
        />
        <ReadOut label="Phases" :value="phasesRead" />
      </div>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection title="The states" about="What a row meets on a real market.">
    <LibraryPanel label="A count of nothing">
      <div class="library-demo">
        <FilterToggles
          v-model="zeroChosen"
          :options="zeroOptions"
          label="Status, some with nothing"
          testid="library-toggles-zero"
        />
        <ReadOut label="Showing" :value="labelOf(zeroOptions, zeroChosen)" />
      </div>
    </LibraryPanel>

    <LibraryPanel label="A label longer than the row: the form's longest questions">
      <div class="library-demo">
        <FilterToggles
          v-model="longChosen"
          multiple
          :options="longOptions"
          label="Questions"
          testid="library-toggles-long"
        />
        <ReadOut label="Chosen" :value="labelOf(longOptions, longChosen)" />
      </div>
    </LibraryPanel>

    <LibraryPanel :label="`A long row: ${reviewerOptions.length} reviewers and their shares`">
      <div class="library-demo">
        <FilterToggles
          v-model="reviewersChosen"
          multiple
          :options="reviewerOptions"
          label="Reviewers"
          testid="library-toggles-reviewers"
        />
        <ReadOut label="Chosen" :value="labelOf(reviewerOptions, reviewersChosen)" />
      </div>
    </LibraryPanel>
  </LibrarySection>

  <LibrarySection
    :title="`The ${PLACES.length} places today`"
    about="How each draws it today. It would replace the first eight, rows of pressed buttons; the last two are no row, and stay the controls they are. No screen changes here."
  >
    <ol class="library-places">
      <li
        v-for="{ place, file, today } in PLACES"
        :key="file"
        class="library-place"
        data-testid="library-toggles-place"
      >
        <span class="library-place__name">{{ place }}</span>
        <span class="library-place__today">{{ today }}</span>
        <code class="library-place__file">{{ file }}</code>
      </li>
    </ol>
  </LibrarySection>

  <ChoicesForYou>
    <li>Counts: shown always, or only where the screen has them already.</li>
    <li>
      The pressed look: every row but the pills and the two at the end of the list draws today's
      tint and green border; the Today row above asks for the primary fill and draws that same tint.
      Keep it, or choose another.
    </li>
    <li>
      Pressing the chosen toggle again: it stays chosen here, as Applications All does, while
      Vendors, Payments and the pills let go. Keep one rule, or give those rows a way to let go.
    </li>
    <li>
      Nothing pressed means all, here on the phases; Markets has an "All phases" toggle today. Keep
      that toggle, or drop it.
    </li>
    <li>
      What the row does not draw: the pills' tone per status, their disabled count of 0 (pressable
      here), and a door date's two figures. Grow it for them, or leave those rows as they are.
    </li>
  </ChoicesForYou>
</template>

<style scoped>
.library-demo {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
}

.library-today-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

/* A target is never narrower than it is tall, as today's row has it. */
.library-today-row .btn {
  min-width: var(--target-min);
}

/* The list spans the section's grid, as `TodayAndProposed` does. */
.library-places {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  grid-column: 1 / -1;
  margin: 0;
  padding-left: var(--space-6);
}

.library-place__name,
.library-place__today,
.library-place__file {
  display: block;
  overflow-wrap: anywhere;
}

.library-place__name {
  font-size: var(--text-sm);
  font-weight: 600;
}

.library-place__today {
  font-size: var(--text-sm);
}

.library-place__file {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
