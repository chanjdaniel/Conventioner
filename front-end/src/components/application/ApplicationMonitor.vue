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
 * **This view decides one application at a time.** A verdict on several is the All view's
 * (`ApplicationsAll`, E34/F04/S02): rows the reviewer ticks, one by one, a confirmation naming the
 * count, and never "approve all matching" - a verdict nobody read would reach the approved set,
 * which is the solver's entire input (`assign_market` reads `reviewer_approved` and nothing else).
 * The automatic rejections take the clear-cut cases first (E33/F03).
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Application, Market } from '@/assets/types/datatypes';
import { ApplicationStatus } from '@/assets/types/datatypes';
import { fetchMarketApplications, reassignFollowUp } from '@/utils/applicantApi';
import { getApiErrorMessage } from '@/utils/api';
import {
  asksNothingDistinguishing,
  followUps,
  reviewAnswers,
  reviewQueue,
  reviewed,
} from '@/utils/reviewQueue';
import FollowUpDialog from '@/components/application/FollowUpDialog.vue';
import { useReviewHighlights } from '@/utils/reviewHighlights';
import { EMPTY_ESSENTIAL_OPTIONS, TABLE_SHARE_ANSWER_KEY } from '@/utils/essentialFields';
import ReviewHighlights from '@/components/application/ReviewHighlights.vue';
import AnswerValue from '@/components/AnswerValue.vue';
import TableShareNotice from '@/components/TableShareNotice.vue';
import VendorNotes from '@/components/VendorNotes.vue';
import { statusChip, statusLabel, verdictGiverLine } from '@/utils/verdicts';
import { useVendorNotes } from '@/utils/vendorNotes';
import { useReviewClaims } from '@/utils/reviewClaims';
import { useVerdictActions, type VerdictOutcome } from '@/utils/verdictActions';
import { getTimestampDate } from '@/utils/utils';

const props = defineProps<{
  market: Market | null;
  visible: boolean;
  /**
   * An application to open at, by id: an assignment refused for incomplete answers links to each
   * one it names (bug 42), so the organizer lands on that application rather than hunting for it.
   */
  named?: string;
}>();

const emit = defineEmits<{ (event: 'update:undecidedCount', value: number): void }>();

