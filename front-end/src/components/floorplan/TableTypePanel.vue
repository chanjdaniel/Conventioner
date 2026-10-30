<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import { useFloorplanStore } from '@/stores/floorplan';
import type { TableTypeObject } from '@/assets/types/datatypes';
import IconPencil from '@/components/icons/IconPencil.vue';
import IconTrash from '@/components/icons/IconTrash.vue';
import AppDialog from '@/components/AppDialog.vue';

// ── Store ──────────────────────────────────────────────────────────
const store = useFloorplanStore();

// ── Emits ──────────────────────────────────────────────────────────
const emit = defineEmits<{
  (e: 'types-changed'): void;
}>();

// ── Color palette ──────────────────────────────────────────────────
const PALETTE: string[] = [
  '#4A90D9',
  'var(--mm-red)',
  '#27AE60',
  '#F39C12',
  '#8E44AD',
  '#1ABC9C',
  '#E67E22',
  '#2C3E50',
  '#95A5A6',
  '#D35400',
];

/** Pick the first palette colour not currently assigned to any table type. */
function nextAvailableColor(): string {
  const used = new Set(store.tableTypes.map((t) => t.color));
  const available = PALETTE.find((c) => !used.has(c));
  return available ?? PALETTE[store.tableTypes.length % PALETTE.length];
}

// ── Unit conversion ──────────────────────────────────────────────────
const UNIT_TO_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
  ft: 304.8,
};

const UNIT_OPTIONS = [
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
  { value: 'in', label: 'in' },
  { value: 'ft', label: 'ft' },
];

const CAPACITIES = [1, 2] as const;

// ── Number fields ──────────────────────────────────────────────────
/*
 * A dimension field holds its text as typed, and the number is read from that text. Drawn back from
 * the parsed number instead, "1.0" would be redrawn as "1" mid-typing and the next "5" would make
 * it 15.
 */

