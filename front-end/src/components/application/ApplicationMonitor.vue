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
 * (`ApplicationsAll`, E34/F04/S02): rows the reviewer ticks, one by one or with Select all over the
 * rows shown (E38/F05/S02), and a confirmation naming the count - never "approve all matching" past
 * what is on screen, since the approved set is the solver's entire input (`assign_market` reads
 * `reviewer_approved` and nothing else).
 * The automatic rejections take the clear-cut cases first (E33/F03).
 * With reviewers chosen, the card names whose share it is, and deciding someone else's says so above
 * the verdicts (E38/F07/S03). A chosen reviewer is handed their own share first, and once it is done
 * is offered the rest (E38/F07/S04).
 * After a verdict, the line above the next card says what was decided and offers its giver Undo, by
 * click or Z, until their next verdict or the window ends (E38/F10/S01); "Show N reviewed" sits
 * beside the counts and opens the reviewed list in a dialog, newest verdict first (T217).
 */
import { MarketAction, actionRefusal, mayTake } from '@/utils/marketActions';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
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
import AppDialog from '@/components/AppDialog.vue';
import FollowUpDialog from '@/components/application/FollowUpDialog.vue';
import ListFrame from '@/components/ListFrame.vue';
import SearchPicker from '@/components/SearchPicker.vue';
import { PEOPLE_CAP, findsPerson, personOption } from '@/utils/personChoice';
import { useReviewHighlights } from '@/utils/reviewHighlights';
import { EMPTY_ESSENTIAL_OPTIONS, TABLE_SHARE_ANSWER_KEY } from '@/utils/essentialFields';
import ReviewHighlights from '@/components/application/ReviewHighlights.vue';
import AnswerUpdateNote from '@/components/AnswerUpdateNote.vue';
import ApplicationAnswers from '@/components/application/ApplicationAnswers.vue';
import { updateOf } from '@/utils/answerUpdates';
import TableShareNotice from '@/components/TableShareNotice.vue';
import ReadFailed from '@/components/ReadFailed.vue';
import EmailAddress from '@/components/EmailAddress.vue';
import VendorNotes from '@/components/VendorNotes.vue';
import { isDecided, statusChip, statusLabel, verdictGiverLine } from '@/utils/verdicts';
import { useVendorNotes } from '@/utils/vendorNotes';
import { useReviewClaims } from '@/utils/reviewClaims';
import {
  dealtElsewhere,
  dealtWarning,
  isChosen,
  myShare,
  othersLeftLine,
  reviewerLine,
} from '@/utils/reviewers';
import { useMarketStore } from '@/stores/market';
import ListFreshness from '@/components/application/ListFreshness.vue';
import { useVerdictActions, type VerdictOutcome } from '@/utils/verdictActions';
import { useVerdictUndo } from '@/utils/verdictUndo';
import VerdictUndoLine from '@/components/application/VerdictUndoLine.vue';
import { applicantName } from '@/utils/essentialFields';
import { getTimestampDate } from '@/utils/utils';

const props = defineProps<{
  market: Market | null;
  visible: boolean;
  /**
   * An application to open at, by id: an assignment refused for incomplete answers links to each
   * one it names (bug 42), so the organizer lands on that application rather than hunting for it.
   */
  named?: string;
  /** Counts the changes of reviewers: each one dealt applications anew, so the list is read again. */
  dealt?: number;
}>();

const applications = ref<Application[]>([]);
const loading = ref(false);
const errorMessage = ref('');
/** The list's own read that failed, which Try again reads once more (E38/F11/S01). */
const loadError = ref('');
/** When the list was last read from the server (E38/F05/S03), and a refresh's own state. */
const readAt = ref<number | null>(null);
const refreshing = ref(false);
const refreshError = ref('');
const saving = ref(false);
/** The application whose verdict or follow-up is being written, until the next card has answered. */
let deciding: string | null = null;
/**
 * A key pressed while `saving`, on a card other than the one being written: the next card shows as
 * soon as the verdict is answered, before the server has handed it over, so a reviewer can press on
 * it in that moment. It is played as `saving` ends, and a verdict only on the card it was pressed on.
 */
let heldKey: { undo: true } | { status: ApplicationStatus; on: string } | null = null;
/** Where in the undecided queue the reviewer is. Skipping moves it; a verdict does not. */
const cursor = ref(0);

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

/** Whether the dialog of the reviewed is open. Closed by default: the queue is for judging. */
const showingReviewed = ref(false);
/** The dialog's find field: forgotten on closing, set to an address by a link naming one. */
const reviewedWords = ref('');
/** A change of verdict that was not written, said in the dialog: the card behind is out of sight. */
const reviewedError = ref('');
const reviewedButton = ref<HTMLButtonElement>();
const reviewedDialog = ref<InstanceType<typeof AppDialog>>();
const REVIEWED_NOUN = { one: 'application', many: 'applications' };
const applicationKey = (app: Application) => app.id;

function findsReviewed(app: Application, words: string): boolean {
  const asked = words.toLowerCase();
  return (
    nameOf(app).toLowerCase().includes(asked) || app.applicantEmail.toLowerCase().includes(asked)
  );
}

/**
 * The words and any failure belong to this opening. A link opened it with no button pressed, so
 * nothing has been remembered to give focus back to: the button is where it would have started.
 */
