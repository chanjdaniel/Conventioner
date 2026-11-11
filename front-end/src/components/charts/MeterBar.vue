<script setup lang="ts">
/**
 * A meter bar (T201): one row, a label, the caller's words ("42 asking, 30 tables"), and a bar of a
 * value against `scale`, the largest value or mark of the card the row stands in, so every row of
 * a card is drawn on one scale and the rows compare.
 *
 * Given a `mark`, a 2px `--mm-black` line stands where it falls, and the part of the value past it
 * is drawn in the chart's attention fill, `--mm-chart-yellow`, the rest in `--mm-green`. The Stats
 * tab draws with it its Room, each day's and tier's tables asked with the mark at the tables; its
 * Money, paid against owed, marked at owed only when more was paid; and its Check-in, each day's
 * checked in, marked at those expected only on a day expected short of the card's largest.
 *
 * The bar is hidden from assistive technology; the label and the words are the text, so the
 * caller's words carry every figure the bar draws. Without a value there is no bar, the words
 * alone: a room before anyone applies reads its tables.
 *
 * What the caller puts in the default slot stands after the words, on their line: Check-in's
 * "6 not yet", a link to the day at Attendance. A reader hears it after a comma.
 */
import { computed } from 'vue';

const props = defineProps<{
  label: string;
  /** The row's text, every figure the bar draws in words. */
  words: string;
  /** The bar's length; `null` draws no bar. */
  value: number | null;
  /** Where the line falls: the tables, say. None draws no line. */
  mark?: number;
  /** What the whole track stands for: the card's largest value or mark. */
  scale: number;
  /** The stem of the row's `data-testid`s. */
  testid: string;
}>();

function percent(n: number): string {
  return `${props.scale > 0 ? (Math.min(n, props.scale) / props.scale) * 100 : 0}%`;
}

const value = computed(() => props.value ?? 0);
/** Up to the mark, or all of it with no mark. */
const within = computed(() =>
  props.mark === undefined ? value.value : Math.min(value.value, props.mark),
);
const past = computed(() => value.value - within.value);
</script>

<template>
  <div class="meter-bar">
    <span class="meter-bar-label" :data-testid="`${testid}-label`">{{ label }}</span
    ><span class="visually-hidden">: </span
    ><span class="meter-bar-figures"
      ><span class="meter-bar-words" :data-testid="`${testid}-words`">{{ words }}</span
      ><span v-if="$slots.default" class="meter-bar-after" :data-testid="`${testid}-after`"
        ><span class="visually-hidden">, </span><slot /></span
    ></span>
    <div
      v-if="props.value !== null"
      class="meter-bar-bar"
      aria-hidden="true"
      :data-testid="`${testid}-bar`"
    >
      <div class="meter-bar-track">
        <span
          class="meter-bar-within"
          :style="{ width: percent(within) }"
          :data-testid="`${testid}-within`"
        />
        <span
          v-if="past > 0"
          class="meter-bar-past"
          :style="{ left: percent(within), width: percent(past) }"
          :data-testid="`${testid}-past`"
        />
      </div>
      <div v-if="mark !== undefined" class="meter-bar-marks">
        <span
          class="meter-bar-mark"
          :style="{ left: percent(mark) }"
          :data-testid="`${testid}-mark`"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The label and the words on a line, wrapping apart when the card is narrow; the bar under both. */
.meter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.meter-bar-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* At the row's end, so every row's figures stand in one column, on the label's line or wrapped
   under it; what the caller puts after the words stays with them, wrapping under them at the end
   too when the card is narrower still. */
.meter-bar-figures {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: flex-end;
  gap: 0 var(--space-3);
  margin-left: auto;
  text-align: end;
  font-variant-numeric: tabular-nums;
}

/* Weight does not inherit here (the design language), so the figures carry their own. */
.meter-bar-words {
  font-weight: 600;
}

/* The mark stands a hairline taller than the track at each edge, so it reads on a full bar too. */
.meter-bar-bar {
  position: relative;
  flex-basis: 100%;
  padding: var(--space-hairline) 0;
}

.meter-bar-track {
  position: relative;
  height: var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--mm-beige);
  overflow: hidden;
}

.meter-bar-within,
.meter-bar-past {
  position: absolute;
  top: 0;
  bottom: 0;
}

.meter-bar-within {
  left: 0;
  background: var(--mm-green);
}

.meter-bar-past {
  background: var(--mm-chart-yellow);
}

/* The mark's ground, inset by half its width at each end, so a mark centred on its point stays
   inside the track at 0 and at the whole. */
.meter-bar-marks {
  position: absolute;
  inset: 0 calc(var(--space-hairline) / 2);
}

.meter-bar-mark {
  position: absolute;
  top: 0;
  bottom: 0;
  width: var(--space-hairline);
  /* stylelint-disable-next-line declaration-property-value-allowed-list -- half the mark's width, not spacing: the line is centred on its point */
  margin-left: calc(var(--space-hairline) / -2);
  background: var(--mm-black);
}
</style>
