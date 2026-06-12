<script setup lang="ts">
import { ref, computed } from 'vue'
import { useFloorplanStore } from '@/stores/floorplan'
import { api } from '@/utils/api'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import type { FloorplanTemplate } from '@/assets/types/datatypes'

const store = useFloorplanStore()

// ── User ────────────────────────────────────────────────────
interface StoredUser {
  id: string
  email: string
}

const currentUser = computed<StoredUser | null>(() => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null')
  } catch {
    return null
  }
})

// ── Panel state ─────────────────────────────────────────────
const saveDialog = ref(false)
const loadDialog = ref(false)
const confirmOpen = ref(false)
const templateName = ref('')
const templates = ref<FloorplanTemplate[]>([])
const loading = ref(false)
const saving = ref(false)
const saveError = ref('')
const loadError = ref('')
const feedback = ref('')
const feedbackType = ref<'success' | 'error'>('success')
const selectedTemplate = ref<FloorplanTemplate | null>(null)

function showFeedback(msg: string, type: 'success' | 'error') {
  feedback.value = msg
  feedbackType.value = type
  setTimeout(() => {
    if (feedback.value === msg) feedback.value = ''
  }, 4000)
}

// ── Save template ───────────────────────────────────────────
async function saveTemplate() {
  if (!templateName.value.trim()) {
    saveError.value = 'Enter a template name.'
    return
  }
  saveError.value = ''
  saving.value = true
  try {
    await api.post('/floorplans/templates', {
      name: templateName.value.trim(),
      tableTypes: store.tableTypes,
      aisles: {
        wallBufferMm: 1500,
        tableSpacingMm: 1200,
        walkwayWidthMm: 2000,
      },
    })
    showFeedback(`Template &ldquo;${templateName.value.trim()}&rdquo; saved.`, 'success')
    templateName.value = ''
    saveDialog.value = false
  } catch (e: any) {
    saveError.value = e.response?.data?.error || 'Failed to save template.'
  } finally {
    saving.value = false
  }
}

// ── Load templates ──────────────────────────────────────────
async function fetchTemplates() {
  loading.value = true
  loadError.value = ''
  try {
    const uid = currentUser.value?.id
    const params: Record<string, string> = {}
    if (uid) params.userId = uid
    const { data } = await api.get('/floorplans/templates', { params })
    templates.value = data.templates ?? data ?? []
  } catch (e: any) {
    loadError.value = e.response?.data?.error || 'Failed to load templates.'
    templates.value = []
  } finally {
    loading.value = false
  }
}

function openLoadDialog() {
  loadDialog.value = true
  confirmOpen.value = false
  selectedTemplate.value = null
  loadError.value = ''
  fetchTemplates()
}

function selectTemplate(tpl: FloorplanTemplate) {
  selectedTemplate.value = tpl
  confirmOpen.value = true
}

function confirmLoad() {
  if (!selectedTemplate.value) return
  store.tableTypes = selectedTemplate.value.tableTypes.map((tt) => ({ ...tt }))
  showFeedback(`Template &ldquo;${selectedTemplate.value.name}&rdquo; loaded.`, 'success')
  confirmOpen.value = false
  loadDialog.value = false
  selectedTemplate.value = null
}

function cancelConfirm() {
  selectedTemplate.value = null
  confirmOpen.value = false
}

function closeSaveDialog() {
  saveDialog.value = false
  saveError.value = ''
  templateName.value = ''
}

function closeLoadDialog() {
  loadDialog.value = false
  loadError.value = ''
  confirmOpen.value = false
  selectedTemplate.value = null
}

// ── Date formatting ─────────────────────────────────────────
function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
</script>

