<script setup lang="ts">
/**
 * Review, one application at a time.
 *
 * The queue used to be a list of rows carrying an email address, a status pill and two buttons -
 * so an organizer facing a real market (232 applications) was asked to accept or refuse people
 * with nothing in front of them to decide on. Wayfinder ticket 04 prototyped three answers and
 * this is the one chosen: triage. One application, every answer it holds, a verdict by keyboard
 * or click, and a count of what is left.
 *
 * **There is deliberately no control that decides more than one application at once.** Not a
 * select-all, not an "approve all matching". A bulk verdict is a verdict nobody read, and the
 * approved set is the solver's entire input - `assign_market` reads `reviewer_approved` and
 * nothing else. An escape hatch here would be the feature everyone uses.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Application, Market } from '@/assets/types/datatypes';
import { ApplicationStatus, IntakeMode } from '@/assets/types/datatypes';
import {
  fetchMarketApplications,
  reviewApplication,
  publishResults as publishResultsApi,
} from '@/utils/applicantApi';
import { getApiErrorMessage } from '@/utils/api';
import { asksNothingDistinguishing, reviewAnswers } from '@/utils/reviewQueue';
import { getTimestampDate } from '@/utils/utils';

const props = defineProps<{
  market: Market | null;
  visible: boolean;
  /**
   * Whether the application form can still be changed, as the server answered it - not as this
   * component guesses. The advisory below used to tell every organizer that adding a question was
   * "possible while the market is a draft and nobody has applied", which is a description of the
   * rule rather than of their market: five people had applied and the form was frozen.
   */
  formEditable: boolean;
}>();

const applications = ref<Application[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const publishLoading = ref(false);
const publishError = ref('');
const resultsPublished = ref(false);
const saving = ref(false);
/** Where in the undecided queue the reviewer is. Skipping moves it; a verdict does not. */
const cursor = ref(0);
const showDecided = ref(false);

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

// These are fills carrying white text (`.app-status` sets `color: white`), so each must reach
// WCAG AA against white. The Material 500 shades they were taken from do not: blue was 3.12,
// orange 2.16, green 2.78, red 3.68 and grey 2.68. Darkened to the lightest shade of the same hue
// that passes, so the palette still reads as itself. Purple was already 6.3 and is unchanged.
const statusColors: Record<string, string> = {
  open: '#1b7ac5',
  under_review: '#ab6600',
  reviewer_approved: '#3a853d',
  reviewer_rejected: '#d93c30',
  unassigned: '#767676',
  assigned: '#1b7ac5',
  assignment_sent: '#9c27b0',
  vendor_accepted: '#3a853d',
  vendor_refused: '#d93c30',
  cancelled: '#767676',
};

/** Awaiting a verdict. Anything else has been reviewed, and does not come back to the queue. */
const AWAITING = [ApplicationStatus.Open, ApplicationStatus.UnderReview] as string[];

const undecided = computed(() => applications.value.filter((a) => AWAITING.includes(a.status)));
/**
 * Reviewed: everything the queue is done with, whatever became of it since.
 *
 * Deliberately "not awaiting" rather than "approved or rejected". An application does not stay at
 * its reviewer verdict: assignment carries it to `assigned` or `unassigned`, offers to
 * `assignment_sent`, and the sweep into market days to `vendor_accepted` or `vendor_refused`. A
 * list of the two reviewer verdicts alone would drop each application the moment the market moved
 * on, until the tab showed nothing at all. The list this replaces rendered every status, and so
 * does this one.
 */
const decided = computed(() => applications.value.filter((a) => !AWAITING.includes(a.status)));

/**
 * Does publishing results mean anything on this market?
 *
 * `resultsPublished` is what makes a reviewer's verdict visible to the applicant instead of
 * `under_review` - and every endpoint that reads it goes through
 * `applicant_intake_market_by_slug`, which serves form-intake markets only. On a CSV market the
 * flag has no reader at all, so the button was a no-op with a confident label. It is absent
 * there, and the endpoint refuses too, because a hidden button is not a rule.
 *
 * Intake mode has no organizer control yet, so in practice this removes the button from MVP -
 * which is the honest outcome, and the code keeps the concept rather than losing it.
 */
const marketHasApplicants = computed(() => props.market?.intakeMode === IntakeMode.Form);

/** Publishing verdicts nobody has reached yet would publish nothing. */
const hasVerdictToPublish = computed(() => decided.value.length > 0);
/** Re-deciding is the reviewer's own verdict to change; a published application has moved on. */
function reDecidable(app: Application): boolean {
  return (
    app.status === ApplicationStatus.ReviewerApproved ||
    app.status === ApplicationStatus.ReviewerRejected
  );
}
const approvedCount = computed(
  () => applications.value.filter((a) => a.status === ApplicationStatus.ReviewerApproved).length,
);
const rejectedCount = computed(
  () => applications.value.filter((a) => a.status === ApplicationStatus.ReviewerRejected).length,
);
/** The verdict split is only legible while the verdicts are still on the applications. */
const verdictsStillLegible = computed(() => approvedCount.value + rejectedCount.value > 0);

const current = computed<Application | undefined>(() => undecided.value[cursor.value]);
const answers = computed(() =>
  current.value ? reviewAnswers(current.value, props.market?.applicationForm) : [],
);
const nothingToJudge = computed(() => asksNothingDistinguishing(props.market?.applicationForm));

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
    applications.value = await fetchMarketApplications(props.market.id);
    cursor.value = 0;
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to load applications');
  } finally {
    loading.value = false;
  }
}

