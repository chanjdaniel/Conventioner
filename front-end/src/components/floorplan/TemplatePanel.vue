<script setup lang="ts">
import { ref, computed } from 'vue';
import { useFloorplanStore } from '@/stores/floorplan';
import { api } from '@/utils/api';
import AppDialog from '@/components/AppDialog.vue';
import type { FloorplanTemplate } from '@/assets/types/datatypes';
import { getTimestampDate } from '@/utils/utils';

const store = useFloorplanStore();

// ── User ────────────────────────────────────────────────────
interface StoredUser {
  id: string;
  email: string;
}

const currentUser = computed<StoredUser | null>(() => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
});

// ── Panel state ─────────────────────────────────────────────
const saveDialog = ref(false);
const loadDialog = ref(false);
const confirmOpen = ref(false);
const templateName = ref('');
const templates = ref<FloorplanTemplate[]>([]);
const loading = ref(false);
const saving = ref(false);
const saveError = ref('');
const loadError = ref('');
const feedback = ref('');
const feedbackType = ref<'success' | 'error'>('success');
const selectedTemplate = ref<FloorplanTemplate | null>(null);

function showFeedback(msg: string, type: 'success' | 'error') {
  feedback.value = msg;
  feedbackType.value = type;
  setTimeout(() => {
    if (feedback.value === msg) feedback.value = '';
  }, 4000);
}

// ── Save template ───────────────────────────────────────────
async function saveTemplate() {
  if (!templateName.value.trim()) {
    saveError.value = 'Enter a template name.';
    return;
  }
  saveError.value = '';
  saving.value = true;
  try {
    await api.post('/floorplans/templates', {
      name: templateName.value.trim(),
      tableTypes: store.tableTypes,
      aisles: {
        wallBufferMm: 1500,
        tableSpacingMm: 1200,
        walkwayWidthMm: 2000,
      },
    });
    showFeedback(`Template “${templateName.value.trim()}” saved.`, 'success');
    templateName.value = '';
    saveDialog.value = false;
  } catch (_e: unknown) {
    const e = _e as { response?: { data?: { error?: string } }; message?: string };
    saveError.value = e.response?.data?.error || 'Failed to save template.';
  } finally {
    saving.value = false;
  }
}

// ── Load templates ──────────────────────────────────────────
async function fetchTemplates() {
  loading.value = true;
  loadError.value = '';
  try {
    const uid = currentUser.value?.id;
    const params: Record<string, string> = {};
    if (uid) params.userId = uid;
    const { data } = await api.get('/floorplans/templates', { params });
    templates.value = data.templates ?? data ?? [];
  } catch (_e: unknown) {
    const e = _e as { response?: { data?: { error?: string } }; message?: string };
    loadError.value = e.response?.data?.error || 'Failed to load templates.';
    templates.value = [];
  } finally {
    loading.value = false;
  }
}

function openLoadDialog() {
  loadDialog.value = true;
  confirmOpen.value = false;
  selectedTemplate.value = null;
  loadError.value = '';
  fetchTemplates();
}

function selectTemplate(tpl: FloorplanTemplate) {
  selectedTemplate.value = tpl;
  confirmOpen.value = true;
}

function confirmLoad() {
  if (!selectedTemplate.value) return;
  store.tableTypes = selectedTemplate.value.tableTypes.map((tt) => ({ ...tt }));
  showFeedback(`Template “${selectedTemplate.value.name}” loaded.`, 'success');
  confirmOpen.value = false;
  loadDialog.value = false;
  selectedTemplate.value = null;
}

function cancelConfirm() {
  selectedTemplate.value = null;
  confirmOpen.value = false;
}

function closeSaveDialog() {
  // A save in flight finishes before the dialog can go.
  if (saving.value) return;
  saveDialog.value = false;
  saveError.value = '';
  templateName.value = '';
}

function closeLoadDialog() {
  loadDialog.value = false;
  loadError.value = '';
  confirmOpen.value = false;
  selectedTemplate.value = null;
}

