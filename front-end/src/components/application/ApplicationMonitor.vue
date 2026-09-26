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
import { useReviewHighlights } from '@/utils/reviewHighlights';
import { EMPTY_ESSENTIAL_OPTIONS } from '@/utils/essentialFields';
import ReviewHighlights from '@/components/application/ReviewHighlights.vue';
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

const emit = defineEmits<{ (event: 'update:undecidedCount', value: number): void }>();

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
  open: 'var(--mm-blue)',
  under_review: '#ab6600',
  reviewer_approved: 'var(--mm-green)',
  reviewer_rejected: '#d93c30',
  unassigned: '#767676',
  assigned: 'var(--mm-blue)',
  assignment_sent: '#9c27b0',
  vendor_accepted: 'var(--mm-green)',
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
/**
 * Changed from HERE, not only from the form builder (E19/F03/S02).
 *
 * This is the point of storing the list on the market rather than on the form. An organizer
 * authoring a form is guessing what will matter; a reviewer on card twelve knows - and by then the
 * form has frozen, because an application exists. The same composable the builder uses, so there
 * is one list and no second store to diverge from.
 */
const marketRef = computed(() => props.market);
const { highlights, error: highlightsError, save: saveHighlights } = useReviewHighlights(marketRef);

/** Whether the reviewer has the marking control open. Closed by default: the queue is for judging. */
const choosingHighlights = ref(false);

/**
 * What the essential questions offered this market's applicants.
 *
 * Read off the FROZEN snapshot on the form, never recomputed from the current plan: by the time
 * anyone is reviewing, the plan may have moved on, and offering a reviewer a question the
 * applicants were never asked would mark an answer no card can show.
 */
const essentialOptions = computed(
  () => props.market?.applicationForm?.essentialOptions ?? EMPTY_ESSENTIAL_OPTIONS,
);

const split = computed(() =>
  current.value
    ? reviewAnswers(current.value, props.market?.applicationForm, highlights.value)
    : { leading: [], rest: [] },
);
const leading = computed(() => split.value.leading);
const rest = computed(() => split.value.rest);

/**
 * Kept for the whole session, not per card (E19/F03/S01).
 *
 * A reviewer who opens this once is not reopening it forty times; at card forty a click to reach
 * an unmarked answer is a tax on the person doing the work.
 */
const restOpen = ref(false);
const nothingToJudge = computed(() => asksNothingDistinguishing(props.market?.applicationForm));

// The surface above leads with this in the review phase, where clearing the queue is the whole of
// what the market is waiting on (E18/F02/S03).
watch(undecided, (queue) => emit('update:undecidedCount', queue.length), { immediate: true });

// Reload the queue when the surface is shown or a different MARKET opens - not whenever the store
// re-reads this one. It re-reads after every write now (E21/F02/S02), a highlight toggle included,
// and reloading on each would put the reviewer back on the first card mid-queue.
watch(
  () => [props.visible, props.market?.id] as const,
  async ([visible]) => {
    if (visible && props.market) await loadApplications();
  },
  { immediate: true },
);

watch(
  () => props.market?.resultsPublished,
  (published) => (resultsPublished.value = published ?? false),
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

        <!-- What this market said a reviewer reads first (E19/F03/S01). -->
        <dl v-if="leading.length" class="answers" data-testid="app-monitor-leading">
          <template v-for="answer in leading" :key="answer.key">
            <dt :class="{ custom: answer.custom }">{{ answer.label }}</dt>
            <dd>{{ answer.value }}</dd>
          </template>
        </dl>

        <!--
          The rest, behind a disclosure - but ONLY when something was marked. A market that marked
          nothing renders the card exactly as it always did: an empty list is not a reason to hide
          an application.

          The label names the HIDDEN count, not the total: the question a reviewer is answering
          before they click is "what am I not being shown?", and the
          open state is kept for the whole session: at card forty, reopening this each time is a
          tax on the person doing the work.
        -->
        <details
          v-if="leading.length && rest.length"
          class="answers-rest"
          :open="restOpen"
          data-testid="app-monitor-rest"
          @toggle="restOpen = ($event.target as HTMLDetailsElement).open"
        >
          <summary data-testid="app-monitor-rest-summary">
            {{ rest.length }} more {{ rest.length === 1 ? 'answer' : 'answers' }}
          </summary>
          <dl class="answers">
            <template v-for="answer in rest" :key="answer.key">
              <dt :class="{ custom: answer.custom }">{{ answer.label }}</dt>
              <dd>{{ answer.value }}</dd>
            </template>
          </dl>
        </details>

        <dl v-else-if="rest.length" class="answers" data-testid="app-monitor-answers">
          <template v-for="answer in rest" :key="answer.key">
            <dt :class="{ custom: answer.custom }">{{ answer.label }}</dt>
            <dd>{{ answer.value }}</dd>
          </template>
        </dl>
        <p v-else-if="!leading.length" class="no-answers">This application carries no answers.</p>

        <!--
          Change what leads the card, from where the knowing happens (E19/F03/S02).

          Nothing here touches `cursor`, so a reviewer on card twelve stays on card twelve: the
          marks change what the card SHOWS, never which application is up.
        -->
        <div class="choose-highlights">
          <button
            type="button"
            class="choose-highlights-toggle"
            :aria-expanded="choosingHighlights"
            data-testid="app-monitor-choose-highlights"
            @click="choosingHighlights = !choosingHighlights"
          >
            {{ choosingHighlights ? 'Done choosing' : 'Choose what leads the card' }}
          </button>
          <div v-if="choosingHighlights" class="choose-highlights-body">
            <ReviewHighlights
              :fields="market?.applicationForm?.fields ?? []"
              :essentialOptions="essentialOptions"
              :highlights="highlights"
              @update:highlights="saveHighlights"
            />
            <p
              v-if="highlightsError"
              class="choose-highlights-error"
              data-testid="app-monitor-highlights-error"
            >
              {{ highlightsError }}
            </p>
          </div>
        </div>

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
  font-size: var(--text-lg);
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
  border-radius: var(--radius-control);
  padding: 8px 16px;
  cursor: pointer;
  font-family: 'Merge One';
  font-size: var(--text-sm);
}

