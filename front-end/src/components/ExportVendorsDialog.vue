<script setup lang="ts">
/**
 * Export vendors (E42/F01/S01): the vendors a page shows, as a CSV for a Google Sheet and YAMM.
 *
 * It opens on the page's filters (`seed`), shows them and lets them change. The columns are ticked
 * under their headings, where they sit on each date under "Assignment" (S02), and the ticked ones
 * are put in order beneath, by dragging or with each row's move buttons. Before the download it
 * says how many vendors and columns the file holds and shows its first rows, which the server
 * builds from the same filters as the file.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import draggable from 'vuedraggable';
import AppDialog from '@/components/AppDialog.vue';
import IconClickDrag from '@/components/icons/IconClickDrag.vue';
import IconExpandDown from '@/components/icons/IconExpandDown.vue';
import IconExpandUp from '@/components/icons/IconExpandUp.vue';
import { getApiErrorMessage } from '@/utils/api';
import { getFormattedDate } from '@/utils/utils';
import {
  chosenColumns,
  columnGroups,
  defaultOrder,
  downloadExport,
  exportSummary,
  fetchExportPreview,
  movedColumn,
  tickedColumn,
  type ExportColumn,
  type ExportFilters,
  type ExportPreview,
} from '@/utils/vendorExport';

const props = defineProps<{ open: boolean; marketId: string; seed: ExportFilters }>();
const emit = defineEmits<{ close: [] }>();

/** A change asks again once typing pauses, not at every key. */
const PREVIEW_DELAY_MS = 250;

const filters = ref<ExportFilters>(copyOf(props.seed));
/** The ticked columns, in the file's order. */
const order = ref<ExportColumn[]>([]);
let started = false;
const preview = ref<ExportPreview | null>(null);
const previewError = ref('');
const error = ref('');
const busy = ref(false);
let asked = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function copyOf(seed: ExportFilters): ExportFilters {
  return {
    ...seed,
    statuses: [...seed.statuses],
    answers: Object.fromEntries(Object.entries(seed.answers).map(([k, v]) => [k, [...v]])),
  };
}

const offered = computed(() => preview.value?.offered ?? null);
const columns = computed(() => chosenColumns(order.value));
const groups = computed(() => (offered.value ? columnGroups(offered.value) : []));

async function ask(): Promise<void> {
  const mine = ++asked;
  try {
    // The first ask names no columns, and the server answers with its defaults ticked.
    const answer = await fetchExportPreview(
      props.marketId,
      filters.value,
      started ? columns.value : undefined,
    );
    if (mine !== asked) return;
    const first = !started;
    if (first) {
      order.value = defaultOrder(answer.offered);
      started = true;
    }
    for (const question of answer.offered.questions) filters.value.answers[question.key] ??= [];
    preview.value = answer;
    previewError.value = '';
    if (first) void focusSearch();
  } catch (err: unknown) {
    if (mine !== asked) return;
    previewError.value = getApiErrorMessage(err, 'The preview could not be loaded.');
  }
}

/**
 * The fields arrive with the first answer, so the dialog opened onto Cancel, its first control then;
 * once they are drawn, focus moves to the first of them, unless the organizer has moved it.
 */
async function focusSearch(): Promise<void> {
  await nextTick();
  const search = document.getElementById('vendor-export-search');
  if (document.activeElement?.matches('[data-testid="vendor-export-cancel-button"]')) {
    search?.focus();
  }
}

function askSoon(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void ask(), PREVIEW_DELAY_MS);
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    filters.value = copyOf(props.seed);
    order.value = [];
    started = false;
    preview.value = null;
    previewError.value = '';
    error.value = '';
    void ask();
  },
  { immediate: true },
);

watch(
  [filters, columns],
  () => {
    if (props.open && preview.value) askSoon();
  },
  { deep: true },
);

onBeforeUnmount(() => clearTimeout(timer));

function move(index: number, by: number): void {
  order.value = movedColumn(order.value, index, by);
}

function isTicked(column: ExportColumn): boolean {
  return order.value.some((each) => each.id === column.id);
}

function tick(column: ExportColumn, event: Event): void {
  order.value = tickedColumn(order.value, column, (event.target as HTMLInputElement).checked);
}

const placed = computed(() => filters.value.placed === 'placed');
const summary = computed(() =>
  preview.value ? exportSummary(preview.value.count, columns.value.length) : '',
);

