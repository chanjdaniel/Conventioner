<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Application, Market } from '@/assets/types/datatypes';
import { ApplicationStatus } from '@/assets/types/datatypes';
import {
  fetchMarketApplications,
  reviewApplication,
  publishResults as publishResultsApi,
} from '@/utils/applicantApi';
import { getApiErrorMessage } from '@/utils/api';

const props = defineProps<{
  market: Market | null;
  visible: boolean;
}>();

const applications = ref<Application[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const publishLoading = ref(false);
const publishError = ref('');
const resultsPublished = ref(false);

const statusLabels: Record<string, string> = {
  open: 'Open',
  under_review: 'Under Review',
  reviewer_approved: 'Approved',
  reviewer_rejected: 'Rejected',
  unassigned: 'Unassigned',
  assigned: 'Assigned',
  assignment_sent: 'Assignment Sent',
  vendor_accepted: 'Accepted',
  vendor_refused: 'Refused',
  cancelled: 'Cancelled',
};

const statusColors: Record<string, string> = {
  open: '#2196f3',
  under_review: '#ff9800',
  reviewer_approved: '#4caf50',
  reviewer_rejected: '#f44336',
  unassigned: '#9e9e9e',
  assigned: '#2196f3',
  assignment_sent: '#9c27b0',
  vendor_accepted: '#4caf50',
  vendor_refused: '#f44336',
  cancelled: '#9e9e9e',
};

watch(
  () => [props.visible, props.market] as const,
  async ([visible]) => {
    if (visible && props.market) {
      resultsPublished.value = props.market.resultsPublished ?? false;
      await loadApplications();
    }
  },
  { immediate: true },
);

async function loadApplications() {
  if (!props.market) return;
  loading.value = true;
  errorMessage.value = '';
  try {
    const apps = await fetchMarketApplications(props.market.id);
    applications.value = apps;
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to load applications');
  } finally {
    loading.value = false;
  }
}

async function handleReview(app: Application, newStatus: ApplicationStatus) {
  if (!props.market) return;
  try {
    await reviewApplication(props.market.id, app.id, newStatus);
    await loadApplications();
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to update application');
  }
}

async function handlePublish() {
  if (!props.market) return;
  publishLoading.value = true;
  publishError.value = '';
  try {
    await publishResultsApi(props.market.id);
    resultsPublished.value = true;
  } catch (err) {
    publishError.value = getApiErrorMessage(err, 'Failed to publish results');
  } finally {
    publishLoading.value = false;
  }
}

function statusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

function statusColor(status: string): string {
  return statusColors[status] ?? '#9e9e9e';
}
</script>

<template>
  <div v-if="visible && market" class="monitor-panel" data-testid="app-monitor-panel">
    <div class="monitor-header">
      <h2>Applications</h2>
      <div class="monitor-actions">
        <button
          v-if="!resultsPublished"
          class="publish-button"
          :disabled="publishLoading"
          @click="handlePublish"
          data-testid="app-monitor-publish-button"
        >
          {{ publishLoading ? 'Publishing...' : 'Publish Results' }}
        </button>
        <span
          v-if="resultsPublished"
          class="published-badge"
          data-testid="app-monitor-published-badge"
        >
          Results Published
        </span>
      </div>
    </div>

    <p v-if="publishError" class="error-state">{{ publishError }}</p>
    <p v-if="errorMessage" class="error-state">{{ errorMessage }}</p>

    <div v-if="loading" class="loading-state" data-testid="app-monitor-loading">
      Loading applications...
    </div>

    <div v-else-if="applications.length === 0" class="empty-state" data-testid="app-monitor-empty">
      No applications received yet.
    </div>

    <div v-else class="applications-list" data-testid="app-monitor-list">
      <div
        v-for="app in applications"
        :key="app.id"
        class="application-card"
        data-testid="app-monitor-card"
      >
        <div class="app-info">
          <span class="app-email" data-testid="app-monitor-email">{{ app.applicantEmail }}</span>
          <span
            class="app-status"
            :style="{ background: statusColor(app.status) }"
            data-testid="app-monitor-status"
          >
            {{ statusLabel(app.status) }}
          </span>
          <span v-if="app.submittedAt" class="app-date">
            {{ new Date(app.submittedAt).toLocaleDateString() }}
          </span>
        </div>

        <div class="app-actions">
          <button
            v-if="
              app.status === ApplicationStatus.Open ||
              app.status === ApplicationStatus.UnderReview ||
              app.status === ApplicationStatus.ReviewerApproved ||
              app.status === ApplicationStatus.ReviewerRejected
            "
            class="approve-button"
            @click="handleReview(app, ApplicationStatus.ReviewerApproved)"
            data-testid="app-monitor-approve-button"
          >
            Approve
          </button>
          <button
            v-if="
              app.status === ApplicationStatus.Open ||
              app.status === ApplicationStatus.UnderReview ||
              app.status === ApplicationStatus.ReviewerApproved ||
              app.status === ApplicationStatus.ReviewerRejected
            "
            class="reject-button"
            @click="handleReview(app, ApplicationStatus.ReviewerRejected)"
            data-testid="app-monitor-reject-button"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.monitor-panel {
  padding: 20px 0;
}

.monitor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.monitor-header h2 {
  margin: 0;
  font-size: 20px;
  font-family: 'Outfit Regular', sans-serif;
  color: var(--mm-black);
}

.monitor-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.publish-button {
  background: var(--mm-green);
  color: white;
  border: none;
  border-radius: 5px;
  padding: 8px 16px;
  cursor: pointer;
  font-family: 'Merge One';
  font-size: 14px;
}

.publish-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.published-badge {
  background: #e8f5e9;
  color: #2e7d32;
  padding: 6px 12px;
  border-radius: 4px;
  font-family: 'Outfit Regular';
  font-size: 13px;
  font-weight: 500;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 40px;
  color: var(--mm-grey, #999);
  font-family: 'Outfit Regular';
  font-size: 14px;
}

.error-state {
  color: #d32f2f;
  font-size: 14px;
  margin-bottom: 12px;
}

.applications-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.application-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border: 1.5px solid var(--mm-grey, #ddd);
  border-radius: 8px;
  background: #fafafa;
}

.app-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.app-email {
  font-family: 'Outfit Regular';
  font-size: 14px;
  color: var(--mm-black);
}

.app-status {
  font-family: 'Outfit Regular';
  font-size: 11px;
  font-weight: 500;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: capitalize;
}

.app-date {
  font-family: 'Outfit Regular';
  font-size: 12px;
  color: var(--mm-grey, #999);
}

.app-actions {
  display: flex;
  gap: 8px;
}

.approve-button {
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 6px 14px;
  cursor: pointer;
  font-family: 'Outfit Regular';
  font-size: 13px;
}

.approve-button:hover {
  background: #43a047;
}

.reject-button {
  background: #f44336;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 6px 14px;
  cursor: pointer;
  font-family: 'Outfit Regular';
  font-size: 13px;
}

.reject-button:hover {
  background: #e53935;
}
</style>