.publish-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.publish-hint {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  max-width: 24ch;
}

.published-badge {
  background: rgba(54, 130, 111, 0.16);
  color: var(--mm-green);
  padding: 6px 12px;
  border-radius: var(--radius-control);
  font-size: var(--text-xs);
  font-weight: 400;
}

.loading-state,
.empty-state,
.done-state {
  text-align: center;
  padding: 40px;
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.error-state {
  color: var(--mm-red);
  font-size: var(--text-sm);
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
  font-size: var(--text-lg);
  color: var(--mm-black);
}

.tally {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.advisory {
  background: rgba(228, 166, 41, 0.18);
  border: 1px solid var(--mm-yellow);
  border-radius: var(--radius-card);
  padding: 10px 14px;
  font-size: var(--text-xs);
  line-height: 1.5;
  margin: 0 0 16px;
}

.review-card {
  border: 1.5px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: var(--mm-beige);
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
  font-size: var(--text-sm);
  color: var(--mm-black);
  word-break: break-all;
}

.app-status {
  font-size: var(--text-xs);
  font-weight: 400;
  color: white;
  padding: 2px 8px;
  border-radius: var(--radius-control);
  text-transform: capitalize;
  white-space: nowrap;
}

.app-date {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.answers {
  display: grid;
  grid-template-columns: minmax(0, 13rem) minmax(0, 1fr);
  gap: 6px 16px;
  margin: 0 0 18px;
  font-size: var(--text-sm);
}

.answers dt {
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.answers dt.custom {
  color: var(--mm-black);
  font-weight: 400;
}

.answers dd {
  margin: 0;
  color: var(--mm-black);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.no-answers {
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  margin: 0 0 18px;
}

/* The unmarked answers. Set apart from the marked ones above it by a rule, so the card reads as
   "these first, then the rest" rather than as one long list that happens to fold. */
.answers-rest {
  margin: 0 0 18px;
  border-top: 1px solid var(--mm-border);
  padding-top: 12px;
}

.answers-rest summary {
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

.answers-rest summary::-webkit-details-marker {
  display: none;
}

/* Its own marker, because the native one is hidden above to keep the row on one baseline. */
.answers-rest summary::before {
  content: '▸';
  font-size: var(--text-xs);
  transition: transform 0.12s ease;
}

.answers-rest[open] summary::before {
  transform: rotate(90deg);
}

.answers-rest summary:hover {
  color: var(--mm-black);
}

.answers-rest .answers {
  margin: 12px 0 0;
}

/* Changing what leads the card, from the queue. Quiet by default: the reviewer came here to
   judge applications, and this is the thing they reach for once. */
.choose-highlights {
  margin: 0 0 18px;
}

.choose-highlights-toggle {
  border: none;
  background: none;
  padding: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  cursor: pointer;
  text-decoration: underline;
}

.choose-highlights-toggle:hover {
  color: var(--mm-black);
}

.choose-highlights-body {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: var(--mm-beige);
}

.choose-highlights-error {
  margin: 8px 0 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
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
  border-radius: var(--radius-control);
  padding: 10px 16px;
  cursor: pointer;
  font-size: var(--text-sm);
  color: white;
}

.skip-button {
  border: 1px solid var(--mm-border);
}

/* The brand green, which is also the passing one: 4.59 under white text. It used to be var(--mm-green),
   which cleared AA by 0.06 - all three verdict buttons were coloured without the contrast contract
   in view and this is the one that happened to land on the right side of it (E16/F01/S03). */
.approve-button {
  background: var(--mm-green);
}

.approve-button:hover:not(:disabled) {
  opacity: 0.9;
}

.reject-button {
  background: var(--mm-red);
}

.reject-button:hover:not(:disabled) {
  /* One red for one meaning, so a hover cannot be a second red. The product already
     answers the pointer this way on its other solid fills (E16/F01). */
  opacity: 0.9;
}

/* Not a verdict, and not a fill. White on --mm-border measured 1.74, and that token is declared a
   line colour that never carries text - the contrast test exempts it on exactly that grounds, which
   is why nothing caught this. An outline says "this decides nothing" and uses the token for its
   own job (E16/F01/S03). */
.skip-button {
  background: white;
  color: var(--mm-black);
  border: 1px solid var(--mm-border);
}

.approve-button:disabled,
.reject-button:disabled,
.skip-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.card-actions kbd {
  font-family: monospace;
  font-size: var(--text-xs);
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: var(--radius-control);
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
  font-size: var(--text-xs);
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
  border-radius: var(--radius-control);
}

.decided-list .app-email {
  flex: 1 1 12rem;
  font-size: var(--text-sm);
}

.approve-button.small,
.reject-button.small {
  padding: 5px 12px;
  font-size: var(--text-xs);
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
