<script setup lang="ts">
/**
 * The export vendors dialog, redesigned on the new parts (T200): broad, its body scrolling, its
 * filters in columns, its column choice in the variant asked for, and what is gathered pinned in the
 * tray as a cart: the chosen columns in order, the first vendors in them, and the summary line. It
 * does not replace `ExportVendorsDialog.vue`, which converts after Daniel's critique.
 *
 * Today's dialog asks the server for all of this. Here `exportVendors.ts` answers from the fixture,
 * and Download only says what it would export. As today's, it starts afresh each time it opens.
 */
import { computed, nextTick, ref, watch } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import FilterToggles from '@/components/FilterToggles.vue';
import OrderedList from '@/components/OrderedList.vue';
import SearchPicker, { type PickerOption } from '@/components/SearchPicker.vue';
import IconCloseRound from '@/components/icons/IconCloseRound.vue';
import { getFormattedDate } from '@/utils/utils';
import {
  chosenColumns,
  columnGroups,
  defaultOrder,
  exportSummary,
  NO_FILTERS,
  tickedColumn,
  type ExportColumn,
  type ExportFilters,
} from '@/utils/vendorExport';
import { cellOf, vendorsKept } from '../exportVendors';
import { fixture } from '../fixture';
import ColumnChecklist from './ColumnChecklist.vue';

const props = defineProps<{ open: boolean; variant: 'checklist' | 'combobox' }>();

const emit = defineEmits<{
  close: [];
  download: [vendors: number, columns: string[]];
}>();

const offered = fixture.export;
/** The first reviewer stands for who is exporting, as the `list-frame` entry has it. */
const READER = fixture.reviewers[0]!;
/** The rows the product's preview shows (`PREVIEW_ROWS`). */
const PREVIEW_ROWS = 3;
/** What an answer's combobox draws of what the words find, as the other long comboboxes do. */
const CAP = 50;

const blankFilters = (): ExportFilters => ({
  ...NO_FILTERS,
  statuses: [],
  discord: [],
  answers: Object.fromEntries(offered.questions.map((question) => [question.key, []])),
});

const filters = ref(blankFilters());
const order = ref<ExportColumn[]>([]);
const cartOpen = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    filters.value = blankFilters();
    order.value = defaultOrder(offered);
    cartOpen.value = false;
  },
  { immediate: true },
);

const groups = columnGroups(offered);
const chosen = computed(() => chosenColumns(order.value));
const vendors = computed(() => vendorsKept(filters.value, READER));
const previewRows = computed(() => vendors.value.slice(0, PREVIEW_ROWS));
const summary = computed(() => exportSummary(vendors.value.length, order.value.length));

const placed = computed(() => filters.value.placed === 'placed');

/** The filters' toggles, whose ids narrow to the product's own types on the way back. */
const statuses = computed({
  get: () => filters.value.statuses as string[],
  set: (ids) => (filters.value.statuses = ids as ExportFilters['statuses']),
});
const discord = computed({
  get: () => filters.value.discord as string[],
  set: (ids) => (filters.value.discord = ids as ExportFilters['discord']),
});

const holds = (text: string, words: string) => text.toLowerCase().includes(words.toLowerCase());
const findsByLabel = (option: PickerOption, words: string) => holds(option.label, words);

const answerGroups = offered.questions.map((question) => ({
  key: question.key,
  label: question.label,
  groups: [{ options: question.options.map((value) => ({ value, label: value })) }],
}));

function setAnswers(key: string, chosenAnswers: string | string[]): void {
  filters.value.answers[key] = chosenAnswers as string[];
}

const columnPicker = groups.map((group) => ({
  label: group.label,
  options: group.columns.map((column) => ({ value: column.id, label: column.label })),
}));

function setChosen(ids: string | string[]): void {
  order.value = (ids as string[]).map(
    (id) => offered.columns.find((column) => column.id === id) as ExportColumn,
  );
}

function tick(column: ExportColumn, ticked: boolean): void {
  order.value = tickedColumn(order.value, column, ticked);
}

const columnKey = (column: ExportColumn) => column.id;
const columnLabel = (column: ExportColumn) => column.label;

const cartEl = ref<HTMLElement | null>(null);

/** Takes a column out from the cart. The focus was on its button, which is gone, so it goes on. */
async function removeColumn(column: ExportColumn, at: number): Promise<void> {
  tick(column, false);
  await nextTick();
  const buttons = cartEl.value?.querySelectorAll<HTMLElement>('[data-cart-remove]');
  (buttons?.[at] ?? buttons?.[at - 1])?.focus();
}

function download(): void {
  if (!order.value.length) return;
  emit('download', vendors.value.length, order.value.map(columnLabel));
}
</script>

