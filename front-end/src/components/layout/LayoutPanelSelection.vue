<script setup lang="ts">
/**
 * The layout page's selection card (T257): nothing selected, "Select tables to change them."; one
 * table, its code and where its centre stands, in metres from the floorplan's top-left corner;
 * several, how many and their codes, the first ten of them. Its fields put the selection in a
 * section or give it a table type, each reading "Mixed" while the selected tables differ; its
 * buttons turn the selection a quarter, duplicate it, line it up or space it evenly (the Align
 * menu) and remove it, with no question asked first, since Undo takes a removal back.
 */
import { computed, useId } from 'vue';
import type { FloorplanTable, TableTypeObject } from '@/assets/types/datatypes';
import RowMenu from '@/components/RowMenu.vue';
import IconExpandDown from '@/components/icons/IconExpandDown.vue';
import { plural } from '@/utils/historyReaders/shared';
import { tableCode, type LayoutSection } from './layoutDrawing';
import type { Alignment } from './layoutGeometry';

/** What the Align menu offers: an edge or a centre to line up by, or an even spacing. */
export type Arrangement = Alignment | 'across' | 'down';

const props = defineProps<{
  /** The selected tables. */
  tables: readonly FloorplanTable[];
  /** The location's sections, as the map draws them. */
  sections: readonly LayoutSection[];
  tableTypes: readonly TableTypeObject[];
}>();

const emit = defineEmits<{
  turn: [];
  remove: [];
  duplicate: [];
  arrange: [how: Arrangement];
  /** The section chosen for the selection; null is no section. */
  section: [sectionId: string | null];
  type: [tableTypeId: string];
}>();

const titleId = useId();
const sectionFieldId = useId();
const typeFieldId = useId();

const NO_SECTION = 'Table in no section';
/** How many codes the card names before it counts the rest. */
const CODES_SHOWN = 10;
/** The value a field holds while the selected tables differ. */
const MIXED = '\u0000mixed';

function sectionOf(table: FloorplanTable) {
  if (table.number === null) return null;
  return props.sections.find(({ section }) => section.id === table.sectionId)?.section ?? null;
}

const codes = computed(() => {
  const all = props.tables.map((table) => tableCode(table, sectionOf(table)) ?? NO_SECTION);
  const more = all.length - CODES_SHOWN;
  return more > 0 ? `${all.slice(0, CODES_SHOWN).join(', ')} and ${more} more` : all.join(', ');
});

const metres = (mm: number) => `${(mm / 1000).toFixed(1)} m`;

/** The one selected table, as the card reads it. */
const one = computed(() => {
  if (props.tables.length !== 1) return null;
  const table = props.tables[0];
  return {
    code: tableCode(table, sectionOf(table)) ?? NO_SECTION,
    position: `${metres(table.xMm)}, ${metres(table.yMm)}`,
  };
});

/** The one value every selected table has, or `MIXED`. */
function shared(values: string[]): string {
  return values.every((value) => value === values[0]) ? (values[0] ?? '') : MIXED;
}

/** The selection's section: '' is no section. */
const sectionValue = computed(() =>
  shared(props.tables.map((table) => sectionOf(table)?.id ?? '')),
);
const typeValue = computed(() => shared(props.tables.map((table) => table.tableTypeId)));
/** A type that is not one of the market's is offered by no option: the field reads it as unknown. */
const typeKnown = computed(
  () => typeValue.value === MIXED || props.tableTypes.some((type) => type.id === typeValue.value),
);

function chosen(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}

const ARRANGEMENTS: readonly { id: Arrangement; label: string }[] = [
  { id: 'left', label: 'Align left' },
  { id: 'centre', label: 'Align centre' },
  { id: 'right', label: 'Align right' },
  { id: 'top', label: 'Align top' },
  { id: 'middle', label: 'Align middle' },
  { id: 'bottom', label: 'Align bottom' },
  { id: 'across', label: 'Space evenly across' },
  { id: 'down', label: 'Space evenly down' },
];
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
    <template v-else>
      <p v-if="!one" class="selection-text" data-testid="layout-selection-codes">{{ codes }}</p>
      <div class="selection-fields">
        <label class="selection-field-name" :for="sectionFieldId">Section</label>
        <select
          :id="sectionFieldId"
          class="field field--select"
          :value="sectionValue"
          data-testid="layout-selection-section"
          @change="emit('section', chosen($event) || null)"
        >
          <option v-if="sectionValue === MIXED" :value="MIXED" disabled>Mixed</option>
          <option v-for="{ section } in sections" :key="section.id" :value="section.id">
            {{ section.name || 'Unnamed section' }}
          </option>
          <option value="">No section</option>
        </select>
        <label class="selection-field-name" :for="typeFieldId">Table type</label>
        <select
          :id="typeFieldId"
          class="field field--select"
          :value="typeValue"
          data-testid="layout-selection-type"
          @change="emit('type', chosen($event))"
        >
          <option v-if="typeValue === MIXED" :value="MIXED" disabled>Mixed</option>
          <option v-else-if="!typeKnown" :value="typeValue" disabled>Unknown type</option>
          <option v-for="type in tableTypes" :key="type.id" :value="type.id">
            {{ type.name }}
          </option>
        </select>
        <template v-if="one">
          <span class="selection-field-name">Position</span>
          <span class="selection-position" data-testid="layout-selection-position">
            {{ one.position }}
          </span>
        </template>
      </div>
      <div class="selection-actions">
        <button
          type="button"
          class="btn btn--secondary"
          data-testid="layout-selection-turn"
          @click="emit('turn')"
        >
          Turn 90°
        </button>
        <button
          type="button"
          class="btn btn--secondary"
          data-testid="layout-selection-duplicate"
          @click="emit('duplicate')"
        >
          Duplicate
        </button>
        <RowMenu
          v-if="tables.length > 1"
          class="selection-align"
          label="Align the selected tables"
          :items="ARRANGEMENTS"
          testid="layout-selection-align"
          @select="emit('arrange', $event as Arrangement)"
        >
          <template #trigger>
            Align
            <IconExpandDown class="selection-align-chevron" aria-hidden="true" />
          </template>
        </RowMenu>
        <button
          type="button"
          class="btn btn--secondary btn--destructive"
          data-testid="layout-selection-remove"
          @click="emit('remove')"
        >
          Remove
        </button>
      </div>
    </template>
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
  overflow-wrap: anywhere;
}

/* Each field beside its name, the names in one column. */
.selection-fields {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--space-2) var(--space-3);
  width: 100%;
  font-size: var(--text-sm);
}

.selection-field-name {
  color: var(--mm-text-muted);
  white-space: nowrap;
}

.selection-position {
  text-align: right;
}

.selection-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

/* The menu's button stands in the row of buttons as one of them: the secondary button's edge and
   height round its words. */
.selection-align :deep(.row-menu-button--words) {
  height: var(--control-height);
  padding: 0 var(--space-4);
  border: 1px solid var(--mm-border);
  background: white;
}

.selection-align :deep(.row-menu-button--words:hover),
.selection-align :deep(.row-menu-button--words[aria-expanded='true']) {
  background: var(--mm-white-hover);
}

.selection-align-chevron {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}
</style>