function stopShowingReviewed() {
  if (!showingReviewed.value) return;
  showingReviewed.value = false;
  reviewedWords.value = '';
  reviewedError.value = '';
  void nextTick(() => {
    if (document.activeElement === document.body) reviewedButton.value?.focus();
  });
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
/**
 * The last hand-out answered with nothing (E34/F03/S02): no card is up for a reviewer, and the card
 * area says why - every one left is open with someone else, or their share is done (E38/F07/S04).
 */
const handedNothing = ref(false);
const current = computed<Application | undefined>(
  () =>
    (refusedOn.value ? applications.value.find((a) => a.id === refusedOn.value) : undefined) ??
    (handedNothing.value && decides.value ? undefined : undecided.value[cursor.value]),
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

/** Whether the marking dialog is open. Closed by default: the queue is for judging. */
const choosingHighlights = ref(false);

/** What a failed tick said was said in the dialog; the next opening starts clean. */
function stopChoosingHighlights() {
  choosingHighlights.value = false;
  highlightsError.value = '';
}

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

/**
 * Whether this person may change what leads the card - the form's row - on a market that can
 * change at all (bugs 30 and 37, E39/F01/S02).
 */
const marksHighlights = computed(() => mayTake(props.market, MarketAction.ChangeForm));
/** Whether this person may write the organizer's notes on the applicant up. */
const writesNotes = computed(() => mayTake(props.market, MarketAction.WriteVendorNotes));

/**
 * Whether this person may give verdicts here: the table's verdicts row (E34/F01/S01, E39/F01/S02)
 * while the review is open (E36/F01/S01). Viewers, archived markets and settled ones read the
 * applications and their verdicts.
 */
const decides = computed(
  () => mayTake(props.market, MarketAction.GiveVerdicts) && !props.market?.verdictsSettledReason,
);
/**
 * Whether this person may also change a verdict already given, an automatic rejection included:
 * the table's change row, on top of giving one (E38/F06/S01). Said once, above the reviewed list,
 * to a reviewer it refuses.
 */
const changes = computed(() => decides.value && mayTake(props.market, MarketAction.ChangeVerdicts));
const changeRefusal = computed(() =>
  decides.value && !changes.value ? actionRefusal(props.market, MarketAction.ChangeVerdicts) : null,
);
/**
 * Whether the card takes a verdict from this person: one someone else decided first (E34/F03/S01)
 * takes one only from someone who may change a verdict.
 */
const decidesCurrent = computed(
  () => decides.value && (changes.value || !current.value || !isDecided(current.value)),
);

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
/** The undo of the verdict just given (E38/F10/S01), on the line above the next card. */
const undo = useVerdictUndo(
  computed(() => props.market),
  adopt,
);
const { offered: undoOffered, refusal: undoRefusal, undoing } = undo;
/** Whose share the card is, while reviewers are chosen (E38/F07/S03). */
const currentReviewer = computed(() =>
  current.value ? reviewerLine(current.value, me.value, props.market) : null,
);
/** The reviewer an undecided card is dealt to, when not this person, for someone who decides it. */
const currentDealtElsewhere = computed(() =>
  current.value && decidesCurrent.value
    ? dealtElsewhere(current.value, me.value, props.market)
    : null,
);
/**
 * A chosen reviewer who decides is handed their own share first (E38/F07/S04): what is left of it,
 * and the rest of the queue. Anyone else, or everyone with nobody chosen, walks the whole queue.
 */
const sharing = computed(() => decides.value && isChosen(me.value, props.market));
const share = computed(() =>
  sharing.value ? myShare(undecided.value, me.value, props.market) : [],
);
const others = computed(() => undecided.value.filter((app) => !share.value.includes(app)));
/** Pressed "Help with the others": the hand-out goes on past their share. Entering forgets it. */
const helping = ref(false);
/** Asking for the share alone, until the reviewer chooses to help with the rest. */
const mineOnly = computed(() => sharing.value && !helping.value);
/** What the reviewer walks now: their share, or the whole queue. */
const walked = computed(() => (mineOnly.value ? share.value : undecided.value));
/** Their share has nothing left to decide and others' do: said so, with the offer to help. */
const shareDone = computed(
  () => mineOnly.value && handedNothing.value && !share.value.length && others.value.length > 0,
);
/** Where the card up is in what the reviewer walks, or how many are left with none up. */
const progress = computed(() => {
  const card = current.value;
  if (!undecided.value.length) return null;
  if (!card && mineOnly.value && share.value.length) return `${share.value.length} in your share`;
  if (!card) return `${undecided.value.length} to review`;
  const inShare = share.value.findIndex((app) => app.id === card.id);
  if (inShare >= 0) return `${inShare + 1} of ${share.value.length} in your share`;
  const inRest = others.value.findIndex((app) => app.id === card.id);
  return inRest >= 0
    ? `${inRest + 1} of ${others.value.length} to review`
    : `${cursor.value + 1} of ${undecided.value.length} to review`;
});

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
const ownerGroups = computed(() => [{ options: ownerChoices.value.map(personOption) }]);

/** The hand-on under way: the field names them, and names the owner again if it is refused. */
const handingOn = shallowRef<{ applicationId: string; email: string } | null>(null);
const followedUpBy = computed(() => {
  const app = current.value;
  if (app && handingOn.value?.applicationId === app.id) return handingOn.value.email;
  return app?.followUpOwner?.email ?? '';
});

/**
 * The card a reviewer holds (E34/F03/S02): handed out by the server, so two reviewers walk different
 * cards. Someone who may only read walks the queue here, as before, holding nothing.
 */
const claims = useReviewClaims(computed(() => props.market?.id ?? ''));
/** Every card left - of their share, while on it - is open with another reviewer. */
const allHeldElsewhere = computed(
  () => handedNothing.value && !shareDone.value && walked.value.length > 0,
);
/** Who holds the cards nobody can be handed, for the line that says so. */
const holders = computed(() => [
  ...new Set(walked.value.map((app) => app.heldBy?.email).filter(Boolean) as string[]),
]);
// Taking the follow-ups into the walk, or leaving them out, changes what can be handed out: with no
// card up, or the one held left out of the queue, the reviewer is handed the next. A hand-out still
// out was asked of the walk as it was, so it is asked again of this one, which overtakes it: marking
// the last card a follow-up and taking the follow-ups straight back in must put that card up.
watch(includeFollowUps, () => {
  if (!decides.value) return;
  if (asking) {
    void takeNext(asking.after, asking.want);
    return;
  }
  const held = claims.held.value;
  const heldLeftOut = held !== null && !undecided.value.some((app) => app.id === held);
  if (handedNothing.value || heldLeftOut) void takeNext(held);
});

/** Someone else has the card on screen open: a reader's walk passes cards being decided. */
const heldByOther = computed(() => {
  const holder = current.value?.heldBy?.email;
  return holder && holder.toLowerCase() !== me.value.toLowerCase() ? holder : null;
});

/**
 * Bumped by every hand-out, so only the newest puts its card up (the Next race, E38/F07/S04): a Next
 * pressed again, a verdict, a refresh or a load can each ask while another is in flight, and their
 * answers come back in either order.
 */
let handing = 0;

/** What the newest hand-out was asked, until it has put its card up; null with none out. */
let asking: { after: string | null; want: string | null } | null = null;

/** Bumped by every load, so a load overtaken by a later one (leaving and coming back) stops. */
let loads = 0;

// Reload the queue when the surface is shown or a different MARKET opens - not whenever the store
// re-reads this one. It re-reads after every write now (E21/F02/S02), a verdict and a highlight
// toggle included, and reloading on each would put the reviewer back on the first card mid-queue.
// Two sources, each compared on its own: one getter answering a new array each time would fire on
// every re-read.
watch(
  [() => props.visible, () => props.market?.id],
  async ([visible]) => {
    if (visible && props.market) await loadApplications();
    // Leaving the review lets the held card go at once, not five minutes later.
    else if (!visible) claims.release();
  },
  { immediate: true },
);

/**
 * Open at the named application: on the card if it is still to decide - claimed for a reviewer,
 * unless someone else has it - otherwise in the reviewed dialog, found by its address, however far
 * down the list it lies, and marked.
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
  const app = decided.value.find((reviewedApp) => reviewedApp.id === id);
  if (!app) return;
  reviewedWords.value = app.applicantEmail;
  showingReviewed.value = true;
}

/** Put the next card up: the server's to hand out for a reviewer, the queue's own for a reader. */
async function takeNext(after: string | null, want: string | null = null) {
  if (!decides.value || !props.market) {
    if (undecided.value.length) cursor.value = (cursor.value + 1) % undecided.value.length;
    return;
  }
  const mine = ++handing;
  asking = { after, want };
  try {
    const app = await claims.next(after, includeFollowUps.value, want, mineOnly.value);
    // Overtaken by a later hand-out, or the review was left: its card is not the one to put up.
    if (app === undefined) return;
    if (app) adopt(app);
    // Nothing handed out: read who holds what now, to say so.
    else await read();
    if (mine !== handing) return;
    handedNothing.value = !app;
    cursor.value = app
      ? Math.max(
          undecided.value.findIndex((a) => a.id === app.id),
          0,
        )
      : 0;
  } catch (err) {
    if (mine !== handing) return;
    errorMessage.value = getApiErrorMessage(err, 'Could not open the next application.');
  } finally {
    if (mine === handing) asking = null;
  }
}

/** "Help with the others": on past the reviewer's done share, through the rest (E38/F07/S04). */
function helpOthers() {
  helping.value = true;
  void takeNext(null);
}

/**
 * The one read of the list, and when it was. Answers the card that was up as the list was replaced,
 * which a hand-out answering during the read may have moved on.
 */
async function read(): Promise<string | null> {
  if (!props.market) return null;
  const fresh = await fetchMarketApplications(props.market.id);
  const up = current.value?.id ?? null;
  applications.value = fresh;
  readAt.value = Date.now();
  refreshError.value = '';
  loadError.value = '';
  return up;
}

async function loadApplications() {
  if (!props.market) return;
  const mine = ++loads;
  loading.value = true;
  errorMessage.value = '';
  loadError.value = '';
  helping.value = false;
  try {
    await read();
    if (mine !== loads) return;
    cursor.value = 0;
    if (props.named) await showNamed();
    else if (decides.value) await takeNext(null);
  } catch (err) {
    if (mine === loads) {
      loadError.value = getApiErrorMessage(err, 'The applications could not be loaded.');
    }
  } finally {
    if (mine === loads) loading.value = false;
  }
}

/**
 * Refresh (E38/F05/S03): the counts, others' verdicts and who holds what, read again at once. The
 * list is otherwise kept in step with this reviewer's own verdicts, so others' show only here, or
 * when no card can be handed out. A re-read, not a reset: the card up stays up while it is still to
 * decide - the reviewer holds it - and one decided elsewhere meanwhile gives way to the next. A
 * failed refresh says so beside the button and keeps the list.
 */
async function refresh() {
  if (!props.market || refreshing.value || saving.value) return;
  refreshing.value = true;
  let up: string | null;
  try {
    up = await read();
    void useMarketStore().refresh();
  } catch {
    refreshError.value = 'Could not refresh. The list is as it was last read.';
    return;
  } finally {
    refreshing.value = false;
  }
  // A refused verdict's card stays as it now stands, until the reviewer moves on: its message is
  // the card's. Any other error was the last read's or the last hand-out's, which this one replaces.
  if (refusedOn.value) return;
  errorMessage.value = '';
  const at = up ? undecided.value.findIndex((app) => app.id === up) : -1;
  if (at >= 0) cursor.value = at;
  else if (decides.value) await takeNext(null);
  else cursor.value = Math.min(cursor.value, Math.max(undecided.value.length - 1, 0));
}

/**
 * After a verdict, a follow-up or a refusal on the card: what the card does next.
 *
 * The local list is kept in step with the answer rather than refetched: a refetch per verdict is 232
 * fetches of 232 applications across one review session.
 */
async function settle(app: Application, outcome: VerdictOutcome) {
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
  deciding = app.id;
  errorMessage.value = '';
  const before = { ...app };
  try {
    const outcome = await verdicts.give(app, status);
    offerUndo(before, outcome, status);
    await settle(app, outcome);
  } finally {
    deciding = null;
    saving.value = false;
  }
}

/**
 * What failed with no dialog left to say it in: beside what the card already says, which on a refused
 * card is who decided it first, and only once however many times it fails that way.
 */
function sayBesideTheCard(words: string) {
  if (!errorMessage.value.includes(words)) {
    errorMessage.value = `${errorMessage.value} ${words}`.trim();
  }
}

/**
 * "Approve instead" or "Reject instead" in the dialog (T217). The dialog stays open and the card
 * behind stays up, its words with it: what was refused is said here, in sight. The one card this
 * moves is a refused one whose own row was changed, since deciding it again is what it waits for.
 *
 * The pressed button goes disabled and then goes for good with the status, and the row itself moves
 * to the top as the newest verdict, so focus waits on the row and lands on its new button; left
 * alone it would fall to `<body>`, with Tab starting over from the top of the dialog.
 */
async function changeVerdict(app: Application, status: ApplicationStatus, event: Event) {
  if (!props.market || saving.value) return;
  const row = (event.currentTarget as HTMLElement).closest<HTMLElement>('li');
  row?.focus({ preventScroll: true });
  saving.value = true;
  deciding = app.id;
  reviewedError.value = '';
  const before = { ...app };
  try {
    const outcome = await verdicts.give(app, status);
    offerUndo(before, outcome, status);
    if (outcome.kind !== 'written') {
      // Closed with the answer still out: said where the reviewer now is, and which one, since the
      // card up is another application and its "this application" would read as that one.
      if (showingReviewed.value) reviewedError.value = outcome.message;
      else sayBesideTheCard(`${app.applicantEmail} was not changed: ${outcome.message}`);
    } else if (app.id === refusedOn.value) {
      errorMessage.value = '';
      await settle(app, outcome);
    }
  } finally {
    deciding = null;
    saving.value = false;
  }
  await nextTick();
  if (row?.isConnected) (row.querySelector('button') ?? row).focus();
  // The answer can take the row from the list, when someone else reopened it meanwhile, and its focus
  // with it. A row closed away has left focus where the closing gave it, which stays.
  else if (document.activeElement === document.body) await reviewedDialog.value?.focusInside();
}

/**
 * A verdict written replaces the undo on offer with its own (E38/F10/S01); one that changed a
 * verdict - "Approve instead" - offers none, and still takes the last one's away.
 */
function offerUndo(before: Application, outcome: VerdictOutcome, status: ApplicationStatus) {
  if (outcome.kind !== 'written') return;
  undo.offerOne(before, outcome.application, status, outcome.undoSeconds);
}

/**
 * Undo the verdict on offer: the application comes back as the card up, at what it was, held for
 * this reviewer as any card handed out is. A refusal stays on the line.
 */
async function undoLast() {
  if (saving.value) return;
  saving.value = true;
  try {
    const outcome = await undo.undo();
    if (outcome.kind !== 'undone') return;
    const back = outcome.applications[0];
    refusedOn.value = null;
    errorMessage.value = '';
    if (back) await takeNext(null, back.id);
  } finally {
    saving.value = false;
  }
}

function decideCurrent(status: ApplicationStatus) {
  if (current.value) void decide(current.value, status);
}

/**
 * Keep a key pressed while `saving`, the last one winning. A key on the card still being written is
 * not kept: that card is already being answered, so the key has nothing to wait for and needs no word.
 */
function holdKey(key: NonNullable<typeof heldKey>) {
  if (current.value?.id !== deciding) heldKey = key;
}

/** The server has answered: do what the held key asked, or say it did not count. */
watch(saving, (busy) => {
  const key = heldKey;
  if (busy || !key) return;
  heldKey = null;
  if (!props.visible) return;
  if ('undo' in key) {
    // Opening a dialog is the reviewer's own choice, as N is: the undo stays on offer on its line.
    if (!dialogOverCard.value && undoOffered.value && !undoRefusal.value) void undoLast();
    return;
  }
  const app = current.value;
  // Held for the reviewer is what makes it handed over: a hand-out overtaken ends `saving` with the
  // newer one still out, and the card up then is only the queue's guess, which may be someone else's.
  const handedOver = app?.id === key.on && claims.held.value === key.on;
  if (!errorMessage.value && handedOver && decidesCurrent.value && !dialogOverCard.value) {
    void decide(app, key.status);
    return;
  }
  const again = app ? ' Press it again on this card.' : '';
  errorMessage.value = `${errorMessage.value} That key did not count.${again}`.trim();
});

/**
 * On to the next card without a verdict: it stays in the queue, so the count of work left does not
 * lie. Skip did this and recorded nothing; marking a follow-up is S now, and this is N.
 */
function next() {
  // Moving on is the reviewer's last word: a held verdict stays unwritten, and a held Z unplayed,
  // since it would bring the undone card back over this one. The undo stays on offer on its line.
  heldKey = null;
  if (refusedOn.value) {
    const after = refusedOn.value;
    refusedOn.value = null;
    errorMessage.value = '';
    void takeNext(after);
    return;
  }
  if (undecided.value.length === 0 && !handedNothing.value) return;
  // What the last card's verdict or hand-out said is not this card's.
  errorMessage.value = '';
  void takeNext(current.value?.id ?? null);
}

/**
 * Needs follow-up, in place of Skip, which recorded nothing (E34/F02/S01): a stored status, owned by
 * the reviewer unless they name someone else with a role on the market, with what is needed kept
 * in the vendor's notes - which the dialog opens on, so nothing there is written over.
 */
const followUpOpen = ref(false);
const followUpError = ref('');

/** A dialog is open over the card: its own controls have the keyboard, and no key reaches the card. */
const dialogOverCard = computed(
  () => followUpOpen.value || choosingHighlights.value || showingReviewed.value,
);

async function markFollowUp(choice: { ownerEmail: string; note?: string }) {
  const app = current.value;
  if (!app || saving.value) return;
  followUpError.value = '';
  saving.value = true;
  deciding = app.id;
  const before = { ...app };
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
    offerUndo(before, outcome, ApplicationStatus.NeedsFollowUp);
    await settle(app, outcome);
  } finally {
    deciding = null;
    saving.value = false;
  }
}

async function reassign(app: Application, ownerEmail: string) {
  if (!props.market || ownerEmail === followedUpBy.value) return;
  errorMessage.value = '';
  const handing = { applicationId: app.id, email: ownerEmail };
  handingOn.value = handing;
  try {
    adopt(await reassignFollowUp(props.market.id, app.id, ownerEmail));
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Could not hand the follow-up over.');
  } finally {
    if (handingOn.value === handing) handingOn.value = null;
  }
}

/**
 * The keys: A, R and S decide - a reviewer's - N moves on, for anyone walking the queue, and Z
 * undoes the verdict on offer, with a card up or none left.
 */
function onKey(event: KeyboardEvent) {
  if (!props.visible) return;
  if (dialogOverCard.value) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) {
    return;
  }
  const key = event.key.toLowerCase();
  // A verdict or an undo is one press: a long press would decide card after card, unseen.
  if (event.repeat && (key === 'a' || key === 'r' || key === 'z')) return;
  if (key === 'z' && undoOffered.value && !undoRefusal.value) {
    event.preventDefault();
    if (saving.value) holdKey({ undo: true });
    else void undoLast();
    return;
  }
  if (!current.value) return;
  if (key === 'n') {
    event.preventDefault();
    next();
    return;
  }
  if (!decidesCurrent.value || (key !== 'a' && key !== 'r' && key !== 's')) return;
  event.preventDefault();
  if (key === 'a' || key === 'r') {
    const status =
      key === 'a' ? ApplicationStatus.ReviewerApproved : ApplicationStatus.ReviewerRejected;
    if (saving.value) holdKey({ status, on: current.value.id });
    else decideCurrent(status);
  }
  // S was Skip; it marks the follow-up now, the dialog asking who and what (E34/F02/S01).
  if (key === 's' && current.value.status !== ApplicationStatus.NeedsFollowUp) {
    followUpOpen.value = true;
  }
}