const applications = ref<Application[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const saving = ref(false);
/** Where in the undecided queue the reviewer is. Skipping moves it; a verdict does not. */
const cursor = ref(0);
const showDecided = ref(false);

/**
 * Whether the one-by-one review takes the follow-ups too, after the rest (E34/F02/S01). Off by
 * default: a follow-up waits on its applicant, so it is not the next thing to decide.
 */
const includeFollowUps = ref(false);
/** The queue, in the order the applications arrived (E30/F01/S05). */
const undecided = computed(() => reviewQueue(applications.value, includeFollowUps.value));
const followingUp = computed(() => followUps(applications.value));
/** Reviewed: everything the queue is done with (`reviewed` in `utils/reviewQueue`). */
const decided = computed(() => reviewed(applications.value));
/** Who gave each decided application its verdict (E34/F01/S01), worded once per row. */
const givers = computed(
  () => new Map(decided.value.map((app) => [app.id, verdictGiverLine(app)] as const)),
);

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

/**
 * An application a verdict was refused for, because someone changed it since the reviewer opened it
 * (E34/F03/S01). It stays on the card, as it now stands, until the reviewer decides again or moves
 * on - it may have left the queue, and the reviewer is owed the sight of what happened to it.
 */
const refusedOn = ref<string | null>(null);
const current = computed<Application | undefined>(
  () =>
    (refusedOn.value ? applications.value.find((a) => a.id === refusedOn.value) : undefined) ??
    undecided.value[cursor.value],
);
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
// Everything still to decide, follow-ups included: each holds Begin Assignment (E34/F02/S01).
watch(
  () => reviewQueue(applications.value, true).length,
  (count) => emit('update:undecidedCount', count),
  { immediate: true },
);

/**
 * Whether this person may change what leads the card - an EDITOR write - on a market that can
 * change at all (bugs 30 and 37).
 */
const readOnly = computed(() => Boolean(props.market?.readOnlyReason));

/**
 * Whether this person may give verdicts here: the server's `verdictLockReason` (E34) - EDITOR, like
 * every other change to the market's contents (E34/F01/S01), while the market can still run its
 * assignment. Viewers, archived markets and settled ones read the applications and their verdicts.
 */
const decides = computed(() => !props.market?.verdictLockReason);

/**
 * The organizer's notes on the applicant up (E31/F04/S04). Their own request is among the answers
 * above, so the notes here are the organizer's side alone.
 */
const notesMarketId = computed(() => props.market?.id ?? '');
const { load: loadNotes, entryFor } = useVendorNotes(notesMarketId);

/** Giving verdicts, as the All view gives them too (`useVerdictActions`). */
const verdicts = useVerdictActions(
  computed(() => props.market),
  applications,
);
const { me, people, adopt } = verdicts;
/**
 * Whom the card's "Followed up by" offers: the people a follow-up can be handed to, led by its
 * recorded owner when they are not among them (T15). An Editor from outside the organization is
 * offered only the market's roles, so an organization admin who owns the follow-up would match no
 * option and the box would read blank. Choosing the owner again changes nothing.
 */
const ownerChoices = computed(() => {
  const owner = current.value?.followUpOwner?.email;
  return owner && !people.value.includes(owner) ? [owner, ...people.value] : people.value;
});

/**
 * The card a reviewer holds (E34/F03/S02): handed out by the server, so two reviewers walk different
 * cards. Someone who may only read walks the queue here, as before, holding nothing.
 */
const claims = useReviewClaims(computed(() => props.market?.id ?? ''));
/** Every card left is open with another reviewer: there is nothing to hand out right now. */
const allHeldElsewhere = ref(false);
/** Who holds the cards nobody can be handed, for the line that says so. */
const holders = computed(() => [
  ...new Set(undecided.value.map((app) => app.heldBy?.email).filter(Boolean) as string[]),
]);
/** Someone else has the card on screen open: a reader's walk passes cards being decided. */
const heldByOther = computed(() => {
  const holder = current.value?.heldBy?.email;
  return holder && holder.toLowerCase() !== me.value.toLowerCase() ? holder : null;
});

// Reload the queue when the surface is shown or a different MARKET opens - not whenever the store
// re-reads this one. It re-reads after every write now (E21/F02/S02), a highlight toggle included,
// and reloading on each would put the reviewer back on the first card mid-queue.
watch(
  () => [props.visible, props.market?.id] as const,
  async ([visible]) => {
    if (visible && props.market) await loadApplications();
    // Leaving the review lets the held card go at once, not five minutes later.
    else if (!visible) claims.release();
  },
  { immediate: true },
);

/**
 * Open at the named application: on the card if it is still to decide - claimed for a reviewer,
 * unless someone else has it - otherwise in the reviewed list, opened, scrolled to and marked.
 */
async function showNamed() {
  const id = props.named;
  if (!id) return;
  const waiting = undecided.value.findIndex((app) => app.id === id);
  if (waiting >= 0) {
    if (decides.value) await takeNext(null, id);
    else cursor.value = waiting;
    return;
  }
  if (decides.value) await takeNext(null);
  if (!decided.value.some((app) => app.id === id)) return;
  showDecided.value = true;
  void nextTick(() =>
    document.querySelector(`[data-application-id="${id}"]`)?.scrollIntoView({ block: 'center' }),
  );
}

/** Put the next card up: the server's to hand out for a reviewer, the queue's own for a reader. */
async function takeNext(after: string | null, want: string | null = null) {
  if (!decides.value || !props.market) {
    if (undecided.value.length) cursor.value = (cursor.value + 1) % undecided.value.length;
    return;
  }
  try {
    const app = await claims.next(after, includeFollowUps.value, want);
    if (app) adopt(app);
    // Nothing handed out: read who holds what now, to say so.
    else applications.value = await fetchMarketApplications(props.market.id);
    allHeldElsewhere.value = !app && undecided.value.length > 0;
    cursor.value = app
      ? Math.max(
          undecided.value.findIndex((a) => a.id === app.id),
          0,
        )
      : 0;
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Could not open the next application.');
  }
}

async function loadApplications() {
  if (!props.market) return;
  loading.value = true;
  errorMessage.value = '';
  try {
    applications.value = await fetchMarketApplications(props.market.id);
    cursor.value = 0;
    if (props.named) await showNamed();
    else if (decides.value) await takeNext(null);
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to load applications');
  } finally {
    loading.value = false;
  }
}

/**
 * After a verdict, a follow-up or a refusal: what the card does next. Only the card on screen moves
 * the queue on - correcting a past verdict in the reviewed list leaves the reviewer where they were.
 *
 * The local list is kept in step with the answer rather than refetched: a refetch per verdict is 232
 * fetches of 232 applications across one review session.
 */
async function settle(app: Application, outcome: VerdictOutcome) {
  const onCard = app.id === current.value?.id || app.id === refusedOn.value;
  if (outcome.kind === 'failed') {
    errorMessage.value = outcome.message;
    return;
  }
  if (outcome.kind === 'changed') {
    // Nothing was written: show what is really there, and who put it there (E34/F03/S01).
    refusedOn.value = app.id;
    errorMessage.value = outcome.message;
    return;
  }
  refusedOn.value = null;
  if (!onCard) return;
  if (decides.value) {
    // The verdict let go of it; the next card is the server's to hand out (E34/F03/S02).
    await takeNext(app.id);
  } else if (cursor.value >= undecided.value.length) {
    cursor.value = Math.max(undecided.value.length - 1, 0);
  }
}

async function decide(app: Application, status: ApplicationStatus) {
  if (!props.market || saving.value) return;
  saving.value = true;
  errorMessage.value = '';
  try {
    await settle(app, await verdicts.give(app, status));
  } finally {
    saving.value = false;
  }
}

function decideCurrent(status: ApplicationStatus) {
  if (current.value) void decide(current.value, status);
}

/**
 * On to the next card without a verdict: it stays in the queue, so the count of work left does not
 * lie. Skip did this and recorded nothing; marking a follow-up is S now, and this is N.
 */
function next() {
  if (refusedOn.value) {
    const after = refusedOn.value;
    refusedOn.value = null;
    errorMessage.value = '';
    void takeNext(after);
    return;
  }
  if (undecided.value.length === 0 && !allHeldElsewhere.value) return;
  void takeNext(current.value?.id ?? null);
}

/**
 * Needs follow-up, in place of Skip, which recorded nothing (E34/F02/S01): a stored status, owned by
 * the reviewer unless they name someone else with a role on the market, with what is needed kept
 * in the vendor's notes - which the dialog opens on, so nothing there is written over.
 */
const followUpOpen = ref(false);
const followUpError = ref('');

async function markFollowUp(choice: { ownerEmail: string; note: string }) {
  const app = current.value;
  if (!app || saving.value) return;
  followUpError.value = '';
  saving.value = true;
  try {
    const outcome = await verdicts.markFollowUp(
      app,
      choice,
      entryFor(app.applicantEmail)?.note ?? '',
    );
    void loadNotes();
    if (outcome.kind === 'failed') {
      followUpError.value = outcome.message;
      return;
    }
    followUpOpen.value = false;
    await settle(app, outcome);
  } finally {
    saving.value = false;
  }
}

async function reassign(app: Application, ownerEmail: string) {
  if (!props.market) return;
  errorMessage.value = '';
  try {
    adopt(await reassignFollowUp(props.market.id, app.id, ownerEmail));
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Could not hand the follow-up over.');
  }
}

/** The keys: A, R and S decide - a reviewer's - and N moves on, for anyone walking the queue. */
function onKey(event: KeyboardEvent) {
  if (!props.visible || !current.value) return;
  // A dialog is open over the card: its own controls have the keyboard.
  if (followUpOpen.value) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === 'n') {
    event.preventDefault();
    next();
    return;
  }
  if (!decides.value || (key !== 'a' && key !== 'r' && key !== 's')) return;
  event.preventDefault();
  if (key === 'a') decideCurrent(ApplicationStatus.ReviewerApproved);
  if (key === 'r') decideCurrent(ApplicationStatus.ReviewerRejected);
  // S was Skip; it marks the follow-up now, the dialog asking who and what (E34/F02/S01).
  if (key === 's' && current.value.status !== ApplicationStatus.NeedsFollowUp) {
    followUpOpen.value = true;
  }
}