function typed(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

/** A cleared or half-typed field ("1.", which the browser reports as empty) reads as no value. */
function numberIn(text: string): number | null {
  return text === '' ? null : Number(text);
}

/**
 * At most three decimals, for a value that was converted rather than typed: six feet is
 * 1828.8000000000002 mm in floating point, and a unit change divides by 25.4 or 304.8.
 */
function shown(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

// ── Inline add form ────────────────────────────────────────────────
const showForm = ref(false);

/** A new type seats two, as a table does everywhere else in the product - it seated one (bug 38). */
const DEFAULT_CAPACITY = 2;

const form = reactive<{ name: string; maxCapacity: 1 | 2 }>({
  name: '',
  maxCapacity: DEFAULT_CAPACITY,
});
/** The dimensions as typed, in `selectedUnit`. */
const formWidth = ref('');
const formHeight = ref('');

const selectedUnit = ref('mm');
const formError = ref('');

function resetForm() {
  form.name = '';
  formWidth.value = '';
  formHeight.value = '';
  form.maxCapacity = DEFAULT_CAPACITY;
  selectedUnit.value = 'mm';
  formError.value = '';
}

function openForm() {
  resetForm();
  showForm.value = true;
}

function cancelForm() {
  showForm.value = false;
  resetForm();
}

function saveType() {
  formError.value = '';

  if (!form.name.trim()) {
    formError.value = 'Name is required.';
    return;
  }
  const width = numberIn(formWidth.value);
  const height = numberIn(formHeight.value);
  if (width === null || width <= 0) {
    formError.value = 'Width must be a positive number.';
    return;
  }
  if (height === null || height <= 0) {
    formError.value = 'Height must be a positive number.';
    return;
  }

  const factor = UNIT_TO_MM[selectedUnit.value];
  const widthMm = width * factor;
  const heightMm = height * factor;

  const tt: TableTypeObject = {
    id: crypto.randomUUID(),
    name: form.name.trim(),
    widthMm,
    heightMm,
    maxCapacity: form.maxCapacity,
    color: nextAvailableColor(),
  };

  store.addTableType(tt);
  emit('types-changed');
  cancelForm();
}

// ── Edit dialog ────────────────────────────────────────────────────
const editVisible = ref(false);
const editingId = ref<string | null>(null);

const editForm = reactive<{ name: string; maxCapacity: 1 | 2 }>({
  name: '',
  maxCapacity: 1,
});
/*
 * Millimetres are the truth here, and the fields show them in `editUnit`. Converting the fields'
 * own values on a unit change instead lost precision at every change, so Update with nothing
 * touched in feet saved 1800.0000000000002 for 1800.
 */
const editWidthMm = ref<number | null>(null);
const editHeightMm = ref<number | null>(null);
const editWidth = ref('');
const editHeight = ref('');

const editUnit = ref('mm');
const editError = ref('');

function typeEditWidth(text: string) {
  editWidth.value = text;
  const value = numberIn(text);
  editWidthMm.value = value === null ? null : value * UNIT_TO_MM[editUnit.value];
}

function typeEditHeight(text: string) {
  editHeight.value = text;
  const value = numberIn(text);
  editHeightMm.value = value === null ? null : value * UNIT_TO_MM[editUnit.value];
}

function editType(tt: TableTypeObject) {
  editingId.value = tt.id;
  editUnit.value = 'mm';
  editForm.name = tt.name;
  editWidthMm.value = tt.widthMm;
  editHeightMm.value = tt.heightMm;
  editWidth.value = shown(tt.widthMm);
  editHeight.value = shown(tt.heightMm);
  editForm.maxCapacity = tt.maxCapacity as 1 | 2;
  editError.value = '';
  editVisible.value = true;
}

function saveEdit() {
  editError.value = '';

  if (!editForm.name.trim()) {
    editError.value = 'Name is required.';
    return;
  }
  if (editWidthMm.value === null || editWidthMm.value <= 0) {
    editError.value = 'Width must be a positive number.';
    return;
  }
  if (editHeightMm.value === null || editHeightMm.value <= 0) {
    editError.value = 'Height must be a positive number.';
    return;
  }

  const idx = store.tableTypes.findIndex((t) => t.id === editingId.value);
  if (idx >= 0) {
    store.tableTypes[idx] = {
      ...store.tableTypes[idx],
      name: editForm.name.trim(),
      widthMm: editWidthMm.value,
      heightMm: editHeightMm.value,
      maxCapacity: editForm.maxCapacity,
    };
    store.markDirty();
  }

  emit('types-changed');
  editVisible.value = false;
  editingId.value = null;
}

function cancelEdit() {
  editVisible.value = false;
  editingId.value = null;
  editError.value = '';
}

// A unit change redraws the fields from the millimetres, which it leaves alone.
watch(editUnit, (unit) => {
  const factor = UNIT_TO_MM[unit];
  if (editWidthMm.value !== null) editWidth.value = shown(editWidthMm.value / factor);
  if (editHeightMm.value !== null) editHeight.value = shown(editHeightMm.value / factor);
});

// ── Delete ─────────────────────────────────────────────────────────
function deleteType(tt: TableTypeObject) {
  store.removeTableType(tt.id);
  emit('types-changed');
}
</script>

<template>
  <div class="table-type-panel">
    <h3 class="tt-panel-title">Table Types</h3>

    <!-- ── Type list ────────────────────────────────────────────── -->
    <div class="tt-type-list">
      <TransitionGroup name="tt-list">
        <div v-for="tt in store.tableTypes" :key="tt.id" class="tt-type-card">
          <span class="tt-color-swatch" :style="{ background: tt.color }" aria-hidden="true" />
          <div class="tt-type-info">
            <strong class="tt-type-name">{{ tt.name }}</strong>
            <span class="tt-type-dims">
              {{ shown(tt.widthMm) }}&times;{{ shown(tt.heightMm) }} mm
              <span class="tt-type-sep">&middot;</span>
              {{ tt.maxCapacity }}p
            </span>
          </div>
          <button
            class="tt-icon-btn"
            title="Edit table type"
            aria-label="Edit table type"
            @click="editType(tt)"
          >
            <IconPencil />
          </button>
          <button
            class="tt-icon-btn tt-icon-btn--delete"
            title="Delete table type"
            aria-label="Delete table type"
            @click="deleteType(tt)"
          >
            <IconTrash />
          </button>
        </div>
      </TransitionGroup>

      <p v-if="store.tableTypes.length === 0" class="tt-empty">No table types defined yet.</p>
    </div>

    <!-- ── Add button ─────────────────────────────────────────────-->
    <button
      v-if="!showForm"
      class="tt-add-btn"
      data-testid="floorplan-table-type-add-btn"
      @click="openForm"
    >
      + Add Table Type
    </button>

    <!-- ── Inline add form ──────────────────────────────────────── -->
    <Transition name="tt-form">
      <!-- A native form, the product's one Enter pattern (E20/F01/S03). -->
      <form v-if="showForm" class="tt-inline-form" @submit.prevent="saveType">
        <div class="tt-field">
          <label class="tt-label" for="tt-name">Name</label>
          <input
            id="tt-name"
            v-model="form.name"
            type="text"
            class="tt-input"
            placeholder="e.g. 6ft Rectangle"
            data-testid="floorplan-table-type-name-input"
            :class="{ 'tt-input--error': !!formError }"
          />
        </div>

        <div class="tt-field-row">
          <div class="tt-field tt-field--half">
            <label class="tt-label" for="tt-width">Width ({{ selectedUnit }})</label>
            <input
              id="tt-width"
              type="number"
              step="any"
              class="tt-input"
              placeholder="Width"
              data-testid="floorplan-table-type-width-input"
              :value="formWidth"
              @input="formWidth = typed($event)"
              :class="{ 'tt-input--error': !!formError }"
            />
          </div>
          <div class="tt-field tt-field--half">
            <label class="tt-label" for="tt-height">Height ({{ selectedUnit }})</label>
            <input
              id="tt-height"
              type="number"
              step="any"
              class="tt-input"
              placeholder="Height"
              data-testid="floorplan-table-type-height-input"
              :value="formHeight"
              @input="formHeight = typed($event)"
              :class="{ 'tt-input--error': !!formError }"
            />
          </div>
        </div>

        <div class="tt-field">
          <label class="tt-label" for="tt-unit">Unit</label>
          <select id="tt-unit" v-model="selectedUnit" class="tt-input">
            <option v-for="u in UNIT_OPTIONS" :key="u.value" :value="u.value">
              {{ u.label }}
            </option>
          </select>
        </div>

        <fieldset class="tt-capacity" data-testid="floorplan-table-type-capacity">
          <legend class="tt-label">Max Capacity</legend>
          <label v-for="n in CAPACITIES" :key="n" class="tt-capacity-option">
            <input v-model="form.maxCapacity" type="radio" name="tt-capacity" :value="n" />
            {{ n }}
          </label>
        </fieldset>

        <p v-if="formError" class="tt-error">{{ formError }}</p>

        <div class="tt-form-actions">
          <button
            type="button"
            class="tt-btn tt-btn--secondary"
            data-testid="floorplan-table-type-cancel-btn"
            @click="cancelForm"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="tt-btn tt-btn--primary"
            :disabled="!form.name.trim() || !numberIn(formWidth) || !numberIn(formHeight)"
            data-testid="floorplan-table-type-save-btn"
          >
            Save
          </button>
        </div>
      </form>
    </Transition>

    <!-- ── Edit dialog ──────────────────────────────────────────── -->
    <AppDialog
      :open="editVisible"
      title="Edit Table Type"
      testid="floorplan-table-type-edit"
      confirm-label="Update"
      :confirm-disabled="!editForm.name.trim() || !editWidthMm || !editHeightMm"
      :error="editError"
      @submit="saveEdit"
      @close="cancelEdit"
    >
      <div class="tt-field">
        <label class="field-label" for="tt-edit-name">Name</label>
        <input
          id="tt-edit-name"
          v-model="editForm.name"
          type="text"
          class="field"
          placeholder="Table type name"
          data-testid="floorplan-table-type-edit-name-input"
        />
      </div>

      <div class="tt-field-row">
        <div class="tt-field tt-field--half">
          <label class="field-label" for="tt-edit-width">Width ({{ editUnit }})</label>
          <input
            id="tt-edit-width"
            type="number"
            step="any"
            class="field"
            placeholder="Width"
            data-testid="floorplan-table-type-edit-width-input"
            :value="editWidth"
            @input="typeEditWidth(typed($event))"
          />
        </div>
        <div class="tt-field tt-field--half">
          <label class="field-label" for="tt-edit-height">Height ({{ editUnit }})</label>
          <input
            id="tt-edit-height"
            type="number"
            step="any"
            class="field"
            placeholder="Height"
            data-testid="floorplan-table-type-edit-height-input"
            :value="editHeight"
            @input="typeEditHeight(typed($event))"
          />
        </div>
      </div>

      <div class="tt-field">
        <label class="field-label" for="tt-edit-unit">Unit</label>
        <select
          id="tt-edit-unit"
          v-model="editUnit"
          class="field field--select"
          data-testid="floorplan-table-type-edit-unit-select"
        >
          <option v-for="u in UNIT_OPTIONS" :key="u.value" :value="u.value">
            {{ u.label }}
          </option>
        </select>
      </div>

      <fieldset class="tt-capacity" data-testid="floorplan-table-type-edit-capacity">
        <legend class="field-label">Max Capacity</legend>
        <label v-for="n in CAPACITIES" :key="n" class="tt-capacity-option">
          <input v-model="editForm.maxCapacity" type="radio" name="tt-edit-capacity" :value="n" />
          {{ n }}
        </label>
      </fieldset>
    </AppDialog>
  </div>
</template>

<style scoped>
/* ── Panel container ─────────────────────────────────────────── */
.table-type-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.tt-panel-title {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-lg);
  font-weight: 400;
  color: var(--mm-black);
  letter-spacing: 0.02em;
}

/* ── Type list ───────────────────────────────────────────────── */
.tt-type-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.tt-type-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--mm-beige);
  border: 1.5px solid transparent;
  border-radius: 10px;
  transition:
    border-color 0.15s ease-in-out,
    background-color 0.15s ease-in-out,
    box-shadow 0.15s ease-in-out;
}

