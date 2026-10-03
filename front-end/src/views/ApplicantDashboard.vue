<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useApplicationStore } from '@/stores/application';
import { fetchPublicApplicationForm } from '@/utils/publicApplicationForm';
import type { Application, FormField } from '@/assets/types/datatypes';
import { ApplicationStatus } from '@/assets/types/datatypes';
import { applicationAnswerRows, type AnswerRow } from '@/utils/essentialFields';
import { getTimestampDate } from '@/utils/utils';
import AnswerValue from '@/components/AnswerValue.vue';

const route = useRoute();
const router = useRouter();
const store = useApplicationStore();

const marketSlug = computed(() => (route.params.marketSlug as string) || '');
const marketName = ref('');
const loading = ref(true);
const application = ref<Application | null>(null);
const formFields = ref<FormField[]>([]);
/** Whether the market is taking applications now - what a vendor with none can do about it. */
const isOpen = ref(false);
/** A read got no answer. Distinct from having no application, which it used to be reported as. */
const loadFailed = ref(false);

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
};

const statusBadgeClass = computed(() => {
  if (!application.value) return 'status-neutral';
  const s = application.value.status;
  if (s === ApplicationStatus.ReviewerApproved || s === ApplicationStatus.VendorAccepted)
    return 'status-approved';
  if (s === ApplicationStatus.ReviewerRejected || s === ApplicationStatus.VendorRefused)
    return 'status-rejected';
  if (s === ApplicationStatus.UnderReview) return 'status-review';
  return 'status-neutral';
});

onMounted(async () => {
  if (!store.isAuthenticatedFor(marketSlug.value)) {
    router.push({
      name: 'applicant-login',
      params: { marketSlug: marketSlug.value },
    });
    return;
  }

  await load();
});

/**
 * The market and the vendor's application, together. A read that gets no answer says so and offers
 * another try: reported as no application, it told a vendor who had applied that they had not.
 */
async function load() {
  loading.value = true;
  const [form, read] = await Promise.all([
    fetchPublicApplicationForm(marketSlug.value),
    store.fetchApplication(),
  ]);
  if (!store.isAuthenticatedFor(marketSlug.value)) {
    router.push({ name: 'applicant-login', params: { marketSlug: marketSlug.value } });
    return;
  }
  loadFailed.value = form.failed || read.failed;
  marketName.value = form.marketName;
  formFields.value = form.fields;
  isOpen.value = form.isOpen;
  application.value = read.application;
  loading.value = false;
}

/**
 * What the applicant answered, in the order the form asked: the essential questions first, then
 * the organizer's own. The rendering itself belongs to the essential-fields contract, which the
 * organizer's review card reads back through the same function.
 */
const answerRows = computed<AnswerRow[]>(() => {
  const { essential, custom } = applicationAnswerRows(
    application.value?.formData ?? {},
    formFields.value,
  );
  return [...essential, ...custom];
});

function logout() {
  store.logout();
  router.push({
    name: 'apply',
    params: { marketSlug: marketSlug.value },
  });
}
</script>

