<script setup lang="ts">
/**
 * A column chart (T201): counts in buckets drawn as columns from a baseline, one `--mm-green` column
 * per bucket, so a quiet day shows as a gap on the baseline and a rush stands out. The Stats tab
 * draws applications over time with it (`utils/appliedOverTime.ts` buckets them).
 *
 * A line at the top marks the largest count, which the tallest column reaches, and the first and
 * last bucket are named under the axis: enough to read the shape and its span, while the exact
 * figures are one press away.
 *
 * Its text equivalent: the plot is one image, named by the caller's one-sentence summary, and under
 * it a native disclosure ("Numbers by day") opens a table of every bucket, empty ones included, so
 * a reader who cannot see the columns learns the same.
 */
import { computed } from 'vue';

export interface Column {
  /** What the bucket stands for, unique: its first day. */
  key: string;
  /** Under the axis: "Oct 3". */
  label: string;
  /** In the table: "Sat, Oct 3, 2026". */
  name: string;
  count: number;
}

const props = defineProps<{
  title: string;
  columns: Column[];
  /** The chart in one sentence, the image's name. */
  summary: string;
  /** The disclosure's words: "Numbers by day". */
  numbers: string;
  /** The table's column heads: "Day", "Applications". */
  keyHead: string;
  countHead: string;
  /** The test ids' stem. */
  testid: string;
}>();

const most = computed(() => Math.max(0, ...props.columns.map((column) => column.count)));

/** A column's height, a percent of the largest. */
function height(count: number): string {
  return `${most.value ? Math.round((count / most.value) * 10000) / 100 : 0}%`;
}

const ends = computed(() => {
  const { columns } = props;
  if (!columns.length) return [];
  return columns.length === 1 ? [columns[0]] : [columns[0], columns[columns.length - 1]];
});
</script>

<template>
  <div class="column-chart">
    <h3>{{ title }}</h3>
    <div
      class="column-chart-plot"
      role="img"
      :aria-label="summary"
      :style="{ '--column-count': columns.length }"
      :data-testid="`${testid}-plot`"
    >
      <div class="column-chart-area">
        <span class="column-chart-most" :data-testid="`${testid}-most`">{{ most }}</span>
        <div class="column-chart-columns">
          <span
            v-for="column in columns"
            :key="column.key"
            class="column-chart-column"
            :class="{ 'column-chart-column--empty': !column.count }"
            :style="{ height: height(column.count) }"
            :data-count="column.count"
            :data-testid="`${testid}-column`"
          />
        </div>
      </div>
      <div class="column-chart-axis" :data-testid="`${testid}-axis`">
        <span v-for="end in ends" :key="end.key">{{ end.label }}</span>
      </div>
    </div>
    <details class="column-chart-numbers" :data-testid="`${testid}-numbers`">
      <summary>{{ numbers }}</summary>
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">{{ keyHead }}</th>
            <th scope="col" class="column-chart-count">{{ countHead }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="column in columns" :key="column.key" :data-testid="`${testid}-row`">
            <th scope="row">{{ column.name }}</th>
            <td class="column-chart-count">{{ column.count }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </div>
</template>

<style scoped>
.column-chart {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
}

.column-chart h3 {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-text-muted);
}

/* No wider than 3rem a column, so a few weeks are not a few slabs across a desk; the axis and the
   top line are the plot's, so they end where the last column does. */
.column-chart-plot {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-width: calc(var(--column-count) * 3rem);
}

/* The largest count's line at the top, its figure standing on it at the left; the columns rise
   from the baseline to it. */
.column-chart-area {
  position: relative;
  padding-top: var(--space-6);
}

.column-chart-most {
  position: absolute;
  top: 0;
  left: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: var(--space-6);
}

.column-chart-columns {
  display: flex;
  align-items: flex-end;
  gap: var(--space-hairline);
  height: 8rem;
  border-top: 1px dashed var(--mm-border);
  border-bottom: 1px solid var(--mm-black);
}

/* Equal columns that share the width, however many: a day of six weeks is still a few pixels on
   a 320px phone. A column with any count stands at least 2px, so a lone application shows. */
.column-chart-column {
  flex: 1 1 0;
  min-width: 0;
  min-height: 2px;
  background: var(--mm-green);
}

.column-chart-column--empty {
  min-height: 0;
}

.column-chart-axis {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

/* A single bucket is named under it at the left, where its column stands. */
.column-chart-axis span:only-child {
  margin-right: auto;
}

.column-chart-numbers summary {
  display: inline-flex;
  align-items: center;
  min-height: var(--target-min);
  cursor: pointer;
  color: var(--mm-text-link);
  font-size: var(--text-sm);
  font-weight: 600;
}

.column-chart-numbers .data-table {
  margin-top: var(--space-2);
}

.column-chart-count {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
