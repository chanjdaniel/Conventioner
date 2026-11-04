<script setup lang="ts">
/**
 * The export's column choice as a searchable checklist (variant A): a find field over the product's
 * groups, each group's heading kept while it has matches. Ticks a column in or out, as today's
 * dialog does; the order they are ticked in is the file's until the tray changes it.
 *
 * Enter in the field does nothing, since the rows narrow as it is typed in, or it would submit the
 * dialog around it and download what the person was only looking through.
 */
import { computed, ref } from 'vue';
import type { ColumnGroup, ExportColumn } from '@/utils/vendorExport';

const props = defineProps<{
  groups: ColumnGroup[];
  /** The chosen columns' ids. */
  chosen: string[];
}>();

const emit = defineEmits<{ tick: [column: ExportColumn, ticked: boolean] }>();

const words = ref('');

const found = computed(() => {
  const asked = words.value.trim().toLowerCase();
  return props.groups
    .map((group) => ({
      ...group,
      columns: group.columns.filter((column) => column.label.toLowerCase().includes(asked)),
    }))
    .filter((group) => group.columns.length);
});
</script>

<template>
  <div class="column-checklist">
    <div class="column-checklist__find">
      <label class="field-label" for="library-export-columns-find">Find a column</label>
      <input
        id="library-export-columns-find"
        v-model="words"
        type="search"
        autocomplete="off"
        class="field"
        name="library-export-columns-find"
        data-testid="library-export-columns-find"
        @keydown.enter.prevent
      />
    </div>
    <p
      v-if="!found.length"
      class="column-checklist__none"
      role="status"
      data-testid="library-export-columns-none"
    >
      Nothing matches "{{ words.trim() }}".
    </p>
    <section
      v-for="group in found"
      :key="group.id"
      class="column-checklist__group"
      :data-testid="`library-export-group-${group.id}`"
    >
      <h4 class="field-label column-checklist__heading">{{ group.label }}</h4>
      <div class="column-checklist__picks">
        <label v-for="column in group.columns" :key="column.id" class="column-checklist__pick">
          <input
            type="checkbox"
            name="library-export-column"
            :checked="chosen.includes(column.id)"
            :data-testid="`library-export-column-${column.id}`"
            @change="emit('tick', column, ($event.target as HTMLInputElement).checked)"
          />
          <span class="column-checklist__label">{{ column.label }}</span>
        </label>
      </div>
    </section>
  </div>
</template>

<style scoped>
.column-checklist {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.column-checklist__find {
  max-width: 28rem;
}

.column-checklist__none {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.column-checklist__heading {
  margin: 0 0 var(--space-1);
}

.column-checklist__picks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
  gap: 0 var(--space-4);
}

.column-checklist__pick {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
  min-height: var(--target-min);
  padding-block: var(--space-1);
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
}

.column-checklist__label {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
