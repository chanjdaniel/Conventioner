<script setup lang="ts">
/**
 * The market's days, chosen on a calendar (E18/F01/S02).
 *
 * It was one row per date, growing downwards, in the widest section on the page - a tall narrow
 * column of single values stranded in a very wide box. A calendar uses that width, reads the same
 * for a two-day market and a twelve-day one, and shows the shape of the market: two Saturdays a
 * month apart look like two Saturdays a month apart.
 *
 * It also DISSOLVES the old picker defect rather than fixing it. The row control laid an invisible
 * native `<input type="date">` across the whole row and called `showPicker()`, which opened
 * anchored to that input's left edge - the wrong side of the field. With no native date input
 * there is no popup to position and no invisible overlay to work around.
 *
 * A MARKET DATE IS A CALENDAR DAY, NOT AN INSTANT. All arithmetic is in `calendarMonth`, in UTC,
 * carrying days as strings - see its note on why a calendar is the likeliest place to reintroduce
 * the timezone bug `e2e/date-display-timezone.spec.ts` pins.
 */
import { computed, ref, toRef, watch } from 'vue';
import { type SetupObject, type MarketDateObject } from '@/assets/types/datatypes';
import { addMonths, datesByMonth, monthGrid, monthOf } from '@/utils/calendarMonth';
import { getFormattedDate } from '@/utils/utils';

const props = defineProps<{ setupObject: SetupObject }>();
const emit = defineEmits(['update:setupObject']);

const setupObject = toRef(props, 'setupObject');
const marketDates = toRef(setupObject.value, 'marketDates');

watch(
  () => setupObject.value.marketDates,
  () => emit('update:setupObject', setupObject.value),
  { deep: true },
);

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const chosen = computed(() =>
  (marketDates.value ?? []).map((entry: MarketDateObject) => entry.date).filter(Boolean),
);

/**
 * Opens on the month the market already sits in, so a returning organizer sees their own dates.
 *
 * Settled by a watcher rather than read once at setup: the market is loaded into the plan AFTER
 * this mounts, so reading `chosen` here would find it empty and open on today - which is what it
 * did, in every timezone, until the timezone spec caught it.
 *
 * `steered` stops it moving again once the organizer has navigated. A calendar that jumps back
 * because a save round-tripped is worse than one that opens on the wrong month.
 */
const viewing = ref(monthOf(chosen.value));
const steered = ref(false);

watch(
  chosen,
  (days) => {
    if (steered.value || !days.length) return;
    viewing.value = monthOf(days);
  },
  { immediate: true },
);
const weeks = computed(() => monthGrid(viewing.value.year, viewing.value.month));
const heading = computed(() => `${MONTH_NAMES[viewing.value.month]} ${viewing.value.year}`);

function step(delta: number) {
  steered.value = true;
  viewing.value = addMonths(viewing.value.year, viewing.value.month, delta);
}

/** A month in the list moves the calendar to it (E23/F02/S01). */
function show(year: number, month: number) {
  steered.value = true;
  viewing.value = { year, month };
}

const isViewed = (year: number, month: number) =>
  viewing.value.year === year && viewing.value.month === month;

function isChosen(day: string): boolean {
  return chosen.value.includes(day);
}

function toggle(day: string) {
  const at = marketDates.value.findIndex((entry: MarketDateObject) => entry.date === day);
  if (at >= 0) marketDates.value.splice(at, 1);
  else marketDates.value.push({ date: day } as MarketDateObject);
}

/**
 * The chosen days, one line per month, in date order (E23/F02/S01): a market reads as a market
 * rather than as a click history, and grows by months rather than by dates.
 */
const months = computed(() => datesByMonth(chosen.value));
const count = computed(() => months.value.reduce((n, m) => n + m.days.length, 0));

/** Each listed day's position among all of them, for its testid. */
const indexOf = computed(() => {
  const at: Record<string, number> = {};
  months.value.flatMap((m) => m.days).forEach(({ day }, i) => (at[day] = i));
  return at;
});
</script>