/** Anything the reviewer does keeps their card theirs (E34/F03/S02). */
function active() {
  claims.touch();
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  window.addEventListener('keydown', active);
  window.addEventListener('pointerdown', active);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('keydown', active);
  window.removeEventListener('pointerdown', active);
});

/** The applicant's own words in answer to the table-share question, for its notice. */
function shareWords(app: Application): string {
  return String(app.formData?.[TABLE_SHARE_ANSWER_KEY] ?? '');
}

function submittedOn(app: Application): string {
  return getTimestampDate(app.submittedAt);
}
</script>

<template>
  <div v-if="visible && market" class="monitor-panel" data-testid="app-monitor-panel">
    <p v-if="errorMessage && !refusedOn" class="error-state">{{ errorMessage }}</p>

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
          <template v-else-if="followingUp.length">Nothing else waiting</template>
          <template v-else>All {{ applications.length }} reviewed</template>
        </span>
        <!-- Follow-ups wait on their applicants, so they are out of the walk unless asked for. -->
        <label v-if="followingUp.length" class="include-follow-ups">
          <input
            v-model="includeFollowUps"
            type="checkbox"
            data-testid="app-monitor-include-follow-ups"
          />
          Include the {{ followingUp.length }}
          {{ followingUp.length === 1 ? 'follow-up' : 'follow-ups' }}
        </label>
        <span class="tally" data-testid="app-monitor-tally">
          {{ decided.length }} reviewed<template v-if="verdictsStillLegible">
            · {{ approvedCount }} approved · {{ rejectedCount }} rejected</template
          >
        </span>
      </div>

      <p v-if="nothingToJudge" class="advisory" data-testid="app-monitor-advisory">
        This market's form asks only the essential questions, so every application reads alike and
        there is nothing here to tell applicants apart.
        <!-- Always frozen, and said so. This only renders once applications exist, and the D9 lock
             freezes a form the moment one does - so the "add a question" branch it used to carry
             could never show. It also read a flag only the form tab published, so it was stale by
             construction and right by accident (E21/F02/S03). -->
        The form is frozen for this market, so nothing can be added to it now.
      </p>

      <div v-if="current" class="review-card" data-testid="app-monitor-card">
        <div class="card-head">
          <span class="app-email" data-testid="app-monitor-email">
            {{ current.applicantEmail }}
          </span>
          <span :class="statusChip(current.status)" data-testid="app-monitor-status">
            {{ statusLabel(current.status) }}
          </span>
          <span v-if="submittedOn(current)" class="app-date">{{ submittedOn(current) }}</span>
        </div>
        <!-- Another reviewer has it open: a reader sees it is being decided (E34/F03/S02). -->
        <p v-if="heldByOther" class="held-by" data-testid="app-monitor-held-by">
          {{ heldByOther }} is looking at this.
        </p>
        <!-- Someone decided it first: said here, on what they decided (E34/F03/S01). -->
        <p v-if="refusedOn" class="changed-since" data-testid="app-monitor-changed" role="alert">
          {{ errorMessage }}
          <span v-if="verdictGiverLine(current)" class="verdict-giver">
            {{ verdictGiverLine(current) }}.
          </span>
        </p>
        <!-- Who is reaching out, and who can be handed it (E34/F02/S01). A Viewer reads the recorded
             owner as plain text - the people it could be handed to are a verdict-giver's list. -->
        <div v-if="current.status === ApplicationStatus.NeedsFollowUp" class="follow-up-owner">
          <label :for="decides ? 'app-monitor-follow-up-owner' : undefined">Followed up by</label>
          <select
            v-if="decides"
            id="app-monitor-follow-up-owner"
            class="field field--select"
            :value="current.followUpOwner?.email ?? ''"
            data-testid="app-monitor-follow-up-owner"
            @change="reassign(current, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="person in ownerChoices" :key="person" :value="person">
              {{ person === me ? `${person} (you)` : person }}
            </option>
          </select>
          <span v-else class="follow-up-owner-value" data-testid="app-monitor-follow-up-owner">
            {{ current.followUpOwner?.email ?? '-' }}
          </span>
        </div>

        <!-- Above the answers, never behind the disclosure: it is something to act on (E27). -->
        <TableShareNotice
          v-if="current.tableShareNotice"
          :notice="current.tableShareNotice"
          :words="shareWords(current)"
          testid="app-monitor-table-share-notice"
          class="card-notice"
        />

        <!-- What this market said a reviewer reads first (E19/F03/S01). -->
        <dl v-if="leading.length" class="answers" data-testid="app-monitor-leading">
          <template v-for="answer in leading" :key="answer.key">
            <dt>{{ answer.label }}</dt>
            <dd><AnswerValue :value="answer.value" /></dd>
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
              <dt>{{ answer.label }}</dt>
              <dd><AnswerValue :value="answer.value" /></dd>
            </template>
          </dl>
        </details>

        <dl v-else-if="rest.length" class="answers" data-testid="app-monitor-answers">
          <template v-for="answer in rest" :key="answer.key">
            <dt>{{ answer.label }}</dt>
            <dd><AnswerValue :value="answer.value" /></dd>
          </template>
        </dl>
        <p v-else-if="!leading.length" class="no-answers">This application carries no answers.</p>

        <VendorNotes
          v-if="market"
          class="card-notes"
          :marketId="market.id"
          :email="current.applicantEmail"
          :entry="entryFor(current.applicantEmail)"
          :canWrite="!readOnly"
          :showRequest="false"
          testid="app-monitor-notes"
          @changed="loadNotes"
        />

        <!--
          Change what leads the card, from where the knowing happens (E19/F03/S02).

          Nothing here touches `cursor`, so a reviewer on card twelve stays on card twelve: the
          marks change what the card SHOWS, never which application is up.
        -->
        <div v-if="!readOnly" class="choose-highlights">
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

        <!-- A reader walks the queue with Next alone; the verdicts are a reviewer's. -->
        <div class="card-actions">
          <button
            v-if="decides"
            class="btn btn--destructive"
            :disabled="saving"
            @click="decideCurrent(ApplicationStatus.ReviewerRejected)"
            data-testid="app-monitor-reject-button"
          >
            Reject <kbd>R</kbd>
          </button>
          <button
            v-if="decides && current.status !== ApplicationStatus.NeedsFollowUp"
            class="btn btn--secondary"
            :disabled="saving"
            @click="followUpOpen = true"
            data-testid="app-monitor-follow-up-button"
          >
            Needs follow-up <kbd>S</kbd>
          </button>
          <button
            class="btn btn--secondary"
            :disabled="saving || (!refusedOn && undecided.length < 2)"
            @click="next"
            data-testid="app-monitor-next-button"
          >
            {{ refusedOn ? 'Back to the queue' : 'Next' }} <kbd>N</kbd>
          </button>
          <button
            v-if="decides"
            class="btn btn--primary"
            :disabled="saving"
            @click="decideCurrent(ApplicationStatus.ReviewerApproved)"
            data-testid="app-monitor-approve-button"
          >
            Approve <kbd>A</kbd>
          </button>
        </div>
      </div>

      <!-- Nothing to hand out: every card left is open with someone else (E34/F03/S02). -->
      <div v-else-if="allHeldElsewhere" class="done-state" data-testid="app-monitor-all-held">
        <p>
          Every application left is open with another reviewer<template v-if="holders.length"
            >: {{ holders.join(', ') }}</template
          >.
        </p>
        <button
          type="button"
          class="btn btn--secondary"
          data-testid="app-monitor-look-again"
          @click="takeNext(null)"
        >
          Look again
        </button>
      </div>

      <p v-else class="done-state" data-testid="app-monitor-done">
        <template v-if="followingUp.length">
          Nothing else to review; {{ followingUp.length }}
          {{ followingUp.length === 1 ? 'needs' : 'need' }} a follow-up.
        </template>
        <template v-else>Nothing left to review.</template>
      </p>

      <FollowUpDialog
        :open="followUpOpen"
        :applicantEmail="current?.applicantEmail ?? ''"
        :people="people"
        :me="me"
        :note="current ? (entryFor(current.applicantEmail)?.note ?? '') : ''"
        :error="followUpError"
        @close="followUpOpen = false"
        @confirm="markFollowUp"
      />

      <!-- Decided applications, so a verdict can be read back and corrected - one at a time. -->
      <div v-if="decided.length" class="decided">
        <button
          class="decided-toggle"
          :aria-expanded="showDecided"
          aria-controls="app-monitor-decided-list"
          @click="showDecided = !showDecided"
          data-testid="app-monitor-decided-toggle"
        >
          {{ showDecided ? 'Hide' : 'Show' }} {{ decided.length }} reviewed
        </button>
        <ul
          v-if="showDecided"
          id="app-monitor-decided-list"
          class="decided-list"
          data-testid="app-monitor-decided-list"
        >
          <li
            v-for="app in decided"
            :key="app.id"
            :class="{ named: app.id === named }"
            :data-application-id="app.id"
            data-testid="app-monitor-decided-row"
          >
            <span class="app-email" data-testid="app-monitor-decided-email">
              {{ app.applicantEmail }}
            </span>
            <span :class="statusChip(app.status)" data-testid="app-monitor-decided-status">
              {{ statusLabel(app.status) }}
            </span>
            <span
              v-if="givers.get(app.id)"
              class="verdict-giver"
              data-testid="app-monitor-decided-giver"
            >
              {{ givers.get(app.id) }}
            </span>
            <!-- The action is a quiet button beside the verdict, never a second verdict. -->
            <button
              v-if="decides && app.status === ApplicationStatus.ReviewerRejected"
              type="button"
              class="btn btn--secondary btn--compact"
              :disabled="saving"
              @click="decide(app, ApplicationStatus.ReviewerApproved)"
              data-testid="app-monitor-decided-approve-button"
            >
              Approve instead
            </button>
            <button
              v-else-if="decides && reDecidable(app)"
              type="button"
              class="btn btn--secondary btn--compact"
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
  padding: var(--space-4) 0;
}

