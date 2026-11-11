<script setup lang="ts">
/**
 * The layout page's selection card (T257): nothing selected, "Select tables to change them."; one
 * table, its code, section, type and where its centre stands, in metres from the floorplan's
 * top-left corner; several, how many and their codes. Its buttons turn the selection a quarter and
 * remove it, with no question asked first, since Undo takes a removal back.
 */
import { computed, useId } from 'vue';
import type { FloorplanTable, TableTypeObject } from '@/assets/types/datatypes';
import { plural } from '@/utils/historyReaders/shared';
import { tableCode, type LayoutSection } from './layoutDrawing';

const props = defineProps<{
  /** The selected tables. */
  tables: readonly FloorplanTable[];
  /** The location's sections, as the map draws them. */
  sections: readonly LayoutSection[];
  tableTypes: readonly TableTypeObject[];
}>();

defineEmits<{ turn: []; remove: [] }>();

const titleId = useId();

const NO_SECTION = 'Table in no section';

function sectionOf(table: FloorplanTable) {
  if (table.number === null) return null;
  return props.sections.find(({ section }) => section.id === table.sectionId)?.section ?? null;
}

const codes = computed(() =>
  props.tables.map((table) => tableCode(table, sectionOf(table)) ?? NO_SECTION),
);

const metres = (mm: number) => `${(mm / 1000).toFixed(1)} m`;

/** The one selected table, as the card reads it. */
const one = computed(() => {
  if (props.tables.length !== 1) return null;
  const table = props.tables[0];
  const section = sectionOf(table);
  return {
    code: codes.value[0],
    section: section?.name ?? 'No section',
    type: props.tableTypes.find((type) => type.id === table.tableTypeId)?.name ?? 'Unknown type',
    position: `${metres(table.xMm)}, ${metres(table.yMm)}`,
  };
});
</script>

<template>
  <section :aria-labelledby="titleId" data-testid="layout-panel-selection">
    <h2 :id="titleId" class="selection-title" data-testid="layout-selection-title">
      <template v-if="one">{{ one.code }}</template>
      <template v-else-if="tables.length">
        {{ plural(tables.length, 'table', 'tables') }} selected
      </template>
      <template v-else>Selection</template>
    </h2>
    <p v-if="!tables.length" class="selection-text" data-testid="layout-selection-none">
      Select tables to change them.
    </p>
    <dl v-else-if="one" class="selection-facts">
      <div>
        <dt>Section</dt>
        <dd data-testid="layout-selection-section">{{ one.section }}</dd>
      </div>
      <div>
        <dt>Table type</dt>
        <dd data-testid="layout-selection-type">{{ one.type }}</dd>
      </div>
      <div>
        <dt>Position</dt>
        <dd data-testid="layout-selection-position">{{ one.position }}</dd>
      </div>
    </dl>
    <p v-else class="selection-text" data-testid="layout-selection-codes">
      {{ codes.join(', ') }}
    </p>
    <div v-if="tables.length" class="selection-actions">
      <button
        type="button"
        class="btn btn--secondary"
        data-testid="layout-selection-turn"
        @click="$emit('turn')"
      >
        Turn 90°
      </button>
      <button
        type="button"
        class="btn btn--secondary btn--destructive"
        data-testid="layout-selection-remove"
        @click="$emit('remove')"
      >
        Remove
      </button>
    </div>
  </section>
</template>

<style scoped>
.selection-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}

.selection-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.selection-facts {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 100%;
  margin: 0;
  font-size: var(--text-sm);
}

.selection-facts > div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
}

.selection-facts dt {
  color: var(--mm-text-muted);
}

.selection-facts dd {
  margin: 0;
  text-align: right;
  overflow-wrap: anywhere;
}

.selection-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