/** Anything the reviewer does keeps their card theirs (E34/F03/S02). */
function active() {
  claims.touch();
}

watch(
  () => props.dealt,
  () => void refresh(),
);

// The dialog belongs to this view of this market, for someone who may mark: left open, it would
// come back with the view and hold the keys from a card it no longer lies over.
watch([() => props.visible, () => props.market?.id, marksHighlights], stopChoosingHighlights);
watch([() => props.visible, () => props.market?.id], stopShowingReviewed);

// A tick still being written when Done was pressed has no dialog left to say it failed in.
watch(highlightsError, (words) => {
  if (!words || choosingHighlights.value) return;
  sayBesideTheCard(words);
  highlightsError.value = '';
});

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

/** What the card and the reviewed list call the applicant: the name their answers give. */
function nameOf(app: Application): string {
  return applicantName(app.formData as Record<string, unknown> | undefined);
}

function submittedOn(app: Application): string {
  return getTimestampDate(app.submittedAt);
}
</script>

<template>
  <div v-if="visible && market" class="monitor-panel" data-testid="app-monitor-panel">
    <ListFreshness
      v-if="!loading"
      class="monitor-freshness"
      :readAt="readAt"
      :refreshing="refreshing || saving"
      :failed="refreshError"
      @refresh="refresh"
    />
    <ReadFailed
      v-if="loadError"
      name="applications"
      :message="loadError"
      @retry="loadApplications"
    />
    <p v-if="errorMessage && !refusedOn" class="error-state" data-testid="app-monitor-error">
      {{ errorMessage }}
    </p>

    <div v-if="loading" class="loading-state" data-testid="app-monitor-loading">
      Loading applications...
    </div>

    <!-- Said of a list that was read: under a failed load there is nothing to say it of. -->
    <template v-else-if="applications.length === 0">
      <div v-if="!errorMessage && !loadError" class="empty-state" data-testid="app-monitor-empty">
        No applications received yet.
      </div>
    </template>

    <template v-else>
      <div class="progress-row">
        <span class="progress" data-testid="app-monitor-progress">
          <template v-if="progress">{{ progress }}</template>
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
        <span class="counts">
          <span class="tally" data-testid="app-monitor-tally">
            {{ decided.length }} reviewed<template v-if="verdictsStillLegible">
              · {{ approvedCount }} approved · {{ rejectedCount }} rejected</template
            >
          </span>
          <!-- Beside the counts, above the card, so a past verdict is found without a scroll
               (E38/F10/S01). -->
          <button
            v-if="decided.length"
            ref="reviewedButton"
            type="button"
            class="decided-open"
            data-testid="app-monitor-decided-open"
            @click="showingReviewed = true"
          >
            Show {{ decided.length }} reviewed
          </button>
        </span>
      </div>

      <!-- The verdict just given, and its Undo, under the counts and over the next card
           (E38/F10/S01). -->
      <VerdictUndoLine
        v-if="undoOffered"
        class="monitor-undo"
        :line="undoOffered.line"
        :refusal="undoRefusal"
        :busy="undoing || saving"
        shortcut="Z"
        testid="app-monitor-undo"
        @undo="undoLast"
      />

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
        <!-- The card is headed by the applicant's name, else their address, so the notes' h3
             labels sit one level under it (T95 note 6), as they do under the drawer's title. -->
        <div class="card-head">
          <h2 v-if="nameOf(current)" class="app-name" data-testid="app-monitor-name">
            {{ nameOf(current) }}
          </h2>
          <component
            :is="nameOf(current) ? 'span' : 'h2'"
            class="app-email"
            data-testid="app-monitor-email"
          >
            {{ current.applicantEmail }}
          </component>
          <span :class="statusChip(current.status)" data-testid="app-monitor-status">
            {{ statusLabel(current.status) }}
          </span>
          <span v-if="submittedOn(current)" class="app-date">{{ submittedOn(current) }}</span>
        </div>
        <p v-if="currentReviewer" class="card-reviewer" data-testid="app-monitor-reviewer">
          <EmailAddress :words="currentReviewer" />
        </p>
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
        <template v-if="current.status === ApplicationStatus.NeedsFollowUp">
          <SearchPicker
            v-if="decides"
            class="follow-up-owner-picker"
            :model-value="followedUpBy"
            :groups="ownerGroups"
            :finds="findsPerson"
            :cap="PEOPLE_CAP"
            holds-choice
            label="Followed up by"
            placeholder="Type an address…"
            testid="app-monitor-follow-up-owner"
            @update:model-value="reassign(current, $event as string)"
          />
          <div v-else class="follow-up-owner">
            <span>Followed up by</span>
            <span class="follow-up-owner-value" data-testid="app-monitor-follow-up-owner">
              {{ current.followUpOwner?.email ?? '-' }}
            </span>
          </div>
        </template>

        <!-- Above the answers, never behind the disclosure: it is something to act on (E27). -->
        <TableShareNotice
          v-if="current.tableShareNotice"
          :notice="current.tableShareNotice"
          :words="shareWords(current)"
          testid="app-monitor-table-share-notice"
          class="card-notice"
        />

        <!-- What this market said a reviewer reads first (E19/F03/S01), then the rest. The open
             state is kept for the whole session: at card forty, reopening it each time is a tax on
             the person doing the work. -->
        <ApplicationAnswers
          v-model:restOpen="restOpen"
          class="card-answers"
          :leading="leading"
          :rest="rest"
          testid="app-monitor"
        >
          <!-- An organizer's update reads in its place, and says so (E41/F01/S01). -->
          <template #note="{ answer }">
            <AnswerUpdateNote
              :update="updateOf(current, answer.key)"
              :testid="`app-monitor-answer-${answer.key}`"
            />
          </template>
        </ApplicationAnswers>
        <p v-if="!leading.length && !rest.length" class="no-answers">
          This application carries no answers.
        </p>

        <VendorNotes
          v-if="market"
          class="card-notes"
          :marketId="market.id"
          :email="current.applicantEmail"
          :entry="entryFor(current.applicantEmail)"
          :canWrite="writesNotes"
          :showRequest="false"
          testid="app-monitor-notes"
          @changed="loadNotes"
        />

        <!-- Change what leads the card, from where the knowing happens (E19/F03/S02). -->
        <div v-if="marksHighlights" class="choose-highlights">
          <button
            type="button"
            class="choose-highlights-open"
            data-testid="app-monitor-choose-highlights"
            @click="choosingHighlights = true"
          >
            Choose what leads the card
          </button>
        </div>

        <!-- A reader walks the queue with Next alone; the verdicts are a reviewer's. -->
        <p
          v-if="decides && !decidesCurrent"
          class="change-reason"
          data-testid="app-monitor-card-change-reason"
        >
          {{ changeRefusal }}
        </p>
        <!-- On every such card, never a dialog to click through: a helper reads whose each one is. -->
        <p
          v-if="currentDealtElsewhere"
          class="dealt-warning"
          data-testid="app-monitor-dealt-warning"
        >
          <EmailAddress :words="dealtWarning(currentDealtElsewhere)" />
        </p>
        <div class="card-actions">
          <button
            v-if="decidesCurrent"
            class="btn btn--destructive"
            :disabled="saving"
            @click="decideCurrent(ApplicationStatus.ReviewerRejected)"
            data-testid="app-monitor-reject-button"
          >
            Reject <kbd>R</kbd>
          </button>
          <button
            v-if="decidesCurrent && current.status !== ApplicationStatus.NeedsFollowUp"
            class="btn btn--secondary"
            :disabled="saving"
            @click="followUpOpen = true"
            data-testid="app-monitor-follow-up-button"
          >
            Needs follow-up <kbd>S</kbd>
          </button>
          <button
            class="btn btn--secondary"
            :disabled="saving || (!refusedOn && walked.length < 2)"
            @click="next"
            data-testid="app-monitor-next-button"
          >
            {{ refusedOn ? 'Back to the queue' : 'Next' }} <kbd>N</kbd>
          </button>
          <button
            v-if="decidesCurrent"
            class="btn btn--primary"
            :disabled="saving"
            @click="decideCurrent(ApplicationStatus.ReviewerApproved)"
            data-testid="app-monitor-approve-button"
          >
            Approve <kbd>A</kbd>
          </button>
        </div>
      </div>

      <!-- The reviewer's share is decided: the rest are others', theirs to help with (E38/F07/S04). -->
      <div v-else-if="shareDone" class="done-state" data-testid="app-monitor-share-done">
        <p class="share-done">Your share is done.</p>
        <p data-testid="app-monitor-share-done-others">{{ othersLeftLine(others.length) }}</p>
        <button
          type="button"
          class="btn btn--secondary"
          data-testid="app-monitor-help-others"
          @click="helpOthers"
        >
          Help with the others
        </button>
      </div>

      <!-- Nothing to hand out: every card left is open with someone else (E34/F03/S02). -->
      <div v-else-if="allHeldElsewhere" class="done-state" data-testid="app-monitor-all-held">
        <p>
          Every application left{{ mineOnly ? ' in your share' : '' }} is open with another
          reviewer<template v-if="holders.length">: {{ holders.join(', ') }}</template
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
        :writesNotes="writesNotes"
        :error="followUpError"
        @close="followUpOpen = false"
        @confirm="markFollowUp"
      />
    </template>

    <!--
      Beside the card rather than in it, so a card that goes while it is open takes nothing with it.

      Nothing here touches `cursor`, so a reviewer on card twelve stays on card twelve: the marks
      change what the card SHOWS, never which application is up. Each tick is saved as it is made, so
      there is a Done and no Cancel, which would promise an undo the ticks do not have.
    -->
    <AppDialog
      :open="choosingHighlights"
      title="Choose what leads the card"
      testid="choose-highlights"
      size="wide"
      scroll="body"
      :error="highlightsError"
      @close="stopChoosingHighlights"
    >
      <ReviewHighlights
        :fields="market?.applicationForm?.fields ?? []"
        :essentialOptions="essentialOptions"
        :highlights="highlights"
        @update:highlights="saveHighlights"
      />
      <template #actions>
        <button
          type="button"
          class="btn btn--primary"
          data-testid="choose-highlights-done"
          @click="stopChoosingHighlights"
        >
          Done
        </button>
      </template>
    </AppDialog>

    <!--
      Decided applications, newest verdict first, so a verdict can be read back, and changed one at
      a time by whoever the change row lets change one (E38/F06/S01). Beside the card, as the dialog
      above is. The frame's words stay in this dialog, never in the address, which they would outlive.
    -->
    <AppDialog
      ref="reviewedDialog"
      :open="showingReviewed"
      title="Reviewed applications"
      testid="app-monitor-decided"
      size="wide"
      scroll="body"
      anchored
      :error="reviewedError"
      @close="stopShowingReviewed"
    >
      <p
        v-if="changeRefusal"
        class="change-reason change-reason--list"
        data-testid="app-monitor-decided-reason"
      >
        {{ changeRefusal }}
      </p>
      <ListFrame
        v-model:words="reviewedWords"
        :items="decided"
        :finds="findsReviewed"
        :itemKey="applicationKey"
        :noun="REVIEWED_NOUN"
        findLabel="Find by name or address"
        testid="app-monitor-decided-list"
      >
        <template #row="{ item: app }">
          <div
            class="decided-row"
            :class="{ named: app.id === named }"
            data-testid="app-monitor-decided-row"
          >
            <span class="decided-who">
              <span v-if="nameOf(app)" class="app-name" data-testid="app-monitor-decided-name">
                {{ nameOf(app) }}
              </span>
              <span class="app-email" data-testid="app-monitor-decided-email">
                {{ app.applicantEmail }}
              </span>
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
            <!-- The action is a quiet button beside the verdict, never a second verdict, and never
                 what the dialog opens on, which one stray Enter would make. -->
            <button
              v-if="changes && app.status === ApplicationStatus.ReviewerRejected"
              type="button"
              class="btn btn--secondary btn--compact"
              :disabled="saving"
              data-dialog-not-first
              data-testid="app-monitor-decided-approve-button"
              @click="changeVerdict(app, ApplicationStatus.ReviewerApproved, $event)"
            >
              Approve instead
            </button>
            <button
              v-else-if="changes && isDecided(app)"
              type="button"
              class="btn btn--secondary btn--compact"
              :disabled="saving"
              data-dialog-not-first
              data-testid="app-monitor-decided-reject-button"
              @click="changeVerdict(app, ApplicationStatus.ReviewerRejected, $event)"
            >
              Reject instead
            </button>
          </div>
        </template>
      </ListFrame>
    </AppDialog>
  </div>
