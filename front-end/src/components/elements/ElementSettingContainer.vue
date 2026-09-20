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

::v-deep(.row-container) {
  margin-left: 8px;
  margin-right: 8px;
  width: calc(100% - 8px);

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