.loading-state,
.empty-state,
.done-state {
  text-align: center;
  padding: var(--space-12);
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

.error-state {
  color: var(--mm-red);
  font-size: var(--text-sm);
  margin-bottom: var(--space-3);
}

.progress-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-3);
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
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-xs);
  line-height: 1.5;
  margin: 0 0 var(--space-4);
}

.review-card {
  border: 1.5px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: var(--mm-beige);
  padding: var(--space-4);
}

.card-head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-3);
}

.app-email {
  font-size: var(--text-sm);
  color: var(--mm-black);
  word-break: break-all;
}

/* The card is beige, where --mm-text-muted is 4.23: its quiet text takes the ink made for that
   ground (bug 43, found by the contrast sweep once it opened a review card). */
.app-date {
  font-size: var(--text-xs);
  color: var(--mm-text-muted-on-beige);
}

.changed-since {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-yellow);
  border-radius: var(--radius-control);
  background: var(--mm-chip-attention);
  font-size: var(--text-sm);
  color: var(--mm-text-yellow-on-tint);
}

.changed-since .verdict-giver {
  color: inherit;
}

.held-by {
  margin: var(--space-2) 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted-on-beige);
}

.include-follow-ups {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--mm-black);
}

/*
 * The select is as wide as its longest person, and no wider than the card. A fixed 20rem cut a
 * long address's "(you)" off against the chevron.
 */