</template>

<style scoped>
.monitor-panel {
  /* No top padding: it starts where the All view does, so switching views moves nothing. */
  padding: 0 0 var(--space-4);
}

.monitor-freshness {
  margin-bottom: var(--space-4);
}

.loading-state,
.empty-state,
.done-state {
  text-align: center;
  padding: var(--space-12);
  color: var(--mm-text-muted);
  font-size: var(--text-sm);
}

/* A state that offers something to do: its lines, then the button, set apart. */
.done-state .btn {
  margin-top: var(--space-4);
}

/* What the reviewer has finished, said first and plainly; what is left reads under it. */
.share-done {
  color: var(--mm-black);
  font-weight: 600;
}

.error-state {
  color: var(--mm-red);
  font-size: var(--text-sm);
  margin-bottom: var(--space-3);
  overflow-wrap: anywhere;
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

/* The counts and "Show N reviewed", kept together at the row's end. */
.counts {
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
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

/* The card's heading keeps its line's type: no heading margin, and an address stays regular. */
.card-head h2 {
  margin: 0;
}

.card-head h2.app-email {
  font-weight: inherit;
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

/* Whose share the card is (E38/F07/S03): a quiet fact under its status. */
.card-reviewer {
  margin: calc(-1 * var(--space-2)) 0 var(--space-3);
  font-size: var(--text-xs);
  color: var(--mm-text-muted-on-beige);
  overflow-wrap: anywhere;
}

/* Deciding someone else's share (E38/F07/S03): a notice right above the verdicts. */
.dealt-warning {
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-yellow);
  border-radius: var(--radius-control);
  background: var(--mm-chip-attention);
  font-size: var(--text-sm);
  color: var(--mm-text-yellow-on-tint);
  overflow-wrap: anywhere;
}

.changed-since .verdict-giver {
  color: inherit;
}

/* Why a verdict already given is not this reviewer's to change (E38/F06/S01): over the reviewed
   list, on white, and on the card, on beige. */
.change-reason {
  margin: var(--space-3) 0 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.change-reason--list {
  margin: 0;
}

.review-card .change-reason {
  color: var(--mm-text-muted-on-beige);
}

.held-by {
  margin: var(--space-2) 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted-on-beige);
}

/* Beside the tally, so it stays put whatever the progress line says. Its label is the target, the
   box inside it. */
.include-follow-ups {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--target-min);
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--mm-black);
}

