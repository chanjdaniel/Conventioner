<script setup lang="ts">
/**
 * Export vendors on the fixture's market (T200, T217): `ExportVendorsForm`, the dialog that ships,
 * with `exportVendors.ts` answering in place of the server, and `OrderedList`, which its cart is made
 * of, in its own states. Download only says what it would export.
 */
import { computed, ref } from 'vue';
import ExportVendorsForm from '@/components/ExportVendorsForm.vue';
import OrderedList from '@/components/OrderedList.vue';
import {
  chosenColumns,
  columnGroups,
  defaultOrder,
  exportSummary,
  NO_FILTERS,
  type ExportColumn,
  type ExportFilters,
} from '@/utils/vendorExport';
import { exportPreview } from '../exportVendors';
import LibraryPanel from '../parts/LibraryPanel.vue';
import LibrarySection from '../parts/LibrarySection.vue';
import ReadOut from '../parts/ReadOut.vue';
import { fixture } from '../fixture';

const offered = fixture.export;
const groups = columnGroups(offered);
/** The first reviewer stands for who is exporting, as the `list-frame` entry has it. */
const READER = fixture.reviewers[0]!;

/** As the product's, every question is there with nothing chosen. */
const blankFilters = (): ExportFilters => ({
  ...NO_FILTERS,
  statuses: [],
  discord: [],
  answers: Object.fromEntries(offered.questions.map((question) => [question.key, []])),
});

const open = ref(false);
const filters = ref(blankFilters());
const order = ref<ExportColumn[]>(defaultOrder(offered));
const preview = computed(() => exportPreview(filters.value, chosenColumns(order.value), READER));
const downloaded = ref<string | null>(null);

/** It starts afresh each time it opens, as the product's does. */
function start(): void {
  filters.value = blankFilters();
  order.value = defaultOrder(offered);
  open.value = true;
}

function download(): void {
  if (!order.value.length) return;
  const columns = order.value.map(columnLabel).join(', ');
  downloaded.value = `${exportSummary(preview.value.count, order.value.length)}: ${columns}`;
  open.value = false;
}

const columnKey = (column: ExportColumn) => column.id;
const columnLabel = (column: ExportColumn) => column.label;
const columnsFrom = (from: number, count: number) => offered.columns.slice(from, from + count);
const groupOf = (column: ExportColumn) =>
  groups.find((group) => group.id === column.group)?.label ?? '';
const byLength = [...offered.columns].sort((a, b) => b.label.length - a.label.length);

const several = ref(columnsFrom(0, 4));
const one = ref(columnsFrom(0, 1));
const longest = ref(byLength.slice(0, 3));
const withSlot = ref(columnsFrom(2, 3));
const labels = (list: ExportColumn[]) => list.map(columnLabel);
</script>

<template>
  <LibrarySection
    title="The dialog"
    :about="`The dialog that ships, on a market of ${offered.columns.length} columns and ${offered.questions.length} answer filters. At a desk it is 60rem wide and no taller than 80% of the window; only the choosing scrolls, the filters folded behind one line and the columns under a find field, while the chosen columns and the file's first rows stay pinned as a cart.`"
  >
    <LibraryPanel label="Open it" class="library-wide">
      <div class="library-demo">
        <button
          type="button"
          class="btn btn--primary"
          data-testid="library-export-open"
          @click="start"
        >
          Export vendors
        </button>
        <ReadOut label="Download CSV would export" :value="downloaded" />
        <p class="library-quiet">
          The fixture holds no follow-up's owner, so Mine here means the follow-ups dealt to the
          first reviewer.
        </p>
      </div>
    </LibraryPanel>
    <ExportVendorsForm
      v-model:filters="filters"
      v-model:order="order"
      :open="open"
      :offered="offered"
      :preview="preview"
      preview-error=""
      error=""
      :busy="false"
      @close="open = false"
      @download="download"
    />
  </LibrarySection>

  <LibrarySection
    title="The ordered list"
    about="OrderedList, which the cart is made of, on the export's own columns. Every row has the drag handle and its own move buttons, so the keyboard can do what the mouse can; the assignment priority, the tier setup and the form builder are drag alone today."
  >
    <LibraryPanel label="Several rows">
      <div class="library-demo" data-testid="library-order-several">
        <OrderedList
          v-model="several"
          :item-key="columnKey"
          :item-label="columnLabel"
          label="Several rows"
          testid="library-order-several-list"
        />
        <ReadOut label="In order" :value="labels(several)" />
      </div>
    </LibraryPanel>
    <LibraryPanel label="One row: both ends">
      <OrderedList
        v-model="one"
        :item-key="columnKey"
        :item-label="columnLabel"
        label="One row"
        testid="library-order-one-list"
      />
    </LibraryPanel>
    <LibraryPanel label="The longest labels">
      <div class="library-demo">
        <OrderedList
          v-model="longest"
          :item-key="columnKey"
          :item-label="columnLabel"
          label="The longest labels"
          testid="library-order-longest-list"
        />
      </div>
    </LibraryPanel>
    <LibraryPanel label="A row the screen draws">
      <OrderedList
        v-model="withSlot"
        :item-key="columnKey"
        :item-label="columnLabel"
        label="A row the screen draws"
        testid="library-order-slot-list"
      >
        <template #row="{ item, index }">
          <span class="library-slot-row"
            >{{ index + 1 }}. {{ item.label }}
            <span class="chip chip--neutral chip--small">{{ groupOf(item) }}</span></span
          >
        </template>
      </OrderedList>
    </LibraryPanel>
  </LibrarySection>
</template>

<style scoped>
.library-wide {
  grid-column: 1 / -1;
}

.library-demo {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  width: 100%;
  min-width: 0;
}

.library-demo > * {
  max-width: 100%;
}

.library-quiet {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.library-slot-row {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
}
</style>