// ── Date formatting ─────────────────────────────────────────
function formatDate(dateStr: string): string {
  return getTimestampDate(dateStr);
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
      <button class="tp-btn tp-btn--load" title="Load a saved template" @click="openLoadDialog">
        Load Template
      </button>
    </div>

    <!-- ── Save Dialog ─────────────────────────────────────── -->
    <AppDialog
      :open="saveDialog"
      title="Save Template"
      testid="floorplan-template-save"
      :confirm-label="saving ? 'Saving…' : 'Save'"
      :confirm-disabled="saving || !templateName.trim()"
      :error="saveError"
      @submit="saveTemplate"
      @close="closeSaveDialog"
    >
      <p class="tp-dialog-desc">
        Save the current <strong>{{ store.tableTypes.length }}</strong> table type{{
          store.tableTypes.length === 1 ? '' : 's'
        }}
        as a reusable template.
      </p>

      <div>
        <label class="field-label" for="template-name">Template name</label>
        <input
          id="template-name"
          v-model="templateName"
          type="text"
          class="field"
          placeholder="e.g. Standard Layout"
          maxlength="100"
          :disabled="saving"
        />
      </div>
    </AppDialog>

    <!-- ── Load Dialog ─────────────────────────────────────── -->
    <AppDialog
      :open="loadDialog"
      :title="confirmOpen ? 'Confirm Load' : 'Load Template'"
      testid="floorplan-template-load"
      wide
      :error="loadError"
      @close="closeLoadDialog"
    >
      <!-- Template list view -->
      <template v-if="!confirmOpen">
        <!-- Loading -->
        <div v-if="loading" class="tp-loading">
          <span class="tp-spinner" />
          Loading templates&hellip;
        </div>

        <!-- Empty -->
        <p v-else-if="!loadError && templates.length === 0" class="tp-empty">
          No templates saved yet.
        </p>

        <!-- Template list -->
        <div v-else-if="!loadError" class="tp-template-list">
          <button
            v-for="tpl in templates"
            :key="tpl.id"
            type="button"
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
          Replace the current <strong>{{ store.tableTypes.length }}</strong> table type{{
            store.tableTypes.length === 1 ? '' : 's'
          }}
          with
          <strong>{{ selectedTemplate?.tableTypes.length ?? 0 }}</strong>
          from &ldquo;<strong>{{ selectedTemplate?.name }}</strong
          >&rdquo;?
        </p>
        <p class="tp-confirm-warning">
          This will replace all existing table types. This action cannot be undone.
        </p>
        <div class="tp-dialog-actions">
          <button type="button" class="btn btn--secondary" @click="cancelConfirm">Cancel</button>
          <button type="button" class="btn btn--destructive" @click="confirmLoad">
            Replace Table Types
          </button>
        </div>
      </template>
    </AppDialog>
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

/* ── Feedback toast ────────────────────────────────────────── */
.feedback-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3000;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: var(--text-sm);
  box-shadow: var(--shadow-card);
  pointer-events: none;
  max-width: 90vw;
  text-align: center;
}

.feedback-toast--success {
  background: var(--mm-green);
  color: #ffffff;
}

.feedback-toast--error {
  background: var(--mm-red);
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

/* ── Dialog body ───────────────────────────────────────────── */
/* The dialog spaces its body; these carry no margins of their own. */
.tp-dialog-desc {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  line-height: 1.5;
}

.tp-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

/* ── Empty / loading ───────────────────────────────────────── */
.tp-empty {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  text-align: center;
  padding: 24px 0;
}

.tp-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

/* ── Spinner ───────────────────────────────────────────────── */
.tp-spinner {
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
  box-shadow: 0 2px 12px rgba(54, 130, 111, 0.12);
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
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--mm-black);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tp-template-meta {
  font-size: var(--text-xs);
  color: rgba(39, 35, 35, 0.55);
}

.tp-template-sep {
  margin: 0 4px;
  color: rgba(39, 35, 35, 0.3);
}

.tp-template-arrow {
  flex-shrink: 0;
  font-size: var(--text-lg);
  color: var(--mm-text-muted);
  transition:
    color 0.15s ease-in-out,
    transform 0.15s ease-in-out;
}

.tp-template-card:hover .tp-template-arrow {
  color: var(--mm-green);
  transform: translateX(3px);
}

/* ── Confirm view ──────────────────────────────────────────── */
.tp-confirm-text {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
  line-height: 1.55;
}

.tp-confirm-warning {
  margin: 0;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--mm-yellow) 15%, transparent);
  border: 1px solid var(--mm-yellow);
  border-radius: 8px;
  font-size: var(--text-xs);
  color: var(--mm-black);
}
</style>