<template>
  <AppDialog
    :open="open"
    title="Export vendors"
    testid="library-export-dialog"
    size="broad"
    scroll="body"
    confirm-label="Download CSV"
    :confirm-disabled="!order.length"
    @close="emit('close')"
    @submit="download"
  >
    <p class="export-note">A CSV for a Google Sheet, one row per vendor.</p>

    <section class="export-section" aria-labelledby="library-export-vendors">
      <h3 id="library-export-vendors" class="export-heading">Vendors</h3>

      <div class="export-fields">
        <div class="export-field">
          <label class="field-label" for="library-export-search">Name or email</label>
          <input
            id="library-export-search"
            v-model="filters.search"
            type="search"
            autocomplete="off"
            class="field"
            name="library-export-search"
            data-testid="library-export-search"
          />
        </div>

        <div class="export-field">
          <label class="field-label" for="library-export-payment">Payment</label>
          <select
            id="library-export-payment"
            v-model="filters.payment"
            class="field field--select"
            data-testid="library-export-payment"
          >
            <option value="">Paid or not</option>
            <option v-for="state in offered.paymentStates" :key="state.id" :value="state.id">
              {{ state.label }}
            </option>
          </select>
        </div>

        <div class="export-field">
          <label class="field-label" for="library-export-placed">Assigned</label>
          <select
            id="library-export-placed"
            v-model="filters.placed"
            class="field field--select"
            data-testid="library-export-placed"
          >
            <option value="">Assigned or not</option>
            <option value="placed">Assigned</option>
            <option value="unplaced">Not assigned</option>
          </select>
        </div>

        <div v-if="filters.placed" class="export-field">
          <label class="field-label" for="library-export-date">On</label>
          <select
            id="library-export-date"
            v-model="filters.date"
            class="field field--select"
            data-testid="library-export-date"
          >
            <option value="">Any date</option>
            <option v-for="date in offered.dates" :key="date" :value="date">
              {{ getFormattedDate(date) }}
            </option>
          </select>
        </div>

        <template v-if="placed">
          <div class="export-field">
            <label class="field-label" for="library-export-section">Section</label>
            <select
              id="library-export-section"
              v-model="filters.section"
              class="field field--select"
              data-testid="library-export-section"
            >
              <option value="">Any section</option>
              <option v-for="section in offered.sections" :key="section" :value="section">
                {{ section }}
              </option>
            </select>
          </div>
          <div class="export-field">
            <label class="field-label" for="library-export-tier">Tier</label>
            <select
              id="library-export-tier"
              v-model="filters.tier"
              class="field field--select"
              data-testid="library-export-tier"
            >
              <option value="">Any tier</option>
              <option v-for="tier in offered.tiers" :key="tier" :value="tier">{{ tier }}</option>
            </select>
          </div>
          <div class="export-field">
            <label class="field-label" for="library-export-size">Table size</label>
            <select
              id="library-export-size"
              v-model="filters.size"
              class="field field--select"
              data-testid="library-export-size"
            >
              <option value="">Any size</option>
              <option value="full">Full table</option>
              <option value="half">Half table</option>
            </select>
          </div>
        </template>
      </div>

      <div class="export-toggles">
        <span class="field-label" aria-hidden="true">
          Status <span class="export-hint">(none pressed: any status)</span>
        </span>
        <div class="export-toggles__row">
          <FilterToggles
            v-model="statuses"
            multiple
            :options="offered.statuses"
            label="Status"
            testid="library-export-status"
          />
          <label class="export-check">
            <input
              v-model="filters.mine"
              type="checkbox"
              name="library-export-mine"
              data-testid="library-export-mine"
            />
            Mine: the follow-ups I own
          </label>
        </div>
      </div>

      <div class="export-toggles">
        <span class="field-label" aria-hidden="true">
          Discord <span class="export-hint">(none pressed: any state)</span>
        </span>
        <FilterToggles
          v-model="discord"
          multiple
          :options="offered.discordStates"
          label="Discord"
          testid="library-export-discord"
        />
      </div>

      <div class="export-answers">
        <SearchPicker
          v-for="(question, at) in answerGroups"
          :key="question.key"
          :model-value="filters.answers[question.key] ?? []"
          multiple
          :groups="question.groups"
          :finds="findsByLabel"
          :cap="CAP"
          :label="question.label"
          placeholder="Any answer"
          none-word="Nothing"
          :testid="`library-export-answer-${at}`"
          @update:model-value="setAnswers(question.key, $event)"
        />
      </div>
    </section>

    <section class="export-section" aria-labelledby="library-export-columns">
      <h3 id="library-export-columns" class="export-heading">Columns</h3>
      <ColumnChecklist
        v-if="variant === 'checklist'"
        :groups="groups"
        :chosen="chosen"
        @tick="tick"
      />
      <SearchPicker
        v-else
        :model-value="chosen"
        multiple
        :groups="columnPicker"
        :finds="findsByLabel"
        label="Find a column"
        placeholder="Type a column…"
        none-word="Nothing"
        testid="library-export-columns"
        @update:model-value="setChosen"
      />
    </section>

    <template #tray>
      <div
        ref="cartEl"
        class="export-cart"
        :class="{ 'export-cart--open': cartOpen }"
        data-testid="library-export-cart"
      >
        <div id="library-export-cart-detail" class="export-cart__detail">
          <section class="export-cart__order" aria-labelledby="library-export-order-title">
            <h3 id="library-export-order-title" class="field-label export-cart__title">
              In the file, in this order
            </h3>
            <p v-if="!order.length" class="export-hint" data-testid="library-export-order-none">
              Choose a column to export it.
            </p>
            <OrderedList
              v-model="order"
              :item-key="columnKey"
              :item-label="columnLabel"
              label="In the file, in this order"
              testid="library-export-order"
            >
              <template #row="{ item, index }">
                <span class="export-cart__row">
                  <span class="export-cart__label" data-testid="library-export-order-label">{{
                    item.label
                  }}</span>
                  <button
                    type="button"
                    class="export-cart__remove"
                    data-cart-remove
                    data-dialog-not-first
                    :data-testid="`library-export-remove-${item.id}`"
                    @click="removeColumn(item, index)"
                  >
                    <IconCloseRound aria-hidden="true" />
                    <span class="visually-hidden">Remove {{ item.label }}</span>
                  </button>
                </span>
              </template>
            </OrderedList>
          </section>

          <section class="export-cart__preview" aria-labelledby="library-export-preview-title">
            <h3 id="library-export-preview-title" class="field-label export-cart__title">
              Its first rows
            </h3>
            <p v-if="!vendors.length" class="export-hint" data-testid="library-export-no-vendor">
              No vendor matches these filters.
            </p>
            <div
              v-else-if="order.length"
              class="data-table-scroll"
              role="region"
              aria-label="The file's first rows"
              tabindex="0"
              data-testid="library-export-preview"
            >
              <table class="data-table data-table--one-line export-cart__table">
                <thead>
                  <tr data-testid="library-export-preview-header">
                    <th v-for="column in order" :key="column.id" scope="col">{{ column.label }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="vendor in previewRows"
                    :key="vendor.id"
                    data-testid="library-export-preview-row"
                  >
                    <td v-for="column in order" :key="column.id">
                      {{ cellOf(vendor, column.id) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div class="export-cart__bar" data-testid="library-export-cart-bar">
          <p class="export-cart__summary" aria-live="polite" data-testid="library-export-summary">
            {{ summary }}
          </p>
          <button
            type="button"
            class="btn btn--secondary btn--compact export-cart__toggle"
            :aria-expanded="cartOpen ? 'true' : 'false'"
            aria-controls="library-export-cart-detail"
            data-testid="library-export-cart-toggle"
            @click="cartOpen = !cartOpen"
          >
            {{ cartOpen ? 'Hide the file' : 'Show the file' }}
          </button>
        </div>
      </div>
    </template>
  </AppDialog>
</template>

<style scoped>
.export-note {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.export-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
}

.export-heading {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

/* As many columns of label-and-control as fit: four at the broad width, one on a phone. */
.export-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 12rem), 1fr));
  gap: var(--space-3);
}

