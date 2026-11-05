<script setup lang="ts">
/**
 * Export vendors as it is drawn (T217), from what it is given, so the component library can mount the
 * same dialog on its fixture; `ExportVendorsDialog` is what asks the server.
 *
 * Broad, with only the choosing scrolling. The cart is pinned above the buttons, whatever is being
 * chosen: how many vendors and columns, the chosen columns in their order, to drag, move or take
 * out, and the file's first rows in that order. A preview that failed says so on the cart's line, in
 * place of a count and rows it can no longer stand by, so the words stay in view when the cart is
 * folded on a phone.
 *
 * `filters` and `order` are its holder's: a field writes into `filters`, which the holder watches
 * deeply, and each change of the order is a new array.
 */
import { computed, nextTick, ref, watch } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import OrderedList from '@/components/OrderedList.vue';
import ScrollBox from '@/components/ScrollBox.vue';
import IconCloseRound from '@/components/icons/IconCloseRound.vue';
import { getFormattedDate } from '@/utils/utils';
import {
  columnGroups,
  exportSummary,
  tickedColumn,
  type ExportColumn,
  type ExportFilters,
  type ExportOffered,
  type ExportPreview,
} from '@/utils/vendorExport';

const props = defineProps<{
  open: boolean;
  /** What the market offers; null until the first preview answers. */
  offered: ExportOffered | null;
  preview: ExportPreview | null;
  previewError: string;
  /** Why the download was refused. */
  error: string;
  /** The download is under way. */
  busy: boolean;
}>();

const filters = defineModel<ExportFilters>('filters', { required: true });
/** The ticked columns, in the file's order. */
const order = defineModel<ExportColumn[]>('order', { required: true });

const emit = defineEmits<{ close: []; download: [] }>();

const groups = computed(() => (props.offered ? columnGroups(props.offered) : []));
const placed = computed(() => filters.value.placed === 'placed');
const summary = computed(() =>
  props.preview ? exportSummary(props.preview.count, order.value.length) : '',
);

const columnKey = (column: ExportColumn) => column.id;
const columnLabel = (column: ExportColumn) => column.label;

function isTicked(column: ExportColumn): boolean {
  return order.value.some((each) => each.id === column.id);
}

function tick(column: ExportColumn, event: Event): void {
  order.value = tickedColumn(order.value, column, (event.target as HTMLInputElement).checked);
}

const dialog = ref<InstanceType<typeof AppDialog> | null>(null);
const cartEl = ref<HTMLElement | null>(null);

/**
 * Folded at 640px or less, or 500px tall or less, where only this has any effect; it opens folded
 * every time, as the words typed are forgotten.
 */
const cartOpen = ref(false);

watch(
  () => props.open,
  () => {
    cartOpen.value = false;
  },
);

/** Takes a column out from the cart. The focus was on its button, which is gone, so it goes on. */
async function removeColumn(column: ExportColumn, at: number): Promise<void> {
  order.value = tickedColumn(order.value, column, false);
  await nextTick();
  const buttons = cartEl.value?.querySelectorAll<HTMLElement>('[data-cart-remove]');
  const next = buttons?.[at] ?? buttons?.[at - 1];
  if (next) next.focus();
  else void dialog.value?.focusInside();
}

/**
 * The fields arrive with the first answer, so the dialog opened onto Cancel, its first control then;
 * once they are drawn, focus moves to the first of them, unless the organizer has moved it.
 */
watch(
  () => props.offered,
  async (now, was) => {
    if (!now || was) return;
    await nextTick();
    if (document.activeElement?.matches('[data-testid="vendor-export-cancel-button"]')) {
      document.getElementById('vendor-export-search')?.focus();
    }
  },
);
</script>

