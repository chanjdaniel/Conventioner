<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { EssentialFormOptions, FormField } from '@/assets/types/datatypes';
import ApplicationFormFields from '@/components/application/ApplicationFormFields.vue';
import EssentialApplicationFields from '@/components/application/EssentialApplicationFields.vue';
import { formValidationErrors, sortedFormFields } from '@/utils/applicationForm';
import { EMPTY_ESSENTIAL_OPTIONS, essentialValidationErrors } from '@/utils/essentialFields';
import { fetchPublicApplicationForm } from '@/utils/publicApplicationForm';
import { useApplicationStore } from '@/stores/application';

const route = useRoute();
const router = useRouter();
const store = useApplicationStore();

const marketSlug = computed(() => (route.params.marketSlug as string) || '');

const fields = ref<FormField[]>([]);
const essentialOptions = ref<EssentialFormOptions>(EMPTY_ESSENTIAL_OPTIONS);
const marketName = ref('');
const phaseLabel = ref('');
const isOpen = ref(false);
const loading = ref(true);
/** The public form request did not answer. Distinct from a market that is not open. */
const loadFailed = ref(false);
const formData = ref<Record<string, unknown>>({});
const validationErrors = ref<Record<string, string>>({});
const saving = ref(false);

const sortedFields = computed(() => sortedFormFields(fields.value));
const signedIn = computed(() => store.isAuthenticatedFor(marketSlug.value));

function toSignIn() {
  router.push({
    name: 'applicant-login',
    params: { marketSlug: marketSlug.value },
    query: { redirect: 'apply' },
  });
}

/**
 * The form, and what this vendor already answered on it (bug 21).
 *
 * It started from an empty object and never loaded the stored application, so a returning vendor
 * had to answer every required question again, and "Not available" came pre-ticked on days they
 * had answered. Both arrive before the form is drawn, so the form's own defaults - a ranking seeded
 * in the plan's order - fill only what the vendor never answered, and never race their answers.
 */
async function loadForm() {
  loading.value = true;
  const [form, saved] = await Promise.all([
    fetchPublicApplicationForm(marketSlug.value),
    store.fetchApplication(),
  ]);
  // The sign-in expired: the store has said so and cleared it.
  if (!signedIn.value) {
    toSignIn();
    return;
  }
  // Either read failing is a page that did not load: an empty form over answers the vendor saved
  // would be filled in again, and saved over them.
  loadFailed.value = form.failed || saved.failed;
  fields.value = form.fields;
  essentialOptions.value = form.essentialOptions;
  marketName.value = form.marketName;
  phaseLabel.value = form.phaseLabel;
  isOpen.value = form.isOpen;
  formData.value = { ...(saved.application?.formData ?? {}) };
  loading.value = false;
}

onMounted(async () => {
  if (!signedIn.value) {
    toSignIn();
    return;
  }

  await loadForm();
});

function validateAll(): boolean {
  validationErrors.value = {
    ...essentialValidationErrors(essentialOptions.value, formData.value),
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
  store.error = null;
  const app = await store.saveApplication(formData.value);
  saving.value = false;

  if (app) {
    router.push({
      name: 'applicant-dashboard',
      params: { marketSlug: marketSlug.value },
    });
  }
}
</script>

<template>
  <div class="apply-page" data-testid="apply-page">
    <div v-if="loading" class="apply-loading" data-testid="apply-loading">
      Loading application form...
    </div>

    <!-- The request did not answer. Saying "closed" here would blame the market for our silence. -->
    <div v-else-if="loadFailed" class="apply-load-failed" data-testid="apply-load-failed">
      <p>
        This market's application form could not be loaded. Check your connection and try again.
      </p>
      <button
        type="button"
        class="btn btn--secondary"
        data-testid="apply-retry-button"
        @click="loadForm"
      >
        Try again
      </button>
    </div>

    <template v-else>
      <header class="apply-header">
        <h1 data-testid="apply-market-name">Apply for {{ marketName || marketSlug }}</h1>
        <span
          class="chip"
          :class="isOpen ? 'chip--positive' : 'chip--neutral'"
          data-testid="apply-phase-badge"
        >
          {{ isOpen ? 'Applications open' : phaseLabel }}
        </span>
      </header>

      <div v-if="!isOpen" class="apply-closed" data-testid="apply-closed">
        <p>
          Applications are not currently open for this market. The market is in the
          <strong>{{ phaseLabel }}</strong> phase.
        </p>
      </div>

      <template v-else>
        <div v-if="!sortedFields.length" class="apply-no-form" data-testid="apply-no-form">
          <p>This market does not have an application form yet.</p>
        </div>

        <form v-else class="apply-form" @submit.prevent="submitForm" data-testid="apply-form">
          <EssentialApplicationFields
            v-model="formData"
            :options="essentialOptions"
            :errors="validationErrors"
            :email="store.applicantEmail"
            prefix="apply"
            @field-change="clearErrorFor"
          />

          <div class="apply-custom-divider" v-if="sortedFields.length">More questions</div>

          <ApplicationFormFields
            v-model="formData"
            :fields="sortedFields"
            :errors="validationErrors"
            prefix="apply"
            @field-change="clearFieldError"
          />

          <div class="apply-actions">
            <button
              type="submit"
              class="btn btn--primary"
              :disabled="!sortedFields.length || saving"
              data-testid="apply-submit-button"
            >
              {{ saving ? 'Saving…' : 'Save application' }}
            </button>
          </div>
          <div v-if="store.error" class="apply-error" data-testid="apply-error">
            {{ store.error }}
          </div>
        </form>
      </template>
    </template>
  </div>
</template>

<style scoped>
.apply-page {
  width: 100%;
  max-width: 640px;
  margin: 40px auto;
  padding: 0 16px;
}

.apply-load-failed {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 24px;
  font-size: var(--text-sm);
}

.apply-loading {
  text-align: center;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  padding: 40px;
}

.apply-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 8px;
}

.apply-header h1 {
  font-family: 'Merge One';
  font-size: var(--text-xl);
  color: var(--mm-black);
  margin: 0;
}

/* The attention tone, with the ink measured on it: `--mm-text-yellow` is 3.96 on this ground. */
.apply-closed {
  background: var(--mm-chip-attention);
  border: 1px solid var(--mm-yellow);
  border-radius: var(--radius-control);
  padding: 16px;
  margin-bottom: 24px;
  font-size: var(--text-sm);
  color: var(--mm-text-yellow-on-tint);
}

.apply-no-form {
  text-align: center;
  padding: 40px;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.apply-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.apply-custom-divider {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--mm-text-muted);
  border-bottom: 1px solid var(--mm-border);
  padding-bottom: 4px;
  margin-top: 8px;
}

.apply-actions {
  display: flex;
  gap: 12px;
  padding-top: 8px;
}

.apply-error {
  margin-top: 4px;
  background: var(--mm-chip-destructive);
  border: 1px solid var(--mm-red);
  border-radius: var(--radius-control);
  padding: 12px 16px;
  font-size: var(--text-sm);
  color: var(--mm-text-red-on-tint);
}
</style>
