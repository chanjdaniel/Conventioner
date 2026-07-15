<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { FormField } from '@/assets/types/datatypes'
import ApplicationFormFields from '@/components/application/ApplicationFormFields.vue'
import { formValidationErrors, sortedFormFields } from '@/utils/applicationForm'
import { fetchPublicApplicationForm } from '@/utils/publicApplicationForm'
import { useApplicationStore } from '@/stores/application'

const route = useRoute()
const router = useRouter()
const store = useApplicationStore()

const marketSlug = computed(() => (route.params.marketSlug as string) || '')

const fields = ref<FormField[]>([])
const marketName = ref('')
const phaseLabel = ref('')
const isOpen = ref(false)
const loading = ref(true)
const formData = ref<Record<string, unknown>>({})
const validationErrors = ref<Record<string, string>>({})

const sortedFields = computed(() => sortedFormFields(fields.value))
const signedIn = computed(() => store.isAuthenticatedFor(marketSlug.value))

onMounted(async () => {
  const form = await fetchPublicApplicationForm(marketSlug.value)
  fields.value = form.fields
  marketName.value = form.marketName
  phaseLabel.value = form.phaseLabel
  isOpen.value = form.isOpen
  loading.value = false
})

function validateAll(): boolean {
  validationErrors.value = formValidationErrors(sortedFields.value, formData.value)
  return Object.keys(validationErrors.value).length === 0
}

function clearFieldError(field: FormField) {
  if (validationErrors.value[field.key]) {
    validationErrors.value = { ...validationErrors.value, [field.key]: '' }
  }
}

const submitLabel = computed(() => {
  if (!signedIn.value) return 'Continue to sign in'
  return 'Save Application'
})

function submitForm() {
  if (!validateAll()) return

  if (!signedIn.value) {
    router.push({
      name: 'applicant-login',
      params: { marketSlug: marketSlug.value },
      query: { redirect: 'apply' },
    })
  }
}

function goToLogin() {
  router.push({
    name: 'applicant-login',
    params: { marketSlug: marketSlug.value },
    query: { redirect: 'dashboard' },
  })
}
</script>

<template>
  <div class="apply-page" data-testid="apply-page">
    <div v-if="loading" class="apply-loading" data-testid="apply-loading">
      Loading application form...
    </div>

    <template v-else>
      <header class="apply-header">
        <h1 data-testid="apply-market-name">Apply for {{ marketName || marketSlug }}</h1>
        <div class="phase-badge" :class="{ open: isOpen }" data-testid="apply-phase-badge">
          {{ isOpen ? 'Applications Open' : `Market Status: ${phaseLabel}` }}
        </div>
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
              class="apply-submit-btn"
              :disabled="!sortedFields.length"
              data-testid="apply-submit-button"
            >
              {{ submitLabel }}
            </button>
          </div>
        </form>
      </template>

      <div v-if="!signedIn" class="apply-returning" data-testid="apply-returning">
        Already applied?
        <a href="#" @click.prevent="goToLogin">Sign in to view your application</a>
      </div>
    </template>
  </div>
</template>

<style scoped>
.apply-page {
  max-width: 640px;
  margin: 40px auto;
  padding: 0 16px;
}

.apply-loading {
  text-align: center;
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-grey, #999);
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
  font-size: 24px;
  color: var(--mm-black);
  margin: 0;
}

.phase-badge {
  font-family: 'Outfit Regular';
  font-size: 12px;
  border-radius: 4px;
  padding: 4px 10px;
  background: #f0f0f0;
  color: var(--mm-grey, #666);
}

.phase-badge.open {
  background: var(--mm-green);
  color: white;
}

.apply-closed {
  background: #fff3cd;
  border: 1px solid #ffc107;
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 24px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: #664d03;
}

.apply-no-form {
  text-align: center;
  padding: 40px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-grey, #999);
}

.apply-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.apply-actions {
  display: flex;
  gap: 12px;
  padding-top: 8px;
}

.apply-submit-btn {
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: 5px;
  padding: 10px 24px;
  cursor: pointer;
  font-family: 'Merge One';
  font-size: 16px;
}

.apply-submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.apply-returning {
  margin-top: 24px;
  text-align: center;
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-grey, #666);
}

.apply-returning a {
  color: var(--mm-green);
  text-decoration: none;
}

.apply-returning a:hover {
  text-decoration: underline;
}
</style>