.follow-up-owner {
  display: grid;
  grid-template-columns: auto minmax(0, max-content);
  justify-content: start;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

/* The owner a Viewer reads is a recorded fact, not a control: quiet, like the card's other
   read-only fields. */
.follow-up-owner-value {
  color: var(--mm-text-muted-on-beige);
  overflow-wrap: anywhere;
}

/* Who gave the verdict (E34/F01/S01): on the card's beige and on the decided list's rows alike. */
.verdict-giver {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted-on-beige);
}

.answers {
  display: grid;
  grid-template-columns: minmax(0, 13rem) minmax(0, 1fr);
  gap: var(--space-2) var(--space-4);
  margin: 0 0 var(--space-4);
  font-size: var(--text-sm);
}

.answers dt {
  color: var(--mm-text-muted-on-beige);
  overflow-wrap: anywhere;
}

.answers dd {
  margin: 0;
  color: var(--mm-black);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.card-notice {
  margin-bottom: var(--space-3);
}

.no-answers {
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  margin: 0 0 var(--space-4);
}

.card-notes {
  margin: 0 0 var(--space-4);
}

/* The unmarked answers. Set apart from the marked ones above it by a rule, so the card reads as
   "these first, then the rest" rather than as one long list that happens to fold. */
.answers-rest {
  margin: 0 0 var(--space-4);
  border-top: 1px solid var(--mm-border);
  padding-top: var(--space-3);
}

.answers-rest summary {
  font-size: var(--text-sm);
  color: var(--mm-text-muted-on-beige);
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  gap: var(--space-1);
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
  margin: var(--space-3) 0 0;
}

/* Changing what leads the card, from the queue. Quiet by default: the reviewer came here to
   judge applications, and this is the thing they reach for once. */
.choose-highlights {
  margin: 0 0 var(--space-4);
}

.choose-highlights-toggle {
  border: none;
  background: none;
  padding: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted-on-beige);
  cursor: pointer;
  text-decoration: underline;
}

