<script setup lang="ts">
/**
 * The export vendors dialog, redesigned as a prototype (T200): the dialog itself, opened on either
 * column choice, and `OrderedList`, its first use, in its own states. The real dialog is unchanged.
 */
import { computed, ref } from 'vue';
import FilterToggles from '@/components/FilterToggles.vue';
import OrderedList from '@/components/OrderedList.vue';
import { columnGroups, exportSummary, type ExportColumn } from '@/utils/vendorExport';
import ChoicesForYou from '../parts/ChoicesForYou.vue';
import ExportDialogPrototype from '../parts/ExportDialogPrototype.vue';
import LibraryPanel from '../parts/LibraryPanel.vue';
import LibrarySection from '../parts/LibrarySection.vue';
import ReadOut from '../parts/ReadOut.vue';
import { fixture } from '../fixture';

const offered = fixture.export;
const groups = columnGroups(offered);

const VARIANTS = [
  { id: 'checklist', label: 'A: a searchable grouped checklist' },
  { id: 'combobox', label: 'B: a grouped combobox' },
];
const variantId = ref('checklist');
const variant = computed(() => (variantId.value === 'combobox' ? 'combobox' : 'checklist'));
const open = ref(false);
const downloaded = ref<string | null>(null);

function download(vendors: number, columns: string[]): void {
  downloaded.value = `${exportSummary(vendors, columns.length)}: ${columns.join(', ')}`;
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
    :about="`Today's is 38rem wide and its whole window scrolls, so its order list and its preview lie below ${offered.questions.reduce((sum, question) => sum + question.options.length, 0)} answer checkboxes on this market. Here it is broad, its filters in columns, and the chosen columns and the file's first rows are pinned as a cart.`"
  >
    <LibraryPanel label="Open it on either column choice" class="library-wide">
      <div class="library-demo">
        <div class="library-variant">
          <span class="field-label">How the columns are chosen</span>
          <FilterToggles
            v-model="variantId"
            :options="VARIANTS"
            label="How the columns are chosen"
            rest="checklist"
            testid="library-export-variant"
          />
        </div>
        <button
          type="button"
          class="btn btn--primary"
          data-testid="library-export-open"
          @click="open = true"
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
    <ExportDialogPrototype
      :open="open"
      :variant="variant"
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

  <ChoicesForYou>
    <li>
      <strong>The column choice:</strong> the grouped checklist (A) or the combobox (B). A shows
      every column while nothing is typed, and takes the body's height for it; B keeps the body
      short and shows the chosen twice, as chips and in the cart.
    </li>
    <li>
      <strong>What the tray holds:</strong> the order and the preview, as here, or the order only
      with the preview a step of its own.
    </li>
    <li>
      <strong>The preview's rows:</strong> 3, as the product's preview has, or more, which takes the
      body's height or scrolls inside the tray's cap?
    </li>
    <li>
      <strong>The tray folded on a phone:</strong> folded to its summary line, as here, or open
      until closed.
    </li>
    <li>
      <strong>Remove on a cart's row:</strong> beyond the plan, so a column goes without finding it
      again in the body. Keep it? On a phone it leaves the row's words less room.
    </li>
    <li>
      <strong>The order beside the preview at a desk:</strong> a long order scrolls the tray while
      the preview stays, up to the tray's cap of 40% of the window. Keep the two side by side, or
      stack them?
    </li>
    <li>
      <strong>Mine:</strong> kept as a tick beside the status toggles. Keep it a tick, make it one
      of the toggles, or leave it out of this dialog?
    </li>
  </ChoicesForYou>
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

.library-variant {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.library-slot-row {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
}
</style>
