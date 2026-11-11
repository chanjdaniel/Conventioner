<script setup lang="ts">
/**
 * How full a market is (T201): a table of sections down the side and market days across, each cell
 * "28/30", its tables used of its tables, shaded by its step (`fillStep` in `utils/fillGrid.ts`),
 * and a total row per day.
 *
 * A real `<table>`: captioned by the title, a row header per section with its tier under the name,
 * a column header per day. The shade is a class on the cell, `--mm-fill-*` from `base.css`, an
 * empty cell the card's white; each cell's figures are hidden from a screen reader, which hears the
 * same in words with the step ("28 of 30 used, more than two thirds full"), so the shade never
 * carries anything alone. The title is drawn over the scroller, so it stays put while the table
 * scrolls, and given to the table as its caption for a screen reader.
 *
 * A table wider than its card scrolls inside its own box (`ScrollBox`), the section names held at
 * the left, so the page itself never scrolls sideways.
 */
import ScrollBox from '@/components/ScrollBox.vue';
import type { FillGridModel } from '@/utils/fillGrid';

defineProps<{
  title: string;
  grid: FillGridModel;
  /** The stem of the `data-testid`s: `-scroller`, `-row`, `-cell`, `-figures`, `-total`. */
  testid: string;
}>();
</script>

<template>
  <div class="fill-grid">
    <p class="fill-grid-title" aria-hidden="true">{{ title }}</p>
    <ScrollBox axis="x" :label="title" :testid="`${testid}-scroller`">
      <table class="fill-grid-table">
        <caption class="visually-hidden">
          {{
            title
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col" class="fill-grid-section">Section</th>
            <th v-for="column in grid.columns" :key="column.key" scope="col" class="fill-grid-day">
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in grid.rows"
            :key="row.key"
            :data-testid="`${testid}-row`"
            :data-key="row.key"
          >
            <th scope="row" class="fill-grid-section">
              <span class="fill-grid-name">{{ row.label }}</span
              ><template v-if="row.tier"
                ><span class="visually-hidden">, </span
                ><span class="fill-grid-tier">{{ row.tier }}</span></template
              >
            </th>
            <td
              v-for="cell in row.cells"
              :key="cell.key"
              class="fill-grid-cell"
              :class="`fill-grid-cell--${cell.step}`"
              :data-step="cell.step"
              :data-testid="`${testid}-cell`"
            >
              <span aria-hidden="true" :data-testid="`${testid}-figures`">{{ cell.figures }}</span
              ><span class="visually-hidden">{{ cell.words }}</span>
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr :data-testid="`${testid}-total`">
            <th scope="row" class="fill-grid-section">{{ grid.total.label }}</th>
            <td
              v-for="cell in grid.total.cells"
              :key="cell.key"
              class="fill-grid-cell"
              :class="`fill-grid-cell--${cell.step}`"
              :data-step="cell.step"
            >
              <span aria-hidden="true" :data-testid="`${testid}-figures`">{{ cell.figures }}</span
              ><span class="visually-hidden">{{ cell.words }}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </ScrollBox>
  </div>
</template>

<style scoped>
.fill-grid {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
}

.fill-grid-title {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-text-muted);
}

/* Cells set apart by white gaps, as the split bar's parts are, so neighbouring shades need no
   contrast with each other. */
.fill-grid-table {
  border-collapse: separate;
  border-spacing: var(--space-hairline);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.fill-grid-table th {
  font-weight: 600;
}

.fill-grid-day {
  padding: 0 var(--space-2) var(--space-1);
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  text-align: center;
}

/* Held at the left where it rests, past the table's spacing, while the days scroll under it; its
   white runs over the spacing on both sides, so no cell shows through beside it. */
.fill-grid-section {
  position: sticky;
  left: var(--space-hairline);
  z-index: 1;
  /* Room for a name of two words on its line, where the days would squeeze it to one word each;
     a longer name wraps. */
  min-width: 7rem;
  text-align: left;
  padding: var(--space-1) var(--space-3) var(--space-1) 0;
  background: white;
  /* stylelint-disable declaration-property-value-disallowed-list -- a ground over the border spacing at each side, not elevation: the cells scroll under it unseen */
  box-shadow:
    calc(-1 * var(--space-hairline)) 0 0 white,
    var(--space-hairline) 0 0 white;
  /* stylelint-enable declaration-property-value-disallowed-list */
}

thead .fill-grid-section {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  vertical-align: bottom;
}

.fill-grid-name {
  display: block;
}

.fill-grid-tier {
  display: block;
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--mm-text-muted);
}

.fill-grid-cell {
  min-width: 4rem;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  text-align: center;
  white-space: nowrap;
}

/* An empty cell keeps the card's white, its edge drawn so it still reads as a cell. */
.fill-grid-cell--none {
  /* stylelint-disable-next-line declaration-property-value-disallowed-list -- the cell's 1px edge drawn inside it, a line and not elevation, so the cell keeps its size */
  box-shadow: inset 0 0 0 1px var(--mm-border);
}

.fill-grid-cell--third {
  background: var(--mm-fill-third);
}

.fill-grid-cell--two-thirds {
  background: var(--mm-fill-two-thirds);
}

.fill-grid-cell--nearly {
  background: var(--mm-fill-nearly);
}

.fill-grid-cell--full {
  background: var(--mm-fill-full);
}

/* The total row, set apart from the sections above it. */
tfoot th,
tfoot td {
  font-weight: 600;
}
</style>
