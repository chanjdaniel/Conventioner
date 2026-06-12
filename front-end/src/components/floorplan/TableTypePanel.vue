<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useFloorplanStore } from '@/stores/floorplan'
import type { TableTypeObject } from '@/assets/types/datatypes'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import SelectButton from 'primevue/selectbutton'
import Dialog from 'primevue/dialog'

// ── Store ──────────────────────────────────────────────────────────
const store = useFloorplanStore()

// ── Emits ──────────────────────────────────────────────────────────
const emit = defineEmits<{
  (e: 'types-changed'): void
}>()

// ── Color palette ──────────────────────────────────────────────────
const PALETTE: string[] = [
  '#4A90D9',
  '#E74C3C',
  '#27AE60',
  '#F39C12',
  '#8E44AD',
  '#1ABC9C',
  '#E67E22',
  '#2C3E50',
  '#95A5A6',
  '#D35400',
]

/** Pick the first palette colour not currently assigned to any table type. */
function nextAvailableColor(): string {
  const used = new Set(store.tableTypes.map((t) => t.color))
  const available = PALETTE.find((c) => !used.has(c))
  return available ?? PALETTE[store.tableTypes.length % PALETTE.length]
}

// ── Inline add form ────────────────────────────────────────────────
const showForm = ref(false)

interface TypeForm {
  name: string
  widthMm: number | null
  heightMm: number | null
  maxCapacity: 1 | 2
}

const form = reactive<TypeForm>({
  name: '',
  widthMm: null,
  heightMm: null,
  maxCapacity: 1,
})

const formError = ref('')

function resetForm() {
  form.name = ''
  form.widthMm = null
  form.heightMm = null
  form.maxCapacity = 1
  formError.value = ''
}

function openForm() {
  resetForm()
  showForm.value = true
}

function cancelForm() {
  showForm.value = false
  resetForm()
}

function saveType() {
  formError.value = ''

  if (!form.name.trim()) {
    formError.value = 'Name is required.'
    return
  }
  if (form.widthMm === null || form.widthMm <= 0) {
    formError.value = 'Width must be a positive number.'
    return
  }
  if (form.heightMm === null || form.heightMm <= 0) {
    formError.value = 'Height must be a positive number.'
    return
  }

  const tt: TableTypeObject = {
    id: crypto.randomUUID(),
    name: form.name.trim(),
    widthMm: form.widthMm,
    heightMm: form.heightMm,
    maxCapacity: form.maxCapacity,
    color: nextAvailableColor(),
  }

  store.addTableType(tt)
  emit('types-changed')
  cancelForm()
}

// ── Edit dialog ────────────────────────────────────────────────────
const editVisible = ref(false)
const editingId = ref<string | null>(null)

const editForm = reactive<TypeForm>({
  name: '',
  widthMm: null,
  heightMm: null,
  maxCapacity: 1,
})

const editError = ref('')

function editType(tt: TableTypeObject) {
  editingId.value = tt.id
  editForm.name = tt.name
  editForm.widthMm = tt.widthMm
  editForm.heightMm = tt.heightMm
  editForm.maxCapacity = tt.maxCapacity as 1 | 2
  editError.value = ''
  editVisible.value = true
}

function saveEdit() {
  editError.value = ''

  if (!editForm.name.trim()) {
    editError.value = 'Name is required.'
    return
  }
  if (editForm.widthMm === null || editForm.widthMm <= 0) {
    editError.value = 'Width must be a positive number.'
    return
  }
  if (editForm.heightMm === null || editForm.heightMm <= 0) {
    editError.value = 'Height must be a positive number.'
    return
  }

  const idx = store.tableTypes.findIndex((t) => t.id === editingId.value)
  if (idx >= 0) {
    store.tableTypes[idx] = {
      ...store.tableTypes[idx],
      name: editForm.name.trim(),
      widthMm: editForm.widthMm,
      heightMm: editForm.heightMm,
      maxCapacity: editForm.maxCapacity,
    }
    store.markDirty()
  }

  emit('types-changed')
  editVisible.value = false
  editingId.value = null
}