/* A Viewer's "Followed up by": the words, then the address, wrapping within the card. */
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

/* The chooser is as wide as a long address needs, and no wider than the card. On the card's beige
   its label reads in the card's own ink, where the plain muted ink falls below AA. */
.follow-up-owner-picker {
  max-width: 28rem;
  margin-bottom: var(--space-3);
}

.follow-up-owner-picker :deep(.field-label) {
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

/* The answers lay themselves out (`ApplicationAnswers`); the card spaces them from the notes. */
.card-answers {
  margin-bottom: var(--space-4);
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

/* Changing what leads the card, from the queue. Quiet by default: the reviewer came here to
   judge applications, and this is the thing they reach for once. */
.choose-highlights {
  margin: 0 0 var(--space-4);
}

.choose-highlights-open {
  --focus-border-offset: var(--focus-border-width);
  border: none;
  background: none;
  padding: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted-on-beige);
  cursor: pointer;
  text-decoration: underline;
}

.choose-highlights-open:hover {
  color: var(--mm-black);
}

/* A thumb's target on a phone (T180). Its minimum is a phone rule, since on a desk a 24px box would
   push the card's verdicts 9px down. */
@media (width <= 640px) {
  .choose-highlights-open {
    min-height: var(--target-min);
  }
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

/* The verdicts are the primitives' (`.btn`): one height, one focus border, one disabled state. */
.card-actions kbd {
  font-family: monospace;
  font-size: var(--text-xs);
  border: 1px solid color-mix(in srgb, currentColor 60%, transparent);
  border-radius: var(--radius-control);
  padding: 0 var(--space-1);
  margin-left: var(--space-1);
}

.monitor-undo {
  margin-bottom: var(--space-3);
}

/* The applicant's name heads the card and leads a reviewed row; the address follows it. */
.app-name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.decided-who {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 var(--space-2);
  min-width: 0;
}

.decided-open {
  --focus-border-offset: var(--focus-border-width);
  min-height: var(--target-min);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--mm-green);
  text-decoration: underline;
}

/* Who and the verdict, then who gave it and the change, each change at its row's end. */
.decided-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
}

/* The application a link opened the page at. */
.decided-row.named {
  border-color: var(--mm-green);
  outline: 1px solid var(--mm-green);
}

.decided-row .app-email {
  font-size: var(--text-sm);
}

.decided-row .chip {
  justify-self: end;
}

.decided-row .btn {
  grid-column: 2;
}

/* A phone gives the giver's line the row's width, and the change a line of its own. */
@media (width <= 640px) {
  .decided-row .verdict-giver {
    grid-column: 1 / -1;
  }

  .decided-row .btn {
    grid-column: 1 / -1;
    justify-self: start;
  }
}
</style>