<template>
  <div class="template-panel">
    <!-- Feedback toast -->
    <Transition name="feedback">
      <div
        v-if="feedback"
        class="feedback-toast"
        :class="`feedback-toast--${feedbackType}`"
        role="status"
      >
        {{ feedback }}
      </div>
    </Transition>

    <!-- Action buttons -->
    <div class="template-actions">
      <button
        class="tp-btn tp-btn--save"
        :disabled="store.tableTypes.length === 0"
        title="Save current table types as a reusable template"
        @click="saveDialog = true"
      >
        Save as Template
      </button>
      <button
        class="tp-btn tp-btn--load"
        title="Load a saved template"
        @click="openLoadDialog"
      >
        Load Template
      </button>
    </div>

    <!-- ── Save Dialog ─────────────────────────────────────── -->
    <Dialog
      v-model:visible="saveDialog"
      header="Save Template"
      :modal="true"
      :closable="!saving"
      :style="{ width: '420px' }"
      class="tp-dialog"
      @hide="closeSaveDialog"
    >
      <div class="tp-dialog-body">
        <p class="tp-dialog-desc">
          Save the current <strong>{{ store.tableTypes.length }}</strong>
          table type{{ store.tableTypes.length === 1 ? '' : 's' }} as a reusable template.
        </p>

        <div class="tp-field">
          <label class="tp-label" for="template-name">Template name</label>
          <InputText
            id="template-name"
            v-model="templateName"
            class="tp-input"
            placeholder="e.g. Standard Layout"
            :maxlength="100"
            :disabled="saving"
            @keydown.enter="saveTemplate"
          />
        </div>

        <p v-if="saveError" class="tp-error">{{ saveError }}</p>

        <div class="tp-dialog-actions">
          <button
            class="tp-btn tp-btn--secondary"
            :disabled="saving"
            @click="saveDialog = false"
          >
            Cancel
          </button>
          <button
            class="tp-btn tp-btn--primary"
            :disabled="saving || !templateName.trim()"
            @click="saveTemplate"
          >
            <span v-if="saving" class="tp-spinner" />
            {{ saving ? 'Saving&hellip;' : 'Save' }}
          </button>
        </div>
      </div>
    </Dialog>

    <!-- ── Load Dialog ─────────────────────────────────────── -->
    <Dialog
      v-model:visible="loadDialog"
      :header="confirmOpen ? 'Confirm Load' : 'Load Template'"
      :modal="true"
      :style="{ width: '520px' }"
      class="tp-dialog"
      @hide="closeLoadDialog"
    >
      <div class="tp-dialog-body">
        <!-- Template list view -->
        <template v-if="!confirmOpen">
          <!-- Loading -->
          <div v-if="loading" class="tp-loading">
            <span class="tp-spinner-dark" />
            Loading templates&hellip;
          </div>

          <!-- Error -->
          <p v-else-if="loadError" class="tp-error">{{ loadError }}</p>

          <!-- Empty -->
          <p v-else-if="templates.length === 0" class="tp-empty">
            No templates saved yet.
          </p>

          <!-- Template list -->
          <div v-else class="tp-template-list">
            <button
              v-for="tpl in templates"
              :key="tpl.id"
              class="tp-template-card"
              @click="selectTemplate(tpl)"
            >
              <div class="tp-template-card-main">
                <span class="tp-template-name">{{ tpl.name }}</span>
                <span class="tp-template-meta">
                  {{ tpl.tableTypes.length }} table type{{ tpl.tableTypes.length === 1 ? '' : 's' }}
                  <span class="tp-template-sep">&middot;</span>
                  {{ formatDate(tpl.createdAt) }}
                </span>
              </div>
              <span class="tp-template-arrow">&rarr;</span>
            </button>
          </div>
        </template>

        <!-- Confirm replace view -->
        <template v-else>
          <p class="tp-confirm-text">
            Replace the current <strong>{{ store.tableTypes.length }}</strong>
            table type{{ store.tableTypes.length === 1 ? '' : 's' }} with
            <strong>{{ selectedTemplate?.tableTypes.length ?? 0 }}</strong>
            from &ldquo;<strong>{{ selectedTemplate?.name }}</strong>&rdquo;?
          </p>
          <p class="tp-confirm-warning">
            This will replace all existing table types. This action cannot be undone.
          </p>
          <div class="tp-dialog-actions">
            <button
              class="tp-btn tp-btn--secondary"
              @click="cancelConfirm"
            >
              Cancel
            </button>
            <button
              class="tp-btn tp-btn--danger"
              @click="confirmLoad"
            >
              Replace Table Types
            </button>
          </div>
        </template>
      </div>
    </Dialog>
  </div>
</template>

<style scoped>
/* ── Panel container ───────────────────────────────────────── */
.template-panel {
  position: relative;
}

/* ── Action buttons ────────────────────────────────────────── */
.template-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.tp-btn {
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

.tp-btn:hover:not(:disabled) {
  opacity: 0.88;
}

.tp-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tp-btn--save {
  background: var(--mm-green);
}

.tp-btn--load {
  background: var(--mm-black);
}

.tp-btn--primary {
  background: var(--mm-green);
}

.tp-btn--secondary {
  background: var(--mm-grey);
  color: var(--mm-black);
}

.tp-btn--danger {
  background: #c0392b;
}

.tp-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, #c0392b 85%, black);
}

/* ── Feedback toast ────────────────────────────────────────── */
.feedback-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3000;
  padding: 12px 24px;
  border-radius: 8px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  pointer-events: none;
  max-width: 90vw;
  text-align: center;
}

.feedback-toast--success {
  background: var(--mm-green);
  color: #ffffff;
}

.feedback-toast--error {
  background: #c0392b;
  color: #ffffff;
}

.feedback-enter-active,
.feedback-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