<template>
  <div class="dashboard-page" data-testid="applicant-dashboard-page">
    <header class="dash-header">
      <h1>Your application</h1>
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

    <div
      v-else-if="loadFailed"
      class="dash-load-failed"
      data-testid="applicant-dashboard-load-failed"
    >
      <p>Your application could not be loaded. Check your connection and try again.</p>
      <button
        type="button"
        class="btn btn--secondary"
        data-testid="applicant-dashboard-retry-button"
        @click="load"
      >
        Try again
      </button>
    </div>

    <template v-else-if="application">
      <div
        class="dash-status-card"
        :class="statusBadgeClass"
        data-testid="applicant-dashboard-status"
      >
        <span class="status-label">
          {{ statusLabels[application.status] ?? application.status }}
        </span>
        <span v-if="application.submittedAt" class="status-date">
          Submitted {{ getTimestampDate(application.submittedAt) }}
        </span>
      </div>

      <div class="dash-form-answers" data-testid="applicant-dashboard-answers">
        <h3>Your Answers</h3>
        <div v-if="answerRows.length === 0" class="dash-no-answers">No answers submitted yet.</div>
        <dl v-else class="answers-list">
          <div
            v-for="row in answerRows"
            :key="row.key"
            class="answer-row"
            :data-testid="`applicant-dashboard-answer-${row.key}`"
          >
            <dt>{{ row.label }}</dt>
            <dd><AnswerValue :value="row.value" /></dd>
          </div>
        </dl>
      </div>
    </template>

    <!-- Signed in, and not applied (E26/F07/S01): a vendor who has never applied can sign in
         now, so this says what is true for them rather than waiting on the organizer. -->
    <template v-else>
      <div class="dash-info" data-testid="applicant-dashboard-info">
        <template v-if="isOpen">
          <p>You have not applied to this market yet.</p>
          <RouterLink
            class="btn btn--primary"
            :to="{ name: 'apply', params: { marketSlug } }"
            data-testid="applicant-dashboard-apply-link"
          >
            Apply now
          </RouterLink>
        </template>
        <p v-else>You have no application at this market, and it is not taking applications.</p>
      </div>
    </template>

    <div class="dash-actions">
      <!-- The way back to the form while it can still change (bug 21): there was none, so a vendor
           who wanted to correct an answer had no route to it from here. -->
      <RouterLink
        v-if="application && isOpen"
        class="btn btn--primary"
        :to="{ name: 'apply', params: { marketSlug } }"
        data-testid="applicant-dashboard-edit-link"
      >
        Change your answers
      </RouterLink>
      <button
        type="button"
        class="btn btn--secondary"
        @click="logout"
        data-testid="applicant-dashboard-logout-btn"
      >
        Sign out
      </button>
    </div>
  </div>
</template>

<style scoped>
/* A column of its own width, not its content's: it shrank to the width of a one-line notice. */
.dashboard-page {
  width: 100%;
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
  font-size: var(--text-xl);
  color: var(--mm-black);
  margin: 0;
}

.dash-market {
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  margin: 0 0 8px;
}

.dash-email {
  font-size: var(--text-sm);
  color: var(--mm-black);
  margin: 0 0 24px;
}

.dash-loading {
  text-align: center;
  padding: 40px;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.dash-load-failed {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  font-size: var(--text-sm);
}

.dash-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  background: var(--mm-chip-informational);
  border: 1px solid var(--mm-blue);
  border-radius: var(--radius-control);
  padding: 16px;
  font-size: var(--text-sm);
  line-height: 1.5;
  color: var(--mm-blue);
}

.dash-info p {
  margin: 0;
}

.dash-status-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 20px;
  border-radius: var(--radius-card);
  margin-bottom: 24px;
}

/* A verdict in the chip tones, each ink measured on its own ground (`contrast.test.ts`). These
   were Material tints with an orange "in review" at 3.0:1 on its own fill. */
.dash-status-card.status-neutral {
  background: var(--mm-chip-informational);
  border: 1px solid var(--mm-blue);
  color: var(--mm-blue);
}

.dash-status-card.status-approved {
  background: var(--mm-chip-positive);
  border: 1px solid var(--mm-green);
  color: var(--mm-text-green);
}

.dash-status-card.status-rejected {
  background: var(--mm-chip-destructive);
  border: 1px solid var(--mm-red);
  color: var(--mm-text-red-on-tint);
}

.dash-status-card.status-review {
  background: var(--mm-chip-attention);
  border: 1px solid var(--mm-yellow);
  color: var(--mm-text-yellow-on-tint);
}

.status-label {
  font-size: var(--text-lg);
  font-weight: 400;
  font-family: 'Merge One';
}

.status-date {
  font-size: var(--text-xs);
  opacity: 0.8;
}

.dash-form-answers h3 {
  font-size: var(--text-md);
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
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
}

.answer-row dt {
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  color: var(--mm-text-muted);
  margin-bottom: 2px;
}

.answer-row dd {
  font-size: var(--text-sm);
  color: var(--mm-black);
  margin: 0;
}

.dash-no-answers {
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  padding: 20px;
  text-align: center;
}

.dash-actions {
  display: flex;
  flex-direction: row;
  gap: 12px;
  margin-top: 24px;
}
</style>
