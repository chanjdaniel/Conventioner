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
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue';
import { type SetupObject, type MarketDateObject } from '@/assets/types/datatypes';
import {
  MONTH_NAMES,
  addMonths,
  dateColumns,
  datesByMonth,
  monthGrid,
  monthOf,
} from '@/utils/calendarMonth';
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
 * The chosen days in date order, a row each under their month (E28/F01/S01), flowed top to bottom
 * into columns no taller than the calendar: a market reads as a market rather than as a click
 * history, and twenty dates fill the room beside the calendar instead of running below it.
 */
const months = computed(() => datesByMonth(chosen.value));
const count = computed(() => months.value.reduce((n, m) => n + m.days.length, 0));

/** Every line is one height, so the room for a column is a count of lines. */
const LINE_PX = 28;
const COLUMN_PX = 144;
const COLUMN_GAP_PX = 24;
const linePx = `${LINE_PX}px`;
const columnPx = `${COLUMN_PX}px`;
const columnGapPx = `${COLUMN_GAP_PX}px`;

const calendarEl = ref<HTMLElement | null>(null);
const flowEl = ref<HTMLElement | null>(null);
const room = ref({ lines: 11, columns: 4 });

/**
 * How many lines fit beside the calendar and how many columns across. Measured, not assumed: the
 * calendar's height follows its width, and the list goes under it when the card is narrow - where a
 * column is still held to the calendar's height.
 */
function measure() {
  const calendar = calendarEl.value?.getBoundingClientRect();
  const flow = flowEl.value?.getBoundingClientRect();
  if (!calendar || !flow || !calendar.height) return;
  const beside = calendar.bottom - flow.top;
  const tall = beside >= LINE_PX * 2 ? beside : calendar.height;
  room.value = {
    lines: Math.floor(tall / LINE_PX),
    columns: Math.floor((flow.width + COLUMN_GAP_PX) / (COLUMN_PX + COLUMN_GAP_PX)),
  };
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  measure();
  if (typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(measure);
  if (calendarEl.value) observer.observe(calendarEl.value);
});
// The list appears with the first date and goes with the last.
watch(flowEl, (el, was) => {
  if (was) observer?.unobserve(was);
  if (el) observer?.observe(el);
  measure();
});
onBeforeUnmount(() => observer?.disconnect());

const columns = computed(() => dateColumns(months.value, room.value));

/** Each listed day's position among all of them, for its testid. */
const indexOf = computed(() => {
  const at: Record<string, number> = {};
  months.value.flatMap((m) => m.days).forEach(({ day }, i) => (at[day] = i));
  return at;
});
</script>

<template>
  <!-- The calendar on the left and the chosen dates on the right (E23/F02/S01), a row each under
       their month (E28/F01/S01): they used to be chips centred under the calendar, leaving most of
       a wide card empty. -->
  <div class="dates" data-testid="setup-dates">
    <div ref="calendarEl" class="calendar" data-testid="setup-dates-calendar">
      <div class="calendar-head">
        <button
          type="button"
          class="calendar-step"
          aria-label="Previous month"
          data-testid="setup-dates-prev-month"
          @click="step(-1)"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10.5 3 5.5 8l5 5" />
          </svg>
        </button>
        <span class="calendar-month" data-testid="setup-dates-month">{{ heading }}</span>
        <button
          type="button"
          class="calendar-step"
          aria-label="Next month"
          data-testid="setup-dates-next-month"
          @click="step(1)"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5.5 3l5 5-5 5" />
          </svg>
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
              :aria-label="getFormattedDate(day) ?? day"
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
      <div v-else ref="flowEl" class="dates-columns">
        <ul
          v-for="(column, c) in columns"
          :key="c"
          class="dates-column"
          data-testid="setup-dates-column"
        >
          <template v-for="line in column" :key="line.day || `${line.year}-${line.month}`">
            <li
              v-if="line.kind === 'month'"
              class="dates-line dates-month"
              :class="{ viewed: isViewed(line.year, line.month) }"
            >
              <button
                type="button"
                class="dates-month-name"
                data-testid="setup-dates-month-name"
                :aria-current="isViewed(line.year, line.month) ? 'date' : undefined"
                @click="show(line.year, line.month)"
              >
                {{ line.label }}
              </button>
            </li>
            <li
              v-else
              class="dates-line dates-day"
              :title="getFormattedDate(line.day) ?? line.day"
              :data-testid="`setup-dates-date-display-${indexOf[line.day]}`"
            >
              {{ line.label }}
              <button
                type="button"
                class="dates-remove"
                :aria-label="`Remove ${getFormattedDate(line.day)}`"
                :data-testid="`setup-dates-remove-${line.day}`"
                @click="toggle(line.day)"
              >
                ×
              </button>
            </li>
          </template>
        </ul>
      </div>
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
  color: var(--mm-black);
  cursor: pointer;
}

/* A drawn chevron, symmetric about its box, rather than a text glyph: "‹" sat 2.25px low in the
   button, on the font's baseline, and its ink was 3px wide (E28/F04/S02). */
.calendar-step svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
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

.dates-columns {
  display: flex;
  align-items: flex-start;
  gap: v-bind(columnGapPx);
}

.dates-column {
  flex: 0 0 v-bind(columnPx);
  list-style: none;
  margin: 0;
  padding: 0;
}

/* A heading and a day are one height, so a column's room is a count of lines. */
.dates-line {
  display: flex;
  align-items: center;
  height: v-bind(linePx);
  padding: 0 var(--space-2);
  border-radius: var(--radius-control);
}

/* The month the calendar shows. */
.dates-month.viewed {
  background: var(--mm-beige);
}

.dates-month-name {
  flex: 1;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.dates-month-name:hover {
  text-decoration: underline;
}

.dates-day {
  justify-content: space-between;
  font-size: var(--text-sm);
  color: var(--mm-black);
  white-space: nowrap;
}

/* Outlined rather than filled: the beige fill already says which month the calendar shows. */
.dates-day:hover {
  outline: 1px solid var(--mm-border);
  outline-offset: -1px;
}

.dates-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--radius-control);
  background: none;
  font-size: var(--text-md);
  line-height: 1;
  color: var(--mm-text-muted);
  cursor: pointer;
}

.dates-remove:hover {
  color: var(--mm-black);
}
</style>
