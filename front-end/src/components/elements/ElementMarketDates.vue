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
import { addMonths, monthGrid, monthOf } from '@/utils/calendarMonth';
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

function isChosen(day: string): boolean {
  return chosen.value.includes(day);
}

function toggle(day: string) {
  const at = marketDates.value.findIndex((entry: MarketDateObject) => entry.date === day);
  if (at >= 0) marketDates.value.splice(at, 1);
  else marketDates.value.push({ date: day } as MarketDateObject);
}

/** The chosen days in order, so the summary reads as a market rather than as a click history. */
const chosenInOrder = computed(() => [...chosen.value].sort());
</script>

<template>
  <div class="calendar" data-testid="setup-dates">
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

    <!-- What was chosen, in words. A grid of marks says WHICH days; this says how many and when,
         which is the question an organizer is actually answering. -->
    <p v-if="chosenInOrder.length" class="calendar-summary" data-testid="setup-dates-summary">
      <span
        v-for="(day, index) in chosenInOrder"
        :key="day"
        class="calendar-chosen"
        :data-testid="`setup-dates-date-display-${index}`"
      >
        {{ getFormattedDate(day) }}
      </span>
    </p>
    <p v-else class="calendar-empty" data-testid="setup-dates-empty">
      No market days yet. Pick them on the calendar above.
    </p>
  </div>
</template>

<style scoped>
.calendar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
}

.calendar-head {
  display: flex;
  align-items: center;
  justify-content: center;
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
  max-width: 420px;
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

.calendar-summary {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
}

.calendar-chosen {
  font-size: var(--text-xs);
  color: var(--mm-black);
  background: var(--mm-beige);
  border-radius: var(--radius-pill);
  padding: var(--space-hairline) var(--space-2);
  white-space: nowrap;
}

.calendar-empty {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}
</style>