function cancelEdit() {
  editVisible.value = false
  editingId.value = null
  editError.value = ''
}

// ── Delete ─────────────────────────────────────────────────────────
function deleteType(tt: TableTypeObject) {
  store.removeTableType(tt.id)
  emit('types-changed')
}

// ── Computed ───────────────────────────────────────────────────────
const typeCount = computed(() => store.tableTypes.length)

const selectOptions = computed(() => [1, 2])
</script>

<template>
  <div class="table-type-panel">
    <h3 class="tt-panel-title">Table Types</h3>

    <!-- ── Type list ────────────────────────────────────────────── -->
    <div class="tt-type-list">
      <TransitionGroup name="tt-list">
        <div
          v-for="tt in store.tableTypes"
          :key="tt.id"
          class="tt-type-card"
        >
          <span
            class="tt-color-swatch"
            :style="{ background: tt.color }"
            aria-hidden="true"
          />
          <div class="tt-type-info">
            <strong class="tt-type-name">{{ tt.name }}</strong>
            <span class="tt-type-dims">
              {{ tt.widthMm }}&times;{{ tt.heightMm }} mm
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
            <i class="pi pi-pencil" />
          </button>
          <button
            class="tt-icon-btn tt-icon-btn--delete"
            title="Delete table type"
            aria-label="Delete table type"
            @click="deleteType(tt)"
          >
            <i class="pi pi-trash" />
          </button>
        </div>
      </TransitionGroup>

      <p
        v-if="store.tableTypes.length === 0"
        class="tt-empty"
      >
        No table types defined yet.
      </p>
    </div>

    <!-- ── Add button ─────────────────────────────────────────────-->
    <button
      v-if="!showForm"
      class="tt-add-btn"
      @click="openForm"
    >
      + Add Table Type
    </button>

    <!-- ── Inline add form ──────────────────────────────────────── -->
    <Transition name="tt-form">
      <div v-if="showForm" class="tt-inline-form">
        <div class="tt-field">
          <label class="tt-label" for="tt-name">Name</label>
          <InputText
            id="tt-name"
            v-model="form.name"
            class="tt-input"
            placeholder="e.g. 6ft Rectangle"
            :class="{ 'tt-input--error': !!formError }"
            @keydown.enter="saveType"
          />
        </div>

        <div class="tt-field-row">
          <div class="tt-field tt-field--half">
            <label class="tt-label" for="tt-width">Width (mm)</label>
            <InputNumber
              id="tt-width"
              v-model="form.widthMm"
              class="tt-input"
              placeholder="Width"
              :min="1"
              :max="10000"
              :class="{ 'tt-input--error': !!formError }"
            />
          </div>
          <div class="tt-field tt-field--half">
            <label class="tt-label" for="tt-height">Height (mm)</label>
            <InputNumber
              id="tt-height"
              v-model="form.heightMm"
              class="tt-input"
              placeholder="Height"
              :min="1"
              :max="10000"
              :class="{ 'tt-input--error': !!formError }"
            />
          </div>
        </div>

        <div class="tt-field">
          <label class="tt-label">Max Capacity</label>
          <SelectButton
            v-model="form.maxCapacity"
            :options="selectOptions"
            option-label="value"
            class="tt-select-btn"
          />
        </div>

        <p v-if="formError" class="tt-error">{{ formError }}</p>

        <div class="tt-form-actions">
          <button
            class="tt-btn tt-btn--secondary"
            @click="cancelForm"
          >
            Cancel
          </button>
          <button
            class="tt-btn tt-btn--primary"
            :disabled="!form.name.trim() || !form.widthMm || !form.heightMm"
            @click="saveType"
          >
            Save
          </button>
        </div>
      </div>
    </Transition>

    <!-- ── Edit dialog ──────────────────────────────────────────── -->
    <Dialog
      v-model:visible="editVisible"
      header="Edit Table Type"
      class="tt-dialog"
      :modal="true"
      :closable="true"
      :draggable="false"
    >
      <div class="tt-dialog-body">
        <div class="tt-field">
          <label class="tt-label" for="tt-edit-name">Name</label>
          <InputText
            id="tt-edit-name"
            v-model="editForm.name"
            class="tt-input"
            placeholder="Table type name"
            :class="{ 'tt-input--error': !!editError }"
            @keydown.enter="saveEdit"
          />
        </div>

        <div class="tt-field-row">
          <div class="tt-field tt-field--half">
            <label class="tt-label" for="tt-edit-width">Width (mm)</label>
            <InputNumber
              id="tt-edit-width"
              v-model="editForm.widthMm"
              class="tt-input"
              placeholder="Width"
              :min="1"
              :max="10000"
              :class="{ 'tt-input--error': !!editError }"
            />
          </div>
          <div class="tt-field tt-field--half">
            <label class="tt-label" for="tt-edit-height">Height (mm)</label>
            <InputNumber
              id="tt-edit-height"
              v-model="editForm.heightMm"
              class="tt-input"
              placeholder="Height"
              :min="1"
              :max="10000"
              :class="{ 'tt-input--error': !!editError }"
            />
          </div>
        </div>

        <div class="tt-field">
          <label class="tt-label">Max Capacity</label>
          <SelectButton
            v-model="editForm.maxCapacity"
            :options="selectOptions"
            option-label="value"
            class="tt-select-btn"
          />
        </div>

        <p v-if="editError" class="tt-error">{{ editError }}</p>
      </div>

      <template #footer>
        <div class="tt-dialog-actions">
          <button
            class="tt-btn tt-btn--secondary"
            @click="cancelEdit"
          >
            Cancel
          </button>
          <button
            class="tt-btn tt-btn--primary"
            :disabled="!editForm.name.trim() || !editForm.widthMm || !editForm.heightMm"
            @click="saveEdit"
          >
            Update
          </button>
        </div>
      </template>
    </Dialog>
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
  font-size: 18px;
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
  box-shadow: 0 2px 12px rgba(73, 176, 150, 0.12);
}