async function download(): Promise<void> {
  if (busy.value || !columns.value.length) return;
  busy.value = true;
  error.value = '';
  const refused = await downloadExport(props.marketId, filters.value, columns.value);
  busy.value = false;
  if (refused) {
    error.value = refused;
    return;
  }
  emit('close');
}
</script>

<template>
  <AppDialog
    :open="open"
    title="Export vendors"
    testid="vendor-export"
    wide
    :confirm-label="busy ? 'Downloading…' : 'Download CSV'"
    :confirm-disabled="busy || !offered || !columns.length"
    :error="error"
    @close="emit('close')"
    @submit="download"
  >
    <p class="export-note">
      A CSV for a Google Sheet, one row per vendor. It starts from what the page shows.
    </p>

    <p v-if="previewError" class="export-error" data-testid="vendor-export-preview-error">
      {{ previewError }}
    </p>
    <p v-else-if="!offered" class="export-loading">Loading…</p>

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

          <div class="export-field">
            <label class="field-label" for="vendor-export-placed">Placed</label>
            <select
              id="vendor-export-placed"
              v-model="filters.placed"
              class="field field--select"
              data-testid="vendor-export-placed"
            >
              <option value="">Placed or not</option>
              <option value="placed">Placed</option>
              <option value="unplaced">Not placed</option>
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

        <h3 class="field-label export-order-title" id="vendor-export-order-title">
          In the file, in this order
        </h3>
        <p v-if="!order.length" class="export-hint">Tick a column above to export it.</p>
        <draggable
          v-else
          v-model="order"
          tag="ol"
          class="export-columns"
          item-key="id"
          handle=".drag-handle"
          :animation="150"
          aria-labelledby="vendor-export-order-title"
        >
          <template #item="{ element, index }">
            <li class="export-column" data-testid="vendor-export-order-item">
              <span class="drag-handle" aria-hidden="true"
                ><IconClickDrag class="drag-handle__icon"
              /></span>
              <span class="export-column-label">{{ element.label }}</span>
              <button
                type="button"
                class="export-move"
                :aria-label="`Move ${element.label} up`"
                :disabled="index === 0"
                :data-testid="`vendor-export-move-up-${element.id}`"
                @click="move(index, -1)"
              >
                <IconExpandUp aria-hidden="true" />
              </button>
              <button
                type="button"
                class="export-move"
                :aria-label="`Move ${element.label} down`"
                :disabled="index === order.length - 1"
                :data-testid="`vendor-export-move-down-${element.id}`"
                @click="move(index, 1)"
              >
                <IconExpandDown aria-hidden="true" />
              </button>
            </li>
          </template>
        </draggable>
      </fieldset>

      <section class="export-preview" aria-live="polite" aria-label="Preview">
        <p class="export-summary" data-testid="vendor-export-summary">{{ summary }}</p>
        <p v-if="preview && !preview.count" class="export-hint">No vendor matches these filters.</p>
        <div v-else-if="preview && columns.length" class="export-table-scroll">
          <table class="export-table">
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
        </div>
      </section>
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

.export-error {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-red);
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

.export-order-title {
  margin: var(--space-2) 0 0;
}

.export-columns {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
}

.export-column {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  background: white;
}

.export-column + .export-column {
  border-top: 1px solid var(--mm-border);
}

.export-column .drag-handle {
  align-self: stretch;
}

.export-column-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.export-move {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--target-min);
  min-height: var(--target-min);
  padding: 0;
  border: none;
  border-radius: var(--radius-control);
  background: none;
  color: var(--mm-text-muted);
  cursor: pointer;
}

.export-move svg {
  width: var(--space-4);
  height: var(--space-4);
}

.export-move:hover:not(:disabled) {
  color: var(--mm-black);
}

.export-move:focus-visible {
  outline: 2px solid var(--mm-black);
  outline-offset: 2px;
}

.export-move:disabled {
  color: var(--mm-border);
  cursor: not-allowed;
}

.export-preview {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.export-summary {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  color: var(--mm-green);
}

/* The preview is as wide as its columns; the dialog is not. */
.export-table-scroll {
  overflow-x: auto;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
}

.export-table {
  border-collapse: collapse;
  font-size: var(--text-xs);
  min-width: 100%;
}

.export-table th,
.export-table td {
  padding: var(--space-1) var(--space-2);
  text-align: left;
  white-space: nowrap;
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
}

.export-table th {
  background: var(--mm-beige);
  color: var(--mm-black);
}

.export-table td {
  border-top: 1px solid var(--mm-border);
  color: var(--mm-black);
}
</style>