<template>
  <AppDialog
    ref="dialog"
    :open="open"
    title="Export vendors"
    testid="vendor-export"
    size="broad"
    scroll="body"
    :confirm-label="busy ? 'Downloading…' : 'Download CSV'"
    :confirm-disabled="busy || !offered || !order.length"
    :error="error"
    @close="emit('close')"
    @submit="emit('download')"
  >
    <p class="export-note">
      A CSV for a Google Sheet, one row per vendor. It starts from what the page shows.
    </p>

    <p v-if="!offered && !previewError" class="export-loading">Loading…</p>

    <template v-if="offered">
      <fieldset class="export-section">
        <legend class="export-legend">Vendors</legend>

        <div class="export-fields">
          <div class="export-field export-field--wide">
            <label class="field-label" for="vendor-export-search">Name or email</label>
            <input
              id="vendor-export-search"
              v-model="filters.search"
              type="search"
              autocomplete="off"
              class="field"
              data-testid="vendor-export-search"
            />
          </div>

          <fieldset class="export-field export-field--wide export-choices">
            <legend class="field-label">
              Status <span class="export-hint">(none ticked: any status)</span>
            </legend>
            <label v-for="status in offered.statuses" :key="status.id" class="export-check">
              <input
                v-model="filters.statuses"
                type="checkbox"
                name="vendor-export-status"
                :value="status.id"
                :data-testid="`vendor-export-status-${status.id}`"
              />
              {{ status.label }}
            </label>
          </fieldset>

          <!-- The Applications tab's Mine (S03), whose follow-ups the server reads as the asker's. -->
          <label class="export-check export-field--wide">
            <input v-model="filters.mine" type="checkbox" data-testid="vendor-export-mine" />
            Mine: the follow-ups I own
          </label>

          <div class="export-field">
            <label class="field-label" for="vendor-export-placed">Assigned</label>
            <select
              id="vendor-export-placed"
              v-model="filters.placed"
              class="field field--select"
              data-testid="vendor-export-placed"
            >
              <option value="">Assigned or not</option>
              <option value="placed">Assigned</option>
              <option value="unplaced">Not assigned</option>
            </select>
          </div>

          <div v-if="filters.placed" class="export-field">
            <label class="field-label" for="vendor-export-date">On</label>
            <select
              id="vendor-export-date"
              v-model="filters.date"
              class="field field--select"
              data-testid="vendor-export-date"
            >
              <option value="">Any date</option>
              <option v-for="date in offered.dates" :key="date" :value="date">
                {{ getFormattedDate(date) }}
              </option>
            </select>
          </div>

          <template v-if="placed">
            <div class="export-field">
              <label class="field-label" for="vendor-export-section">Section</label>
              <select
                id="vendor-export-section"
                v-model="filters.section"
                class="field field--select"
                data-testid="vendor-export-section"
              >
                <option value="">Any section</option>
                <option v-for="section in offered.sections" :key="section" :value="section">
                  {{ section }}
                </option>
              </select>
            </div>
            <div class="export-field">
              <label class="field-label" for="vendor-export-tier">Tier</label>
              <select
                id="vendor-export-tier"
                v-model="filters.tier"
                class="field field--select"
                data-testid="vendor-export-tier"
              >
                <option value="">Any tier</option>
                <option v-for="tier in offered.tiers" :key="tier" :value="tier">
                  {{ tier }}
                </option>
              </select>
            </div>
            <div class="export-field">
              <label class="field-label" for="vendor-export-size">Table size</label>
              <select
                id="vendor-export-size"
                v-model="filters.size"
                class="field field--select"
                data-testid="vendor-export-size"
              >
                <option value="">Any size</option>
                <option value="full">Full table</option>
                <option value="half">Half table</option>
              </select>
            </div>
          </template>

          <!-- A market without prices offers no payment state: nothing is owed there, so everyone
               who paid would be "Paid more than owed" (E44/F02/S01). -->
          <div v-if="offered.paymentStates.length" class="export-field">
            <label class="field-label" for="vendor-export-payment">Payment</label>
            <select
              id="vendor-export-payment"
              v-model="filters.payment"
              class="field field--select"
              data-testid="vendor-export-payment"
            >
              <option value="">Paid or not</option>
              <option v-for="state in offered.paymentStates" :key="state.id" :value="state.id">
                {{ state.label }}
              </option>
            </select>
          </div>

          <!-- Who is in the Discord server, once a check has run (S05). -->
          <fieldset
            v-if="offered.discordStates.length"
            class="export-field export-field--wide export-choices"
            data-testid="vendor-export-discord"
          >
            <legend class="field-label">
              Discord <span class="export-hint">(none ticked: any state)</span>
            </legend>
            <label v-for="state in offered.discordStates" :key="state.id" class="export-check">
              <input
                v-model="filters.discord"
                type="checkbox"
                name="vendor-export-discord"
                :value="state.id"
                :data-testid="`vendor-export-discord-${state.id}`"
              />
              {{ state.label }}
            </label>
          </fieldset>

          <fieldset
            v-for="question in offered.questions"
            :key="question.key"
            class="export-field export-field--wide export-choices"
          >
            <legend class="field-label">
              {{ question.label }} <span class="export-hint">(none ticked: any answer)</span>
            </legend>
            <label v-for="option in question.options" :key="option" class="export-check">
              <input
                v-model="filters.answers[question.key]"
                type="checkbox"
                :name="`vendor-export-answer-${question.key}`"
                :value="option"
                :data-testid="`vendor-export-answer-${question.key}-${option}`"
              />
              {{ option }}
            </label>
          </fieldset>
        </div>
      </fieldset>

      <fieldset class="export-section">
        <legend class="export-legend">Columns</legend>
        <fieldset
          v-for="group in groups"
          :key="group.id"
          class="export-group"
          :data-testid="`vendor-export-group-${group.id}`"
        >
          <legend class="field-label">{{ group.label }}</legend>
          <div class="export-picks">
            <label v-for="column in group.columns" :key="column.id" class="export-check">
              <input
                type="checkbox"
                name="vendor-export-column"
                :checked="isTicked(column)"
                :data-testid="`vendor-export-column-${column.id}`"
                @change="tick(column, $event)"
              />
              {{ column.label }}
            </label>
          </div>
        </fieldset>
      </fieldset>
    </template>

    <template v-if="offered || previewError" #tray>
      <div
        ref="cartEl"
        class="export-cart"
        :class="{ 'export-cart--open': cartOpen }"
        data-testid="vendor-export-cart"
      >
        <div v-if="offered" id="vendor-export-cart-detail" class="export-cart__detail">
          <section class="export-cart__order" aria-labelledby="vendor-export-order-title">
            <h3 id="vendor-export-order-title" class="field-label export-cart__title">
              In the file, in this order
            </h3>
            <p v-if="!order.length" class="export-hint" data-testid="vendor-export-order-none">
              Choose a column to export it.
            </p>
            <OrderedList
              v-model="order"
              :item-key="columnKey"
              :item-label="columnLabel"
              label="In the file, in this order"
              testid="vendor-export-order"
            >
              <template #row="{ item, index }">
                <span class="export-cart__row">
                  <span class="export-cart__label" data-testid="vendor-export-order-label">{{
                    item.label
                  }}</span>
                  <button
                    type="button"
                    class="export-cart__remove"
                    data-cart-remove
                    data-dialog-not-first
                    :data-testid="`vendor-export-remove-${item.id}`"
                    @click="removeColumn(item, index)"
                  >
                    <IconCloseRound aria-hidden="true" />
                    <span class="visually-hidden">Remove {{ item.label }}</span>
                  </button>
                </span>
              </template>
            </OrderedList>
          </section>

          <section
            v-if="preview && !previewError && (order.length || !preview.count)"
            class="export-cart__preview"
            aria-labelledby="vendor-export-preview-title"
          >
            <h3 id="vendor-export-preview-title" class="field-label export-cart__title">
              Its first rows
            </h3>
            <p v-if="!preview.count" class="export-hint" data-testid="vendor-export-no-vendor">
              No vendor matches these filters.
            </p>
            <ScrollBox
              v-else
              class="data-table-scroll"
              axis="x"
              label="The file's first rows"
              testid="vendor-export-preview"
            >
              <table class="data-table data-table--one-line export-cart__table">
                <thead>
                  <tr data-testid="vendor-export-preview-header">
                    <th v-for="(label, at) in preview.header" :key="at" scope="col">{{ label }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(row, at) in preview.rows"
                    :key="at"
                    data-testid="vendor-export-preview-row"
                  >
                    <td v-for="(cell, col) in row" :key="col">{{ cell }}</td>
                  </tr>
                </tbody>
              </table>
            </ScrollBox>
          </section>
        </div>

        <div class="export-cart__bar" data-testid="vendor-export-cart-bar">
          <div class="export-cart__said" aria-live="polite">
            <p
              v-if="previewError"
              class="export-cart__failed"
              data-testid="vendor-export-preview-error"
            >
              {{ previewError }}
            </p>
            <p v-else class="export-cart__summary" data-testid="vendor-export-summary">
              {{ summary }}
            </p>
          </div>
          <button
            v-if="offered"
            type="button"
            class="btn btn--secondary btn--compact export-cart__toggle"
            :aria-expanded="cartOpen ? 'true' : 'false'"
            aria-controls="vendor-export-cart-detail"
            data-testid="vendor-export-cart-toggle"
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
.export-note,
.export-loading {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.export-section {
  margin: 0;
  padding: 0;
  border: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.export-legend {
  padding: 0;
  margin-bottom: var(--space-2);
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

/* Two columns of label-and-control; a list of choices takes the whole row. */
.export-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

@media (max-width: 640px) {
  .export-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}

.export-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.export-field--wide {
  grid-column: 1 / -1;
}

.export-choices {
  margin: 0;
  padding: 0;
  border: none;
  flex-flow: row wrap;
  column-gap: var(--space-4);
}

.export-choices > legend {
  padding: 0;
  margin-bottom: var(--space-1);
}

.export-hint {
  margin: 0;
  font-size: var(--text-xs);
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

/* A heading's columns, two to a row as the filters above are. */
.export-group {
  margin: 0;
  padding: 0;
  border: none;
  min-width: 0;
}

/* Apart as the filters above are, so a heading reads as the next group's, not the last row's. */
.export-group + .export-group {
  margin-top: var(--space-1);
}

.export-group > legend {
  padding: 0;
  margin-bottom: var(--space-1);
}

.export-picks {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: var(--space-4);
}

@media (max-width: 640px) {
  .export-picks {
    grid-template-columns: minmax(0, 1fr);
  }
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

/* A long answer holds its row to a line and its cell to a width. */
.export-cart__table :is(th, td) {
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Stays at the tray's foot while a long order scrolls it, and at its end covers the tray's bottom
   padding, so no row shows under it. */
.export-cart__bar {
  position: sticky;
  bottom: 0;
  margin-bottom: calc(-1 * var(--space-2));
  padding-bottom: var(--space-2);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  background: white;
}

.export-cart__said {
  min-width: 0;
}

.export-cart__summary {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  color: var(--mm-green);
}

.export-cart__failed {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-red);
}

.export-cart__toggle {
  display: none;
}

/* A phone, or a window split so short that the choosing needs what room there is: the cart is its
   line and its fold, and the tray's cap never crowds the body. */
@media (width <= 640px), (height <= 500px) {
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