/**
 * Record one verdict, and keep the local list in step with the answer rather than refetching.
 *
 * A refetch per verdict is 232 fetches of 232 applications across one review session; on the real
 * export that was the whole difference between a queue that keeps up with typing and one that
 * does not. The endpoint returns the application it wrote, so the list already has the truth.
 */
async function decide(app: Application, status: ApplicationStatus) {
  if (!props.market || saving.value) return;
  saving.value = true;
  errorMessage.value = '';
  try {
    const updated = await reviewApplication(props.market.id, app.id, status);
    const index = applications.value.findIndex((a) => a.id === app.id);
    if (index !== -1) applications.value[index] = updated;
    // The verdict removed this one from the queue, so the cursor already points at the next.
    // It can only sit past the end when the reviewer had skipped to the last card.
    if (cursor.value >= undecided.value.length) {
      cursor.value = Math.max(undecided.value.length - 1, 0);
    }
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to update application');
  } finally {
    saving.value = false;
  }
}

function decideCurrent(status: ApplicationStatus) {
  if (current.value) void decide(current.value, status);
}

/** Leave this one for later. It stays in the queue, so the count of work left does not lie. */
function skip() {
  if (undecided.value.length === 0) return;
  cursor.value = (cursor.value + 1) % undecided.value.length;
}

function onKey(event: KeyboardEvent) {
  if (!props.visible || !current.value) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key !== 'a' && key !== 'r' && key !== 's') return;
  event.preventDefault();
  if (key === 'a') decideCurrent(ApplicationStatus.ReviewerApproved);
  if (key === 'r') decideCurrent(ApplicationStatus.ReviewerRejected);
  if (key === 's') skip();
}

onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));

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
  return statusColors[status] ?? '#767676';
}

function submittedOn(app: Application): string {
  return getTimestampDate(app.submittedAt);
}
</script>

<template>
  <div v-if="visible && market" class="monitor-panel" data-testid="app-monitor-panel">
    <div class="monitor-header">
      <h2>Applications</h2>
      <div v-if="marketHasApplicants" class="monitor-actions">
        <button
          v-if="!resultsPublished"
          class="publish-button"
          :disabled="publishLoading || !hasVerdictToPublish"
          @click="handlePublish"
          data-testid="app-monitor-publish-button"
        >
          {{ publishLoading ? 'Publishing...' : 'Publish Results' }}
        </button>
        <span
          v-if="!resultsPublished && !hasVerdictToPublish"
          class="publish-hint"
          data-testid="app-monitor-publish-hint"
        >
          Review an application first; there is nothing to publish yet.
        </span>
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

    <template v-else>
      <div class="progress-row">
        <span class="progress" data-testid="app-monitor-progress">
          <template v-if="undecided.length">
            {{ cursor + 1 }} of {{ undecided.length }} to review
          </template>
          <template v-else>All {{ applications.length }} reviewed</template>
        </span>
        <span class="tally" data-testid="app-monitor-tally">
          {{ decided.length }} reviewed<template v-if="verdictsStillLegible">
            · {{ approvedCount }} approved · {{ rejectedCount }} rejected</template
          >
        </span>
      </div>

      <p v-if="nothingToJudge" class="advisory" data-testid="app-monitor-advisory">
        This market's form asks only the essential questions, so every application reads alike and
        there is nothing here to tell applicants apart.
        <template v-if="formEditable">
          Add a question of your own on the Application Form tab. The form freezes as soon as the
          first applicant submits.
        </template>
        <template v-else>
          The form is frozen for this market, so nothing can be added to it now.
        </template>
      </p>

      <div v-if="current" class="review-card" data-testid="app-monitor-card">
        <div class="card-head">
          <span class="app-email" data-testid="app-monitor-email">
            {{ current.applicantEmail }}
          </span>
          <span
            class="app-status"
            :style="{ background: statusColor(current.status) }"
            data-testid="app-monitor-status"
          >
            {{ statusLabel(current.status) }}
          </span>
          <span v-if="submittedOn(current)" class="app-date">{{ submittedOn(current) }}</span>
        </div>

        <dl v-if="answers.length" class="answers" data-testid="app-monitor-answers">
          <template v-for="answer in answers" :key="answer.key">
            <dt :class="{ custom: answer.custom }">{{ answer.label }}</dt>
            <dd>{{ answer.value }}</dd>
          </template>
        </dl>
        <p v-else class="no-answers">This application carries no answers.</p>

        <div class="card-actions">
          <button
            class="reject-button"
            :disabled="saving"
            @click="decideCurrent(ApplicationStatus.ReviewerRejected)"
            data-testid="app-monitor-reject-button"
          >
            Reject <kbd>R</kbd>
          </button>
          <button
            class="skip-button"
            :disabled="saving || undecided.length < 2"
            @click="skip"
            data-testid="app-monitor-skip-button"
          >
            Skip <kbd>S</kbd>
          </button>
          <button
            class="approve-button"
            :disabled="saving"
            @click="decideCurrent(ApplicationStatus.ReviewerApproved)"
            data-testid="app-monitor-approve-button"
          >
            Approve <kbd>A</kbd>
          </button>
        </div>
      </div>

      <p v-else class="done-state" data-testid="app-monitor-done">Nothing left to review.</p>

      <!-- Decided applications, so a verdict can be read back and corrected - one at a time. -->
      <div v-if="decided.length" class="decided">
        <button
          class="decided-toggle"
          @click="showDecided = !showDecided"
          data-testid="app-monitor-decided-toggle"
        >
          {{ showDecided ? 'Hide' : 'Show' }} {{ decided.length }} reviewed
        </button>
        <ul v-if="showDecided" class="decided-list" data-testid="app-monitor-decided-list">
          <li v-for="app in decided" :key="app.id" data-testid="app-monitor-decided-row">
            <span class="app-email" data-testid="app-monitor-decided-email">
              {{ app.applicantEmail }}
            </span>
            <span
              class="app-status"
              :style="{ background: statusColor(app.status) }"
              data-testid="app-monitor-decided-status"
            >
              {{ statusLabel(app.status) }}
            </span>
            <button
              v-if="app.status === ApplicationStatus.ReviewerRejected"
              class="approve-button small"
              :disabled="saving"
              @click="decide(app, ApplicationStatus.ReviewerApproved)"
              data-testid="app-monitor-decided-approve-button"
            >
              Approve instead
            </button>
            <button
              v-else-if="reDecidable(app)"
              class="reject-button small"
              :disabled="saving"
              @click="decide(app, ApplicationStatus.ReviewerRejected)"
              data-testid="app-monitor-decided-reject-button"
            >
              Reject instead
            </button>
          </li>
        </ul>
      </div>
    </template>
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