.tt-type-card:hover {
  border-color: var(--mm-green);
  background: #ffffff;
  box-shadow: 0 2px 12px rgba(54, 130, 111, 0.12);
}

.tt-color-swatch {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 2px solid rgba(255, 255, 255, 0.6);
  box-shadow: var(--shadow-card);
}

.tt-type-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tt-type-name {
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--mm-black);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tt-type-dims {
  font-size: var(--text-xs);
  color: rgba(39, 35, 35, 0.55);
}

.tt-type-sep {
  margin: 0 4px;
  color: rgba(39, 35, 35, 0.3);
}

/* ── Icon buttons ────────────────────────────────────────────── */
.tt-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: rgba(39, 35, 35, 0.45);
  font-size: var(--text-sm);
  cursor: pointer;
  transition:
    background-color 0.15s ease-in-out,
    color 0.15s ease-in-out;
}

.tt-icon-btn:hover {
  background: var(--mm-beige);
  color: var(--mm-black);
}

.tt-icon-btn--delete:hover {
  background: rgba(220, 80, 80, 0.12);
  color: var(--mm-red);
}

/* ── Empty state ─────────────────────────────────────────────── */
.tt-empty {
  margin: 0;
  padding: 20px 0;
  text-align: center;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

/* ── Add button ──────────────────────────────────────────────── */
.tt-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 36px;
  padding: 0 16px;
  background: transparent;
  color: var(--mm-green);
  border: 1.5px dashed var(--mm-green);
  border-radius: 8px;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 0.15s ease-in-out,
    color 0.15s ease-in-out;
}

