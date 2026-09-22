<script setup lang="ts"></script>

<template>
  <div class="setting-container">
    <div class="setting-header"><slot name="setting-title"></slot></div>
    <div class="setting-body"><slot name="setting-content"></slot></div>
  </div>
</template>

<style scoped>
.setting-container {
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;

  border-radius: var(--radius-card);
  background-color: white;
  box-shadow: var(--shadow-card);
}

/*
 * The card title, styled by the card (E18/F02/S01).
 *
 * It used to be a bare `h2 { color: white }` in `MarketSetupView`'s scoped style, reaching the
 * titles because the slot content was rendered in that view's template. The moment those cards
 * moved into their own components the rule stopped matching, and every title rendered the
 * inherited dark ink on this black bar at 1.42:1 - invisible. A title's appearance belongs to the
 * component that draws the bar behind it, not to whichever parent happens to pass the slot.
 */
::v-deep(.setting-header h2) {
  font-family: 'Merge One';
  text-align: left;
  font-size: var(--text-lg);
  color: white;
}

.setting-header {
  height: 35px;
  background-color: var(--mm-black);
  border-top-left-radius: 10px;
  border-top-right-radius: 10px;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 15px;
}

.setting-body {
  flex-grow: 1;
  /* Without min-height: 0 this flex item cannot shrink below its content, so tall
           content grows the card past its parent instead of scrolling inside it. */
  min-height: 0;
  overflow-y: auto;
  background-color: white;
  border-bottom-left-radius: 10px;
  border-bottom-right-radius: 10px;
  padding-top: 15px;
  padding-left: 20px;
  padding-right: 20px;
  padding-bottom: 20px;
}

/*
 * The row spans its container, and the room its shadow needs is the scroll container's padding
 * (E17/F02/S01).
 *
 * It used to be `margin: 0 8px` with `width: calc(100% - 8px)`, which is 8px of margin plus a
 * width short by only 8 - so the border box sat flush with the right edge (0px for a shadow that
 * paints 14px sideways) while the left had 8, and the MARGIN box overhung by 8px. Four of the six
 * cards reported horizontal overflow, silently clipped by `overflow-x: hidden`.
 *
 * Padding rather than margin because overflow clips at the PADDING box: a child's shadow paints
 * into its scroll container's padding and stays visible, where a margin only moves the child.
 */
::v-deep(.rows) {
  padding: var(--space-2);
}

::v-deep(.row-container) {
  width: 100%;

  text-align: center;
  font-size: var(--text-xs);

  border-radius: var(--radius-card);
  background-color: white;
  box-shadow: var(--shadow-card);
}

/*
 * A column heading is a label, not a field (E16/F03/S03).
 *
 * `.row-container` is shared by the data rows AND the heading row above them, so "Section Name",
 * "Location", "Tier" and "Count" wore the same border, radius and inset-looking shadow as the
 * editable pills beneath them. A control's appearance is a promise about what it does, and these
 * had nothing behind them: a query for `button, input, select, textarea, [role]` inside that row
 * returns nothing at all.
 */
::v-deep(.column-titles.row-container) {
  background-color: transparent;
  box-shadow: none;
  border-radius: 0;
  border-bottom: 1px solid var(--mm-border);
  padding-bottom: 6px;
  margin-bottom: 4px;

  /*
   * The SAME horizontal inset the rows list has (E17/F01/S03).
   *
   * The heading row is a SIBLING of `.rows`, not a child of it, so the padding that gives a row's
   * shadow its room does not reach the heading - and a heading 16px wider than the values beneath
   * it is a heading that names a column it does not sit over.
   *
   * Margin rather than padding, because this row draws the rule under the headings: padding would
   * align the columns and still leave that rule 16px wider than every row below it.
   */
  width: calc(100% - 2 * var(--space-2));
  margin-left: auto;
  margin-right: auto;
}

::v-deep(.column-titles h3) {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  font-weight: 400;
  /* The heading sizes to its own text. "Priority" is 51px of text and its column was 15% of a
     280px panel - 42px - so the last glyph was cut. */
  white-space: nowrap;
}
</style>