<template>
  <!-- The calendar on the left and the chosen dates on the right, grouped by month (E23/F02/S01):
       they used to be chips centred under the calendar, leaving most of a wide card empty. -->
  <div class="dates" data-testid="setup-dates">
    <div class="calendar" data-testid="setup-dates-calendar">
      <div class="calendar-head">
        <button
          type="button"
          class="calendar-step"
          aria-label="Previous month"
          data-testid="setup-dates-prev-month"
          @click="step(-1)"
        >
          ‹
        </button>
        <span class="calendar-month" data-testid="setup-dates-month">{{ heading }}</span>
        <button
          type="button"
          class="calendar-step"
          aria-label="Next month"
          data-testid="setup-dates-next-month"
          @click="step(1)"
        >
          ›
        </button>
      </div>

      <div class="calendar-grid" role="grid">
        <span v-for="name in WEEKDAYS" :key="name" class="calendar-weekday">{{ name }}</span>
        <template v-for="(week, w) in weeks" :key="w">
          <span v-for="(day, d) in week" :key="`${w}-${d}`" class="calendar-cell">
            <button
              v-if="day"
              type="button"
              class="calendar-day"
              :class="{ chosen: isChosen(day) }"
              :aria-pressed="isChosen(day)"
              :data-testid="`setup-dates-day-${day}`"
              @click="toggle(day)"
            >
              {{ Number(day.slice(8)) }}
            </button>
          </span>
        </template>
      </div>
    </div>

    <!-- What was chosen, in words. The grid says WHICH days; this says how many and when, which is
         the question an organizer is actually answering. -->
    <div class="dates-list" data-testid="setup-dates-summary">
      <p class="dates-count" data-testid="setup-dates-count">
        <template v-if="count"
          >{{ count }} {{ count === 1 ? 'market day' : 'market days' }}</template
        >
        <template v-else>No market days yet</template>
      </p>
      <p v-if="!count" class="dates-empty" data-testid="setup-dates-empty">
        Pick them on the calendar.
      </p>
      <ul v-else class="dates-months">
        <li
          v-for="m in months"
          :key="`${m.year}-${m.month}`"
          class="dates-month"
          :class="{ viewed: isViewed(m.year, m.month) }"
        >
          <button
            type="button"
            class="dates-month-name"
            data-testid="setup-dates-month-name"
            :aria-current="isViewed(m.year, m.month) ? 'date' : undefined"
            @click="show(m.year, m.month)"
          >
            {{ m.label }}
          </button>
          <ul class="dates-days">
            <li
              v-for="{ day, label } in m.days"
              :key="day"
              class="dates-day"
              :title="getFormattedDate(day) ?? day"
              :data-testid="`setup-dates-date-display-${indexOf[day]}`"
            >
              {{ label }}
              <button
                type="button"
                class="dates-remove"
                :aria-label="`Remove ${getFormattedDate(day)}`"
                :data-testid="`setup-dates-remove-${day}`"
                @click="toggle(day)"
              >
                ×
              </button>
            </li>
          </ul>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.dates {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-8);
}

/* 360px beside the list, down from a centred 420: still larger than a typical picker. */
.calendar {
  flex: 0 0 360px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.calendar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.calendar-month {
  font-size: var(--text-md);
  color: var(--mm-black);
  min-width: 12ch;
  text-align: center;
}

.calendar-step {
  width: 28px;
  height: 28px;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
  color: var(--mm-black);
  font-size: var(--text-md);
  line-height: 1;
  cursor: pointer;
}

.calendar-step:hover {
  border-color: var(--mm-green);
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: var(--space-1);
  width: 100%;
}

.calendar-weekday {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  text-align: center;
  padding-bottom: var(--space-1);
}

.calendar-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
}

.calendar-day {
  width: 100%;
  height: 100%;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: none;
  color: var(--mm-black);
  font-size: var(--text-sm);
  cursor: pointer;
}

.calendar-day:hover {
  border-color: var(--mm-border);
}

.calendar-day.chosen {
  background: var(--mm-green);
  border-color: var(--mm-green);
  color: white;
}

/* The list takes the room beside the calendar, and goes under it where there is none: a month's
   name and a few of its days need about as much room as the calendar itself. */
.dates-list {
  flex: 1 1 360px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.dates-count {
  margin: 0;
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--mm-border);
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.dates-empty {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.dates-months,
.dates-days {
  list-style: none;
  margin: 0;
  padding: 0;
}

.dates-months {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.dates-month {
  display: grid;
  grid-template-columns: 9rem minmax(0, 1fr);
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-control);
}

/* The month the calendar shows. */
.dates-month.viewed {
  background: var(--mm-beige);
}

.dates-month-name {
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
  text-align: left;
  cursor: pointer;
}

.dates-month-name:hover {
  text-decoration: underline;
}

.dates-days {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.dates-day {
  display: inline-flex;
  align-items: center;
  gap: var(--space-hairline);
  padding: var(--space-hairline) var(--space-1) var(--space-hairline) var(--space-2);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-pill);
  background: white;
  font-size: var(--text-xs);
  color: var(--mm-black);
  white-space: nowrap;
}

.dates-remove {
  padding: 0 var(--space-hairline);
  border: none;
  background: none;
  font-size: var(--text-sm);
  line-height: 1;
  color: var(--mm-text-muted);
  cursor: pointer;
}

.dates-remove:hover {
  color: var(--mm-black);
}
</style>