.tt-add-btn:hover {
  background: color-mix(in srgb, var(--mm-green) 10%, transparent);
  color: color-mix(in srgb, var(--mm-green) 85%, black);
}

/* ── Inline form ─────────────────────────────────────────────── */
.tt-inline-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  background: #ffffff;
  border: 1.5px solid var(--mm-green);
  border-radius: 10px;
  box-shadow: 0 2px 12px rgba(54, 130, 111, 0.1);
}

/* ── Form fields ─────────────────────────────────────────────── */
.tt-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.tt-field-row {
  display: flex;
  gap: 10px;
}

.tt-field--half {
  flex: 1;
  min-width: 0;
}

.tt-label {
  font-size: var(--text-xs);
  font-weight: 400;
  color: var(--mm-black);
}

.tt-input {
  width: 100%;
  padding: 8px 12px;
  border: 1.5px solid var(--mm-border);
  border-radius: 8px;
  background: var(--mm-beige);
  font-size: var(--text-sm);
  color: var(--mm-black);
  outline: none;
  transition: border-color 0.15s ease-in-out;
}

.tt-input::placeholder {
  color: rgba(39, 35, 35, 0.4);
}

.tt-input--error {
  border-color: var(--mm-red);
}

/* ── Capacity: native radios, as the calibration's unit choice ─ */
.tt-capacity {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 0;
  padding: 0;
  border: none;
}

.tt-capacity legend {
  float: left;
  margin: 0 8px 0 0;
  padding: 0;
}

.tt-capacity-option {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--mm-black);
  cursor: pointer;
}

/* ── Error message ───────────────────────────────────────────── */
.tt-error {
  margin: 0;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--mm-red) 10%, transparent);
  border: 1px solid var(--mm-red);
  border-radius: 6px;
  font-size: var(--text-xs);
  color: var(--mm-red);
}

/* ── Form actions ────────────────────────────────────────────── */
.tt-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* ── Buttons ─────────────────────────────────────────────────── */
.tt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 16px;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-sm);
  line-height: 1;
  color: #ffffff;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  transition:
    opacity 0.15s ease-in-out,
    background-color 0.15s ease-in-out;
}

.tt-btn:hover:not(:disabled) {
  opacity: 0.88;
}

.tt-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tt-btn--primary {
  background: var(--mm-green);
}

.tt-btn--secondary {
  background: var(--mm-border);
  color: var(--mm-black);
}

/* ── Transitions ─────────────────────────────────────────────── */
.tt-form-enter-active,
.tt-form-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.tt-form-enter-from,
.tt-form-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.tt-list-enter-active,
.tt-list-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.tt-list-enter-from {
  opacity: 0;
  transform: translateX(-12px);
}

.tt-list-leave-to {
  opacity: 0;
  transform: translateX(12px);
}

.tt-list-move {
  transition: transform 0.2s ease;
}
</style>