.publish-hint {
  font-size: 12px;
  color: var(--mm-text-muted);
  max-width: 24ch;
}

.published-badge {
  background: #e8f5e9;
  color: #2e7d32;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
}

.loading-state,
.empty-state,
.done-state {
  text-align: center;
  padding: 40px;
  color: var(--mm-text-muted);
  font-size: 14px;
}

.error-state {
  color: #d32f2f;
  font-size: 14px;
  margin-bottom: 12px;
}

.progress-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.progress {
  font-family: 'Merge One', sans-serif;
  font-size: 18px;
  color: var(--mm-black);
}

.tally {
  font-size: 13px;
  color: var(--mm-text-muted);
}

.advisory {
  background: #fdf7ec;
  border: 1px solid var(--mm-yellow);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.5;
  margin: 0 0 16px;
}

.review-card {
  border: 1.5px solid var(--mm-border);
  border-radius: 8px;
  background: #fafafa;
  padding: 18px;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.app-email {
  font-size: 15px;
  color: var(--mm-black);
  word-break: break-all;
}

.app-status {
  font-size: 11px;
  font-weight: 500;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: capitalize;
  white-space: nowrap;
}

.app-date {
  font-size: 12px;
  color: var(--mm-text-muted);
}

.answers {
  display: grid;
  grid-template-columns: minmax(0, 13rem) minmax(0, 1fr);
  gap: 6px 16px;
  margin: 0 0 18px;
  font-size: 14px;
}

.answers dt {
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.answers dt.custom {
  color: var(--mm-black);
  font-weight: 500;
}

.answers dd {
  margin: 0;
  color: var(--mm-black);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.no-answers {
  font-size: 14px;
  color: var(--mm-text-muted);
  margin: 0 0 18px;
}

.card-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.card-actions button {
  flex: 1 1 8rem;
}

.approve-button,
.reject-button,
.skip-button {
  border: none;
  border-radius: 4px;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 14px;
  color: white;
}

/* White text on #4caf50 was 2.78. Same passing green as the approved status badge. */
.approve-button {
  background: #3a853d;
}

.approve-button:hover:not(:disabled) {
  background: #306e33;
}

.reject-button {
  background: #f44336;
}

.reject-button:hover:not(:disabled) {
  background: #e53935;
}

.skip-button {
  background: var(--mm-border);
}

.approve-button:disabled,
.reject-button:disabled,
.skip-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.card-actions kbd {
  font-family: monospace;
  font-size: 11px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 3px;
  padding: 0 4px;
  margin-left: 6px;
}

.decided {
  margin-top: 20px;
}

.decided-toggle {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 13px;
  color: var(--mm-green);
  text-decoration: underline;
}

.decided-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.decided-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 14px;
  border: 1px solid var(--mm-border);
  border-radius: 6px;
}

.decided-list .app-email {
  flex: 1 1 12rem;
  font-size: 14px;
}

.approve-button.small,
.reject-button.small {
  padding: 5px 12px;
  font-size: 12px;
}

@media (max-width: 640px) {
  .answers {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px 0;
  }

  .answers dd {
    margin-bottom: 10px;
  }
}
</style>