.tt-color-swatch {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 2px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}

.tt-type-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tt-type-name {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--mm-black);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tt-type-dims {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
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
  font-size: 14px;
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
  color: #c0392b;
}

/* ── Empty state ─────────────────────────────────────────────── */
.tt-empty {
  margin: 0;
  padding: 20px 0;
  text-align: center;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: rgba(39, 35, 35, 0.4);
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
  font-size: 14px;
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
  box-shadow: 0 2px 12px rgba(73, 176, 150, 0.1);
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
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--mm-black);
}

.tt-input {
  width: 100%;
  padding: 8px 12px;
  border: 1.5px solid var(--mm-grey);
  border-radius: 8px;
  background: var(--mm-beige);
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-black);
  outline: none;
  transition: border-color 0.15s ease-in-out;
}

.tt-input:focus {
  border-color: var(--mm-green);
  background: #ffffff;
}

.tt-input::placeholder {
  color: rgba(39, 35, 35, 0.4);
}

.tt-input--error {
  border-color: #c0392b;
}

/* ── SelectButton overrides ──────────────────────────────────── */
.tt-select-btn {
  width: 100%;
}

.tt-select-btn :deep(.p-selectbutton) {
  width: 100%;
}

.tt-select-btn :deep(.p-togglebutton) {
  flex: 1;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
}

/* ── Error message ───────────────────────────────────────────── */
.tt-error {
  margin: 0;
  padding: 8px 12px;
  background: color-mix(in srgb, #c0392b 10%, transparent);
  border: 1px solid #c0392b;
  border-radius: 6px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: #c0392b;
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
  font-size: 14px;
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
  background: var(--mm-grey);
  color: var(--mm-black);
}

/* ── Dialog ──────────────────────────────────────────────────── */
.tt-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tt-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