.export-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.export-toggles {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.export-toggles__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
}

.export-hint {
  margin: 0;
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--mm-text-muted);
}

.export-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--target-min);
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
}

/* Two to a row at the broad width: a question's words are long, and a list opens under its field. */
.export-answers {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
  gap: var(--space-3);
  align-items: start;
}

.export-cart {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

/* The order beside the rows it makes. The rows stay in view while a long order scrolls the tray. */
.export-cart__detail {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: var(--space-4);
  align-items: start;
  min-width: 0;
}

.export-cart__order,
.export-cart__preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.export-cart__preview {
  position: sticky;
  top: 0;
  background: white;
}

.export-cart__title {
  margin: 0;
}

.export-cart__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
}

.export-cart__label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.export-cart__remove {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: var(--target-min);
  min-height: var(--target-min);
  padding: 0;
  border: 0;
  border-radius: var(--radius-control);
  background: none;
  color: var(--mm-text-muted);
  cursor: pointer;
}

.export-cart__remove:hover {
  color: var(--mm-black);
}

.export-cart__remove svg {
  width: var(--space-3);
  height: var(--space-3);
}

/* A long answer holds its row to a line and its cell to a width, as today's preview does. */
.export-cart__table :is(th, td) {
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Stays at the tray's foot while a long order scrolls it, and covers the tray's bottom padding, which
   a sticky box stops short of, so no row shows under it. */
.export-cart__bar {
  position: sticky;
  bottom: calc(-1 * var(--space-2));
  margin-bottom: calc(-1 * var(--space-2));
  padding-bottom: var(--space-2);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  background: white;
}

.export-cart__summary {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  color: var(--mm-green);
}

.export-cart__toggle {
  display: none;
}

@media (width <= 640px) {
  .export-cart__detail {
    grid-template-columns: minmax(0, 1fr);
  }

  .export-cart__preview {
    position: static;
  }

  .export-cart:not(.export-cart--open) .export-cart__detail {
    display: none;
  }

  .export-cart__toggle {
    display: inline-flex;
  }
}
</style>
