<script setup lang="ts">
/**
 * Export vendors' column choice: a find field over the product's groups, each group's heading kept
 * while it has matches, so a market's many columns are found by typing and take a short height.
 *
 * A label is one line, its whole text on hover and in the cart once ticked; on a phone, where nothing
 * hovers, it wraps instead.
 *
 * A tick says so and holds nothing: the ticks are read from `chosen`, so a column taken out of the
 * cart unticks here, whatever the words typed.
 *
 * With a full cart the dialog's body is short, so the field can stand at its foot with all it finds
 * below: whatever the words find first is brought into view.
 *
 * Enter here does nothing, since the rows narrow as they are typed over and a tick is pressed by
 * Space, or it would submit the dialog around it and download what the person was still choosing.
 */
import { computed, ref, watch } from 'vue';
import type { ColumnGroup, ExportColumn } from '@/utils/vendorExport';

const props = defineProps<{
  groups: ColumnGroup[];
  /** The chosen columns' ids. */
  chosen: string[];
}>();

const emit = defineEmits<{ tick: [column: ExportColumn, ticked: boolean] }>();

const words = ref('');
const asked = computed(() => words.value.trim());

const found = computed(() => {
  const lowered = asked.value.toLowerCase();
  return props.groups
    .map((group) => ({
      ...group,
      columns: group.columns.filter((column) => column.label.toLowerCase().includes(lowered)),
    }))
    .filter((group) => group.columns.length);
});

const root = ref<HTMLElement | null>(null);

watch(
  words,
  () => {
    root.value
      ?.querySelector('.column-checklist__pick, .column-checklist__none')
      ?.scrollIntoView({ block: 'nearest' });
  },
  { flush: 'post' },
);
</script>

<template>
  <div ref="root" class="column-checklist" @keydown.enter.prevent>
    <div class="column-checklist__find">
      <label class="field-label" for="vendor-export-columns-find">Find a column</label>
      <input
        id="vendor-export-columns-find"
        v-model="words"
        type="search"
        autocomplete="off"
        class="field"
        name="vendor-export-columns-find"
        data-testid="vendor-export-columns-find"
      />
      <!-- In the page from the start, so a screen reader hears the words when they come. -->
      <div role="status">
        <p
          v-if="!found.length"
          class="column-checklist__none"
          data-testid="vendor-export-columns-none"
        >
          Nothing matches "{{ asked }}".
        </p>
      </div>
    </div>
    <fieldset
      v-for="group in found"
      :key="group.id"
      class="column-checklist__group"
      :data-testid="`vendor-export-group-${group.id}`"
    >
      <legend class="field-label">{{ group.label }}</legend>
      <div class="column-checklist__picks">
        <label v-for="column in group.columns" :key="column.id" class="column-checklist__pick">
          <input
            type="checkbox"
            name="vendor-export-column"
            :checked="chosen.includes(column.id)"
            :data-testid="`vendor-export-column-${column.id}`"
            @change="emit('tick', column, ($event.target as HTMLInputElement).checked)"
          />
          <span class="column-checklist__label" :title="column.label">{{ column.label }}</span>
        </label>
      </div>
    </fieldset>
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
  margin: var(--space-2) 0 0;
  scroll-margin-block: var(--space-3);
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.column-checklist__group {
  margin: 0;
  padding: 0;
  border: none;
  min-width: 0;
}

.column-checklist__group > legend {
  padding: 0;
  margin-bottom: var(--space-1);
}

/* As many to a row as fit: three at the broad width, one on a phone. */
.column-checklist__picks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
  gap: 0 var(--space-4);
}

.column-checklist__pick {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  min-height: var(--target-min);
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
  scroll-margin-block: var(--space-3);
}

.column-checklist__pick input {
  flex: none;
}

.column-checklist__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Nothing hovers here, so the whole text wraps rather than hiding behind a title. */
@media (width <= 640px) {
  .column-checklist__label {
    overflow-wrap: anywhere;
    white-space: normal;
  }
}
</style>
