<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApplicationStore } from '@/stores/application'
import { fetchPublicApplicationForm } from '@/utils/publicApplicationForm'
import type { Application } from '@/assets/types/datatypes'
import { ApplicationStatus } from '@/assets/types/datatypes'

const route = useRoute()
const router = useRouter()
const store = useApplicationStore()

const marketSlug = computed(() => (route.params.marketSlug as string) || '')
const marketName = ref('')
const loading = ref(true)
const application = ref<Application | null>(null)

const statusLabels: Record<string, string> = {
  open: 'Submitted',
  under_review: 'Under Review',
  reviewer_approved: 'Approved',
  reviewer_rejected: 'Not Accepted',
  unassigned: 'Pending',
  assigned: 'Assigned',
  assignment_sent: 'Assignment Sent',
  vendor_accepted: 'Accepted',
  vendor_refused: 'Not Accepted',
  cancelled: 'Cancelled',
}

const statusBadgeClass = computed(() => {
  if (!application.value) return 'status-neutral'
  const s = application.value.status
  if (s === ApplicationStatus.ReviewerApproved || s === ApplicationStatus.VendorAccepted) return 'status-approved'
  if (s === ApplicationStatus.ReviewerRejected || s === ApplicationStatus.VendorRefused) return 'status-rejected'
  if (s === ApplicationStatus.UnderReview) return 'status-review'
  return 'status-neutral'
})

onMounted(async () => {
  if (!store.isAuthenticatedFor(marketSlug.value)) {
    router.push({
      name: 'applicant-login',
      params: { marketSlug: marketSlug.value },
    })
    return
  }

  loading.value = true
  const form = await fetchPublicApplicationForm(marketSlug.value)
  marketName.value = form.marketName

  const app = await store.fetchApplication()
  if (app) {
    application.value = app
  }
  loading.value = false
})

function logout() {
  store.logout()
  router.push({
    name: 'apply',
    params: { marketSlug: marketSlug.value },
  })
}
</script>

<template>
  <div class="dashboard-page" data-testid="applicant-dashboard-page">
    <header class="dash-header">
      <h1>Your Application</h1>
    </header>

    <p class="dash-market" data-testid="applicant-dashboard-market">
      {{ marketName || marketSlug }}
    </p>

    <p class="dash-email" data-testid="applicant-dashboard-email">
      Signed in as <strong>{{ store.applicantEmail }}</strong>
    </p>

    <div v-if="loading" class="dash-loading" data-testid="applicant-dashboard-loading">
      Loading...
    </div>

    <template v-else-if="application">
      <div class="dash-status-card" :class="statusBadgeClass" data-testid="applicant-dashboard-status">
        <span class="status-label">
          {{ statusLabels[application.status] ?? application.status }}
        </span>
        <span v-if="application.submittedAt" class="status-date">
          Submitted {{ new Date(application.submittedAt).toLocaleDateString() }}
        </span>
      </div>

      <div class="dash-form-answers" data-testid="applicant-dashboard-answers">
        <h3>Your Answers</h3>
        <div v-if="Object.keys(application.formData).length === 0" class="dash-no-answers">
          No answers submitted yet.
        </div>
        <dl v-else class="answers-list">
          <div
            v-for="(value, key) in application.formData"
            :key="key"
            class="answer-row"
          >
            <dt>{{ key }}</dt>
            <dd>{{ Array.isArray(value) ? value.join(', ') : String(value ?? '') }}</dd>
          </div>
        </dl>
      </div>
    </template>

    <template v-else>
      <div class="dash-info" data-testid="applicant-dashboard-info">
        <p>
          You are signed in to view your application for this market. Your application status and
          form will appear here once the market organizer opens applications.
        </p>
      </div>
    </template>

    <div class="dash-actions">
      <button
        class="dash-btn dash-btn-secondary"
        @click="logout"
        data-testid="applicant-dashboard-logout-btn"
      >
        Sign Out
      </button>
    </div>
  </div>
</template>

<style scoped>
.dashboard-page {
  max-width: 640px;
  margin: 40px auto;
  padding: 0 16px;
}

.dash-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.dash-header h1 {
  font-family: 'Merge One';
  font-size: 24px;
  color: var(--mm-black);
  margin: 0;
}

.dash-market {
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-grey, #666);
  margin: 0 0 8px;
}

.dash-email {
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-black);
  margin: 0 0 24px;
}

.dash-loading {
  text-align: center;
  padding: 40px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-grey, #999);
}

.dash-info {
  background: #e7f1ff;
  border: 1px solid #86b7fe;
  border-radius: 6px;
  padding: 16px;
  font-family: 'Outfit Regular';
  font-size: 14px;
  line-height: 1.5;
  color: #084298;
}

.dash-status-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 24px;
  font-family: 'Outfit Regular';
}

.dash-status-card.status-neutral {
  background: #e3f2fd;
  border: 1px solid #90caf9;
  color: #1565c0;
}

.dash-status-card.status-approved {
  background: #e8f5e9;
  border: 1px solid #81c784;
  color: #2e7d32;
}

.dash-status-card.status-rejected {
  background: #ffebee;
  border: 1px solid #ef9a9a;
  color: #c62828;
}

.dash-status-card.status-review {
  background: #fff3e0;
  border: 1px solid #ffb74d;
  color: #e65100;
}

.status-label {
  font-size: 18px;
  font-weight: 600;
  font-family: 'Merge One';
}

.status-date {
  font-size: 13px;
  opacity: 0.8;
}

.dash-form-answers h3 {
  font-family: 'Outfit Regular';
  font-size: 16px;
  color: var(--mm-black);
  margin: 0 0 12px;
}

.answers-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
}

.answer-row {
  padding: 10px 14px;
  border: 1px solid var(--mm-grey, #ddd);
  border-radius: 6px;
  background: #fafafa;
}

.answer-row dt {
  font-family: 'Outfit Regular';
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--mm-grey, #999);
  margin-bottom: 2px;
}

.answer-row dd {
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-black);
  margin: 0;
}

.dash-no-answers {
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-grey, #999);
  padding: 20px;
  text-align: center;
}

.dash-actions {
  display: flex;
  flex-direction: row;
  gap: 12px;
  margin-top: 24px;
}

.dash-btn {
  padding: 10px 20px;
  border-radius: 5px;
  cursor: pointer;
  font-family: 'Merge One';
  font-size: 14px;
  border: none;
}

.dash-btn-secondary {
  background: transparent;
  color: var(--mm-grey, #666);
  border: 1px solid var(--mm-grey, #ccc);
}
</style>