.choose-highlights-toggle:hover {
  color: var(--mm-black);
}

.choose-highlights-body {
  margin-top: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: var(--mm-beige);
}

.choose-highlights-error {
  margin: var(--space-2) 0 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}

.card-actions {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.card-actions button {
  flex: 1 1 8rem;
}

/* A reader's Next alone stays a button's width rather than a bar across the card. */
.card-actions button:only-child {
  flex: 0 0 auto;
  margin-left: auto;
}

/* The verdicts are the primitives' (`.btn`): one height, one focus ring, one disabled state. */
.card-actions kbd {
  font-family: monospace;
  font-size: var(--text-xs);
  border: 1px solid color-mix(in srgb, currentColor 60%, transparent);
  border-radius: var(--radius-control);
  padding: 0 var(--space-1);
  margin-left: var(--space-1);
}

.decided {
  margin-top: var(--space-6);
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
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.decided-list li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
}

/* The application a link opened the page at. */
.decided-list li.named {
  border-color: var(--mm-green);
  outline: 1px solid var(--mm-green);
}

.decided-list .app-email {
  flex: 1 1 12rem;
  font-size: var(--text-sm);
}

@media (max-width: 640px) {
  .answers {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-hairline) 0;
  }

  .answers dd {
    margin-bottom: var(--space-3);
  }
}
</style>
