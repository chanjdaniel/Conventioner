<script setup lang="ts">
/**
 * The application form, opened in place on the vendor page (ADR 0022): "Apply" for a vendor who
 * has not applied, "Edit" for one who has, while the market takes applications.
 *
 * It opens on what the vendor already answered (bug 21): the page reads their application and the
 * form's questions together before it draws, so the form's own defaults - a ranking seeded in the
 * plan's order - fill only what they never answered. A save the server refuses says why here and
 * keeps every answer typed; a save it takes is the vendor's application, and the section closes
 * the form on it.
 *
 * Every answer typed is kept in this tab as it changes, while the answers differ from what the
 * form opened on (T271), so a reload, or a phone discarding the tab, reopens it on them, saying
 * they are back and not yet sent. A save the server takes and Cancel drop them.
 */
import { computed, onMounted, ref, watch } from 'vue';
import type { FormField } from '@/assets/types/datatypes';
import ApplicationFormFields from '@/components/application/ApplicationFormFields.vue';
import EssentialApplicationFields from '@/components/application/EssentialApplicationFields.vue';
import { formValidationErrors, sortedFormFields } from '@/utils/applicationForm';
import { essentialValidationErrors, planDerivedAskedKeys } from '@/utils/essentialFields';
import { useApplicationStore } from '@/stores/application';

const emit = defineEmits<{ saved: []; cancel: [] }>();

const store = useApplicationStore();

const formData = ref<Record<string, unknown>>({ ...(store.application?.formData ?? {}) });
const validationErrors = ref<Record<string, string>>({});
const saving = ref(false);
const applied = computed(() => store.application !== null);

/** The answers this vendor kept in the tab and has not saved, which the form opens on. */
function ownDraft() {
  return store.marketSlug ? store.draftFor(store.marketSlug, store.applicantEmail) : null;
}
const restored = ownDraft();
/** Opened on kept answers: the note above the first question says so, while the form is open. */
const draftRestored = restored !== null;

/**
 * The answers compared as answers: in any key order, and an empty one the same as none, so that
 * a name typed and cleared again reads as the answers the form opened on.
 */
function answersKey(data: Record<string, unknown>): string {
  const isEmpty = (value: unknown) =>
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);
  const kept = Object.keys(data)
    .filter((key) => !isEmpty(data[key]))
    .sort()
    .map((key) => [key, data[key]]);
  return JSON.stringify(kept);
}

/**
 * What the form opened on: the application's answers with the form's own defaults, which the
 * essential questions seed as they set up. Taken once the form is mounted, after that seed; kept
 * answers are put in only then, so they are compared with the application's, not with themselves.
 */
let opened: string | null = null;

/** Apply or Edit, the button pressed, is gone with the form open: focus lands on its heading. */
const heading = ref<HTMLElement | null>(null);
onMounted(() => {
  opened = answersKey(formData.value);
  if (restored) formData.value = { ...formData.value, ...restored.formData };
  heading.value?.focus();
});

/** Keep the answers in the tab while they differ from what the form opened on, and not after. */
watch(
  formData,
  (now) => {
    if (opened === null) return;
    const key = answersKey(now);
    const held = ownDraft();
    if (key === opened) {
      if (held) store.dropDraft();
    } else if (!held || answersKey(held.formData) !== key) {
      store.holdDraft(now);
    }
  },
  { deep: true },
);

const sortedFields = computed(() => sortedFormFields(store.formFields));
/**
 * Whether the form asks the vendor anything: its own questions, or the essential ones the plan
 * offers. A market asking the essential questions alone is the ordinary case (E03/F01/S01).
 */
const asksSomething = computed(
  () => sortedFields.value.length > 0 || planDerivedAskedKeys(store.essentialOptions).length > 0,
);

function validateAll(): boolean {
  validationErrors.value = {
    ...essentialValidationErrors(store.essentialOptions, formData.value),
    ...formValidationErrors(sortedFields.value, formData.value),
  };
  return Object.keys(validationErrors.value).length === 0;
}

function clearFieldError(field: FormField) {
  clearErrorFor(field.key);
}

function clearErrorFor(key: string) {
  if (validationErrors.value[key]) {
    validationErrors.value = { ...validationErrors.value, [key]: '' };
  }
}

async function submitForm() {
  if (!validateAll()) return;

  saving.value = true;
  const app = await store.saveApplication(formData.value);
  saving.value = false;

  if (app) {
    if (ownDraft()) store.dropDraft();
    emit('saved');
  }
}

function cancel() {
  store.error = null;
  if (ownDraft()) store.dropDraft();
  emit('cancel');
}
</script>

<template>
  <div class="vendor-form" data-testid="vendor-page-form">
    <h2 ref="heading" tabindex="-1">{{ applied ? 'Edit your answers' : 'Apply' }}</h2>

    <template v-if="!asksSomething">
      <p class="vendor-form-none" data-testid="apply-no-form">
        This market does not have an application form yet.
      </p>
      <div class="vendor-form-actions">
        <button
          type="button"
          class="btn btn--secondary"
          data-testid="apply-cancel-button"
          @click="cancel"
        >
          Back
        </button>
      </div>
    </template>

    <form v-else class="vendor-form-body" data-testid="apply-form" @submit.prevent="submitForm">
      <p v-if="draftRestored" class="vendor-form-restored" data-testid="apply-draft-restored">
        Your unsaved answers are back. They reach the market when you save.
      </p>

      <EssentialApplicationFields
        v-model="formData"
        :options="store.essentialOptions"
        :errors="validationErrors"
        :email="store.applicantEmail"
        prefix="apply"
        @field-change="clearErrorFor"
      />

      <div v-if="sortedFields.length" class="vendor-form-divider">More questions</div>

      <ApplicationFormFields
        v-model="formData"
        :fields="sortedFields"
        :errors="validationErrors"
        prefix="apply"
        @field-change="clearFieldError"
      />

      <div v-if="store.error" class="vendor-form-error" role="alert" data-testid="apply-error">
        {{ store.error }}
      </div>

      <div class="vendor-form-actions">
        <button
          type="submit"
          class="btn btn--primary"
          :disabled="saving"
          data-testid="apply-submit-button"
        >
          {{ saving ? 'Saving…' : 'Save application' }}
        </button>
        <button
          type="button"
          class="btn btn--secondary"
          :disabled="saving"
          data-testid="apply-cancel-button"
          @click="cancel"
        >
          Cancel
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.vendor-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.vendor-form h2 {
  font-size: var(--text-md);
  color: var(--mm-black);
  margin: 0;
}

/* Focused by script, as a place to start from, never as a control to press. */
.vendor-form h2:focus {
  outline: none;
}

.vendor-form-none {
  margin: 0;
  text-align: center;
  padding: var(--space-6);
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.vendor-form-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.vendor-form-divider {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--mm-text-muted);
  border-bottom: 1px solid var(--mm-border);
  padding-bottom: var(--space-1);
  margin-top: var(--space-2);
}

.vendor-form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* The page's informational note, as "You have not applied" reads (`vendor-info`). */
.vendor-form-restored {
  margin: 0;
  background: var(--mm-chip-informational);
  border: 1px solid var(--mm-blue);
  border-radius: var(--radius-control);
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--mm-blue);
}

.vendor-form-error {
  background: var(--mm-chip-destructive);
  border: 1px solid var(--mm-red);
  border-radius: var(--radius-control);
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-sm);
  color: var(--mm-text-red-on-tint);
}
</style>
