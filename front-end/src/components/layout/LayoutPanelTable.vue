<script setup lang="ts">
/**
 * The read layout's card of the table read (T257): the table last tapped, pressed or focused on
 * the read map, its code ("Silver aisle 5", its section and number) over its section's tier and its
 * type with its size ("Silver tier · Standard 6 ft (183 x 76 cm)"). A table in no section is said
 * so, with its type. With no table read yet it says how to read one: by a tap on a phone, by a
 * press or the arrow keys at a desk.
 */
import { computed } from 'vue';
import type { FloorplanTable, TableTypeObject } from '@/assets/types/datatypes';
import { tableCode, type LayoutSection } from './layoutDrawing';
import { sizeInWords } from './layoutTypes';

const props = defineProps<{
  /** The table read; null before one is. */
  table: FloorplanTable | null;
  /** The location's sections, as the map draws them. */
  sections: readonly LayoutSection[];
  tableTypes: readonly TableTypeObject[];
  /** Whether the page is read on a phone, where a table is tapped. */
  phone: boolean;
}>();

/** The table's section, as the map draws it: a table numbered in one of the location's. */
const section = computed(() => {
  const id = props.table?.id;
  return props.sections.find(({ tables }) => tables.some((one) => one.id === id))?.section ?? null;
});

const title = computed(() =>
  props.table ? (tableCode(props.table, section.value) ?? 'Table in no section') : '',
);

/** The section's tier, in a section; none said in no section. */
const tier = computed(() =>
  section.value ? (section.value.tier ? `${section.value.tier.name} tier` : 'No tier') : null,
);

/** The table's type, when it is one of the market's. */
const type = computed(
  () => props.tableTypes.find((one) => one.id === props.table?.tableTypeId) ?? null,
);
</script>

<template>
  <section class="layout-table-read" data-testid="layout-panel-table">
    <template v-if="table">
      <h2 class="layout-table-read-title" data-testid="layout-table-read-title">{{ title }}</h2>
      <p v-if="tier || type" class="layout-table-read-facts" data-testid="layout-table-read-facts">
        <template v-if="tier">{{ tier }}</template>
        <template v-if="tier && type"> · </template>
        <!-- The size is one piece: "(183 x 76 cm)" never breaks before its unit. -->
        <template v-if="type">
          {{ type.name }} <span class="layout-table-read-size">({{ sizeInWords(type) }})</span>
        </template>
      </p>
    </template>
    <p v-else class="layout-table-read-facts" data-testid="layout-table-read-empty">
      <template v-if="phone">Tap a table to read it.</template>
      <template v-else>Press a table, or move to it with the arrow keys, to read it.</template>
    </p>
  </section>
</template>

<style scoped>
.layout-table-read-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}

.layout-table-read-size {
  white-space: nowrap;
}

.layout-table-read-facts {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}
</style>