.feedback-enter-from,
.feedback-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}

/* ── PrimeVue Dialog overrides ─────────────────────────────── */
:deep(.tp-dialog.p-dialog) {
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(39, 35, 35, 0.18);
}

:deep(.tp-dialog .p-dialog-header) {
  background: var(--mm-black);
  color: #ffffff;
  padding: 10px 16px;
  min-height: 52px;
  border-bottom: none;
  border-radius: 0;
}

:deep(.tp-dialog .p-dialog-title) {
  font-family: 'Merge One', sans-serif;
  font-size: 20px;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: #ffffff;
}

:deep(.tp-dialog .p-dialog-header-actions) {
  display: flex;
  align-items: center;
}

:deep(.tp-dialog .p-dialog-close-button) {
  color: #ffffff;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  transition: background-color 0.15s ease;
}

:deep(.tp-dialog .p-dialog-close-button:hover) {
  background: rgba(255, 255, 255, 0.12);
}

:deep(.tp-dialog .p-dialog-content) {
  padding: 20px;
  background: #ffffff;
  border-radius: 0;
}

/* ── Dialog body ───────────────────────────────────────────── */
.tp-dialog-body {
  display: flex;
  flex-direction: column;
}

.tp-dialog-desc {
  margin: 0 0 16px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-black);
  line-height: 1.5;
}

/* ── Form field ────────────────────────────────────────────── */
.tp-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}

.tp-label {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--mm-black);
}

:deep(.tp-input.p-inputtext) {
  width: 100%;
  padding: 10px 14px;
  border: 1.5px solid var(--mm-grey);
  border-radius: 8px;
  background: var(--mm-beige);
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-black);
  box-shadow: none;
  transition: border-color 0.15s ease-in-out;
}

:deep(.tp-input.p-inputtext:enabled:focus) {
  border-color: var(--mm-green);
  background: #ffffff;
  box-shadow: none;
}

:deep(.tp-input.p-inputtext:disabled) {
  opacity: 0.5;
  cursor: not-allowed;
}

:deep(.tp-input.p-inputtext::placeholder) {
  color: rgba(39, 35, 35, 0.4);
}

/* ── Dialog actions row ────────────────────────────────────── */
.tp-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

/* ── Error / empty / loading ───────────────────────────────── */
.tp-error {
  margin: 0 0 12px;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--mm-yellow) 18%, transparent);
  border: 1px solid var(--mm-yellow);
  border-radius: 8px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: var(--mm-black);
}

.tp-empty {
  margin: 0;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-grey);
  text-align: center;
  padding: 24px 0;
}

.tp-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 0;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-black);
}

/* ── Spinners ──────────────────────────────────────────────── */
.tp-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: tp-spin 0.7s linear infinite;
}

.tp-spinner-dark {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--mm-beige);
  border-top-color: var(--mm-green);
  border-radius: 50%;
  animation: tp-spin 0.7s linear infinite;
}

@keyframes tp-spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Template list ─────────────────────────────────────────── */
.tp-template-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tp-template-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  background: var(--mm-beige);
  border: 1.5px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;

  transition:
    border-color 0.15s ease-in-out,
    background-color 0.15s ease-in-out,
    box-shadow 0.15s ease-in-out;
}

.tp-template-card:hover {
  border-color: var(--mm-green);
  background: #ffffff;
  box-shadow: 0 2px 12px rgba(73, 176, 150, 0.12);
}

.tp-template-card:focus-visible {
  outline: 2px solid var(--mm-green);
  outline-offset: 2px;
}

.tp-template-card-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.tp-template-name {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 15px;
  font-weight: 500;
  color: var(--mm-black);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tp-template-meta {
  font-family: 'Outfit Regular', sans-serif;
  font-size: 12px;
  color: rgba(39, 35, 35, 0.55);
}

.tp-template-sep {
  margin: 0 4px;
  color: rgba(39, 35, 35, 0.3);
}

.tp-template-arrow {
  flex-shrink: 0;
  font-size: 18px;
  color: var(--mm-grey);
  transition: color 0.15s ease-in-out, transform 0.15s ease-in-out;
}

.tp-template-card:hover .tp-template-arrow {
  color: var(--mm-green);
  transform: translateX(3px);
}

/* ── Confirm view ──────────────────────────────────────────── */
.tp-confirm-text {
  margin: 0 0 10px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 14px;
  color: var(--mm-black);
  line-height: 1.55;
}

.tp-confirm-warning {
  margin: 0 0 4px;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--mm-yellow) 15%, transparent);
  border: 1px solid var(--mm-yellow);
  border-radius: 8px;
  font-family: 'Outfit Regular', sans-serif;
  font-size: 13px;
  color: var(--mm-black);
}
</style>
