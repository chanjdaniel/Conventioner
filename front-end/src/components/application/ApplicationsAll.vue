<script setup lang="ts">
/**
 * Every application at once (E34/F04/S01), beside the one-by-one review.
 *
 * A row is an application: who, the answers a reviewer reads first, its status, who gave it, and who
 * holds it open. Filtered by status - follow-ups among them - and by Mine, the follow-ups the viewer
 * owns, all in the address. A row opens the vendor drawer, which carries Approve, Reject and Needs
 * follow-up while the market is still deciding, each written only on what the reviewer saw. Export
 * opens the vendor export on the filter and Mine (E42/F01/S03), so the review's lists leave as a CSV.
 * With reviewers chosen, a row names whose share it is, and deciding someone else's says so in the
 * drawer and in a selection's confirmation (E38/F07/S03); "Assigned to" narrows the rows to one
 * reviewer's share, and a chosen reviewer lands on their own (E38/F07/S04).
 */
import { MarketAction, actionRefusal, mayTake } from '@/utils/marketActions';
import { whoMayTake } from '@/utils/permissionTable';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter, type LocationQuery } from 'vue-router';
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import {
  fetchMarketApplications,
  reviewSelection,
  type SelectionResult,
} from '@/utils/applicantApi';
import { getApiErrorMessage } from '@/utils/api';
import { applicantName } from '@/utils/essentialFields';
import {
  ALL_VIEW_FILTERS,
  allViewApplications,
  allViewFilter,
  heldElsewhere as heldBySomeoneElse,
  notSelectedLine,
  reviewAnswers,
  selectAll,
} from '@/utils/reviewQueue';
import {
  assignedAddress,
  assignedTo as assignedToIn,
  assignedToOptions,
  dealtElsewhere,
  dealtWarning,
  reviewerLine,
  selectionDealtLine,
} from '@/utils/reviewers';
import { useVendorDetails } from '@/utils/vendorDetails';
import { useMarketStore } from '@/stores/market';
import { useVendorDrawer } from '@/utils/vendorDrawer';
import { useVerdictActions } from '@/utils/verdictActions';
import { applicationsAllSeed, NO_FILTERS, type ExportFilters } from '@/utils/vendorExport';
import { isDecided, statusChip, statusLabel, verdictGiverLine } from '@/utils/verdicts';
import FollowUpDialog from '@/components/application/FollowUpDialog.vue';
import AppDialog from '@/components/AppDialog.vue';
import ExportVendorsDialog from '@/components/ExportVendorsDialog.vue';
import VendorDrawer from '@/components/VendorDrawer.vue';
import ListFreshness from '@/components/application/ListFreshness.vue';

const props = defineProps<{
  market: Market | null;
  /** Counts the changes of reviewers: each one dealt applications anew, so the list is read again. */
  dealt?: number;
}>();

const route = useRoute();
const router = useRouter();
/** A verdict is a write: the store re-reads the market, so the rail's count moves (E21/F02/S02). */
const marketStore = useMarketStore();
const marketId = computed(() => props.market?.id ?? '');

const applications = ref<Application[]>([]);
const loading = ref(false);
const errorMessage = ref('');
/** When the list was last read from the server, by any of the reads below (E38/F05/S03). */
const readAt = ref<number | null>(null);
const refreshing = ref(false);
const refreshError = ref('');

/** The one read: the list, and when. A list read is no longer one that failed to load. */
async function read() {
  applications.value = await fetchMarketApplications(marketId.value);
  readAt.value = Date.now();
  errorMessage.value = '';
  refreshError.value = '';
}

async function load() {
  if (!marketId.value) return;
  loading.value = true;
  errorMessage.value = '';
  try {
    await read();
  } catch (err) {
    errorMessage.value = getApiErrorMessage(err, 'Failed to load applications');
  } finally {
    loading.value = false;
  }
}
watch(marketId, () => void load(), { immediate: true });

/**
 * Read again every half minute while the tab is in view, so who holds what and what others decided
 * show without a reload (E34/F03/S02) - a tick is refused rather than written over someone's card,
 * but a row should not invite the tick in the first place. Quiet: a failed re-read keeps the list,
 * and the time it was last read goes on ageing on screen.
 */
const REREAD_MS = 30_000;
let rereading: ReturnType<typeof setInterval> | null = null;
async function reread() {
  if (!marketId.value || document.visibilityState !== 'visible' || saving.value) return;
  try {
    await read();
  } catch {
    // The list on screen stands; the next re-read tries again.
  }
}

/**
 * Refresh, at once (E38/F05/S03): a re-read, not a reset - the ticks of rows still shown stay, as
 * on every re-read - and a failed one says so beside the button and keeps the list.
 */
async function refresh() {
  // Not while a verdict is being written, as the background re-read waits too.
  if (!marketId.value || refreshing.value || saving.value) return;
  refreshing.value = true;
  try {
    await read();
    // The rail counts what is left as well: it should agree with the list just read.
    void marketStore.refresh();
  } catch {
    refreshError.value = 'Could not refresh. The list is as it was last read.';
  } finally {
    refreshing.value = false;
  }
}
watch(
  () => props.dealt,
  () => void refresh(),
);
onMounted(() => (rereading = setInterval(() => void reread(), REREAD_MS)));
onUnmounted(() => {
  if (rereading) clearInterval(rereading);
});

/** The status filter and Mine, in the address beside the view itself. */
const filter = computed(() => allViewFilter(route.query.status));
const mine = computed(() => route.query.mine === '1');

/** Giving verdicts, as the one-by-one review gives them too (`useVerdictActions`). */
const verdicts = useVerdictActions(
  computed(() => props.market),
  applications,
);
const { me, people, writesNotes } = verdicts;

function setQuery(change: Record<string, string | null>) {
  const query: LocationQuery = { ...route.query };
  for (const [key, value] of Object.entries(change)) {
    if (value === null) delete query[key];
    else query[key] = value;
  }
  void router.replace({ query });
}

/**
 * Whose share the rows show, in the address too, offered only with reviewers chosen: with none
 * named, a chosen reviewer's own and everyone's for anyone else (E38/F07/S04).
 */
const assignedOptions = computed(() => assignedToOptions(me.value, props.market));
const assignedTo = computed(() => assignedToIn(route.query.reviewer, me.value, props.market));

const shown = computed(() =>
  allViewApplications(
    applications.value,
    filter.value,
    mine.value,
    me.value,
    assignedAddress(assignedTo.value, me.value),
  ),
);

function nameOf(app: Application): string {
  return applicantName(app.formData);
}

/** The answers a reviewer reads first (E19/F03), as one line per row. */
function leading(app: Application): string {
  return reviewAnswers(app, props.market?.applicationForm, props.market?.reviewHighlights ?? [])
    .leading.map((row) => row.value)
    .filter(Boolean)
    .join(' · ');
}

function holderOf(app: Application): string | null {
  const holder = app.heldBy?.email;
  if (!holder) return null;
  return holder.toLowerCase() === me.value.toLowerCase()
    ? 'You have this open'
    : `${holder} is looking at this`;
}

/** Whose share the application is, while reviewers are chosen (E38/F07/S03). */
function reviewerOf(app: Application): string | null {
  return reviewerLine(app, me.value, props.market);
}

/** The applications shown, as a CSV: the dialog opens on the filter and Mine, taken as it opens. */
const exporting = ref(false);
/** Export is the table's Export CSV row (E39/F01/S02): a market that raises it hides the button. */
const mayExport = computed(() => mayTake(props.market, MarketAction.ExportCsv));
const exportSeed = ref<ExportFilters>(NO_FILTERS);
function openExport(): void {
  exportSeed.value = applicationsAllSeed({ filter: filter.value, mine: mine.value });
  exporting.value = true;
}

// --- The drawer, and the verdicts it carries during review -----------------------------------

const details = useVendorDetails(
  marketId,
  computed(() => props.market),
);
const drawer = useVendorDrawer();
const opened = computed(() =>
  drawer.email.value
    ? (applications.value.find((a) => a.applicantEmail.toLowerCase() === drawer.email.value) ??
      null)
    : null,
);

/** For someone who may give verdicts, while the market can still use them: they are in the drawer. */
const decides = computed(
  () => mayTake(props.market, MarketAction.GiveVerdicts) && !props.market?.verdictsSettledReason,
);
/**
 * Whether this person may also change a verdict already given, an automatic rejection included:
 * the table's change row, on top of giving one (E38/F06/S01). A reviewer it refuses gets no tick on
 * a decided row and no verdict in its drawer, and is told why once.
 */
const changes = computed(() => decides.value && mayTake(props.market, MarketAction.ChangeVerdicts));
const changeRefusal = computed(() =>
  decides.value && !changes.value ? actionRefusal(props.market, MarketAction.ChangeVerdicts) : null,
);
/** Who the market's table lets change a verdict, for what Select all says it left out. */
const whoChanges = computed(() =>
  whoMayTake(props.market?.permissionTable, MarketAction.ChangeVerdicts),
);
/** Whether this person may give the opened application a verdict: a decided one is a change. */
const decidesOpened = computed(
  () => decides.value && (changes.value || !opened.value || !isDecided(opened.value)),
);
/**
 * The reviewer the opened application is dealt to, when it is undecided and not this person's: said
 * above the verdicts, to someone who may give one, so the drawer is no way around the warning.
 */
const openedDealtElsewhere = computed(() =>
  opened.value && decidesOpened.value ? dealtElsewhere(opened.value, me.value, props.market) : null,
);

const saving = ref(false);
const verdictMessage = ref('');
const followUpOpen = ref(false);
const followUpError = ref('');
/** The drawer holds the vendor's notes; the follow-up opens on them and writes beside them. */
const drawerPanel = ref<InstanceType<typeof VendorDrawer> | null>(null);
const noteBefore = computed(() =>
  opened.value ? (drawerPanel.value?.entryFor(opened.value.applicantEmail)?.note ?? '') : '',
);

async function give(status: ApplicationStatus) {
  const app = opened.value;
  if (!app || saving.value) return;
  saving.value = true;
  verdictMessage.value = '';
  try {
    const outcome = await verdicts.give(app, status);
    // Someone decided it first (E34/F03/S01): the drawer shows what is really there, and who.
    if (outcome.kind !== 'written') verdictMessage.value = outcome.message;
    else void details.load();
  } finally {
    saving.value = false;
  }
}

async function markFollowUp(choice: { ownerEmail: string; note?: string }) {
  const app = opened.value;
  if (!app || saving.value) return;
  saving.value = true;
  followUpError.value = '';
  try {
    const outcome = await verdicts.markFollowUp(app, choice, noteBefore.value);
    void drawerPanel.value?.loadNotes();
    if (outcome.kind === 'failed') {
      followUpError.value = outcome.message;
      return;
    }
    followUpOpen.value = false;
    if (outcome.kind === 'changed') verdictMessage.value = outcome.message;
    else void details.load();
  } finally {
    saving.value = false;
  }
}

watch(
  () => drawer.email.value,
  () => (verdictMessage.value = ''),
);

// --- A verdict on a selection (E34/F04/S02) ---------------------------------------------------

/**
 * The ticked applications. Only ever rows ticked on screen, one by one or by Select all, which
 * ticks the rows shown (E38/F05/S02): there is no action on "everything matching" beyond them, so
 * no verdict reaches an application whose row was not in front of the reviewer, counted.
 */
const selected = ref<Set<string>>(new Set());
/** One another reviewer has open cannot be ticked; it says who. */
function heldElsewhere(app: Application): string | null {
  return heldBySomeoneElse(app, me.value);
}
/** One already decided cannot be ticked by someone who may not change it (E38/F06/S01). */
function decidedForMe(app: Application): boolean {
  return !changes.value && isDecided(app);
}
/** Why a row cannot be ticked, or null when it can. */
function untickable(app: Application): string | null {
  const holder = heldElsewhere(app);
  if (holder) return `${holder} has it open`;
  return decidedForMe(app) ? changeRefusal.value : null;
}
/** Said once over the list while it shows a row this person may not change (E38/F06/S01). */
const showsUnchangeable = computed(() => shown.value.some((a) => decidedForMe(a)));
/** How many rows Select all left unticked, by why, to say so. */
const skippedHeld = ref(0);
const skippedDecided = ref(0);
const notSelected = computed(() =>
  notSelectedLine(skippedHeld.value, skippedDecided.value, whoChanges.value),
);
function toggle(app: Application, ticked: boolean) {
  const next = new Set(selected.value);
  if (ticked) next.add(app.id);
  else next.delete(app.id);
  selected.value = next;
  forgetSkipped();
}
function forgetSkipped() {
  skippedHeld.value = 0;
  skippedDecided.value = 0;
}
function tickAllShown() {
  const { ids, held, decided } = selectAll(shown.value, me.value, changes.value);
  selected.value = new Set(ids);
  skippedHeld.value = held;
  skippedDecided.value = decided;
}
function clearSelection() {
  selected.value = new Set();
  forgetSkipped();
}
// Another filter is another set of rows: what Select all skipped was said of the last one.
watch([filter, mine, assignedTo], forgetSkipped);
// A filter that hides a ticked row leaves it unticked: what is decided is what is on screen.
// A row decided since it was ticked is a change now, which leaves the selection as it leaves the
// ticks for someone who may not change a verdict (E38/F06/S01).
watch(shown, (rows) => {
  const tickable = new Set(rows.filter((a) => !decidedForMe(a)).map((a) => a.id));
  selected.value = new Set([...selected.value].filter((id) => tickable.has(id)));
  // What Select all left out is said only while it is still held: a re-read that shows a row let
  // go, or gone, says fewer (E38/F05/S02).
  skippedHeld.value = Math.min(skippedHeld.value, rows.filter((a) => heldElsewhere(a)).length);
  skippedDecided.value = Math.min(
    skippedDecided.value,
    rows.filter((a) => !heldElsewhere(a) && decidedForMe(a)).length,
  );
});

const VERDICT_WORDS: Partial<Record<ApplicationStatus, { verb: string; done: string }>> = {
  [ApplicationStatus.ReviewerApproved]: { verb: 'Approve', done: 'approved' },
  [ApplicationStatus.ReviewerRejected]: { verb: 'Reject', done: 'rejected' },
  [ApplicationStatus.NeedsFollowUp]: {
    verb: 'Mark for follow-up',
    done: 'marked for follow-up',
  },
};
const asking = ref<ApplicationStatus | null>(null);
const result = ref<(SelectionResult & { done: string }) | null>(null);
const selectionError = ref('');
const plural = (n: number) => `${n} application${n === 1 ? '' : 's'}`;
const askingTitle = computed(() =>
  asking.value ? `${VERDICT_WORDS[asking.value]?.verb} ${plural(selected.value.size)}?` : '',
);
/** What the confirmation adds for the ticked rows dealt to other reviewers (E38/F07/S03). */
const askingDealtLine = computed(() =>
  selectionDealtLine(
    applications.value.filter(
      (a) => selected.value.has(a.id) && dealtElsewhere(a, me.value, props.market),
    ).length,
  ),
);

async function decideSelection() {
  const status = asking.value;
  if (!status || !props.market) return;
  selectionError.value = '';
  try {
    const picked = applications.value.filter((a) => selected.value.has(a.id));
    const answer = await reviewSelection(props.market.id, picked, status);
    result.value = { ...answer, done: VERDICT_WORDS[status]?.done ?? '' };
    asking.value = null;
    clearSelection();
    await load();
    void details.load();
    void marketStore.refresh();
  } catch (err) {
    selectionError.value = getApiErrorMessage(err, 'Could not decide the selection.');
  }
}
</script>

<template>
  <div class="all-view" data-testid="applications-all">
    <ListFreshness
      :readAt="readAt"
      :refreshing="refreshing || saving"
      :failed="refreshError"
      @refresh="refresh"
    />
    <!-- Named by the words over it, with what the statuses that are not plain mean (E38/F05/S01). -->
    <div class="all-filter-group">
      <span id="applications-all-filter-label" class="field-label">Filter</span>
      <div class="all-filters">
        <div
          class="all-status"
          role="group"
          aria-labelledby="applications-all-filter-label"
          aria-describedby="applications-all-filter-hint"
        >
          <button
            v-for="option in ALL_VIEW_FILTERS"
            :key="option.id"
            type="button"
            class="btn btn--compact"
            :class="option.id === filter ? 'btn--primary' : 'btn--secondary'"
            :aria-pressed="option.id === filter"
            :data-testid="`applications-all-filter-${option.id}`"
            @click="setQuery({ status: option.id === 'all' ? null : option.id })"
          >
            {{ option.label }}
          </button>
        </div>
        <label class="all-mine">
          <input
            type="checkbox"
            :checked="mine"
            data-testid="applications-all-mine"
            @change="setQuery({ mine: ($event.target as HTMLInputElement).checked ? '1' : null })"
          />
          Mine: the follow-ups I own
        </label>
        <label v-if="assignedTo" class="all-assigned">
          <span class="all-assigned-label">Assigned to</span>
          <select
            class="field field--select"
            :value="assignedTo"
            name="applications-all-assigned-to"
            data-testid="applications-all-assigned-to"
            @change="setQuery({ reviewer: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="option in assignedOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <span class="all-count" data-testid="applications-all-count">
          {{ shown.length }} of {{ applications.length }}
        </span>
        <button
          v-if="mayExport"
          type="button"
          class="btn btn--secondary btn--compact"
          data-testid="applications-all-export-button"
          @click="openExport"
        >
          Export
        </button>
      </div>
      <p id="applications-all-filter-hint" class="all-filter-hint">
        Open is not decided yet. Needs follow-up waits on someone reaching out to the applicant.
      </p>
    </div>

    <!-- The rows shown, ticked at once (E38/F05/S02); a reviewer's, as the ticks are. -->
    <div v-if="decides && shown.length && !errorMessage" class="all-select-all">
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        data-testid="applications-all-select-all"
        @click="tickAllShown"
      >
        Select all
      </button>
      <span
        v-if="notSelected"
        class="all-meta"
        role="status"
        data-testid="applications-all-select-all-skipped"
        >{{ notSelected }}</span
      >
    </div>
    <!-- Why a decided row has no tick, said once rather than on every row (E38/F06/S01), unless
         what Select all left out says it already. -->
    <p
      v-if="showsUnchangeable && changeRefusal && !skippedDecided && !errorMessage"
      class="all-meta change-reason"
      data-testid="applications-all-change-reason"
    >
      {{ changeRefusal }}
    </p>

    <!-- The selection's verdicts, on the rows ticked (E34/F04/S02, E38/F05/S02). -->
    <div
      v-if="decides && selected.size"
      class="all-selection"
      data-testid="applications-all-selection"
    >
      <span class="all-selected">{{ plural(selected.size) }} selected</span>
      <button
        type="button"
        class="btn btn--destructive btn--compact"
        data-testid="applications-all-selection-reject"
        @click="asking = ApplicationStatus.ReviewerRejected"
      >
        Reject
      </button>
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        data-testid="applications-all-selection-follow-up"
        @click="asking = ApplicationStatus.NeedsFollowUp"
      >
        Needs follow-up
      </button>
      <button
        type="button"
        class="btn btn--primary btn--compact"
        data-testid="applications-all-selection-approve"
        @click="asking = ApplicationStatus.ReviewerApproved"
      >
        Approve
      </button>
      <button
        type="button"
        class="btn btn--secondary btn--compact"
        data-testid="applications-all-selection-clear"
        @click="clearSelection"
      >
        Clear
      </button>
    </div>

    <div v-if="result" class="all-result" data-testid="applications-all-result" role="status">
      <p>
        {{ plural(result.written.length) }} {{ result.done
        }}<template v-if="result.skipped.length">; {{ result.skipped.length }} skipped:</template
        ><template v-else>.</template>
      </p>
      <ul v-if="result.skipped.length">
        <li v-for="skip in result.skipped" :key="skip.id" data-testid="applications-all-skipped">
          {{ skip.email ?? skip.id }}: {{ skip.reason }}
        </li>
      </ul>
    </div>

    <p v-if="errorMessage" class="all-error">{{ errorMessage }}</p>
    <p v-else-if="loading && !applications.length" class="all-empty">Loading applications…</p>
    <!-- Nothing has come in is not nothing matching: the tab opens here now (E38/F05/S01). -->
    <p v-else-if="!applications.length" class="all-empty" data-testid="applications-all-empty">
      No applications received yet.
    </p>
    <p v-else-if="!shown.length" class="all-empty" data-testid="applications-all-empty">
      No application matches.
    </p>

    <ul v-else class="all-list">
      <li v-for="app in shown" :key="app.id" class="all-row" data-testid="applications-all-row">
        <input
          v-if="decides"
          type="checkbox"
          class="all-tick"
          :checked="selected.has(app.id)"
          :disabled="!!untickable(app)"
          :aria-label="
            untickable(app)
              ? `${app.applicantEmail}: ${untickable(app)}`
              : `Select ${app.applicantEmail}`
          "
          data-testid="applications-all-tick"
          @change="toggle(app, ($event.target as HTMLInputElement).checked)"
        />
        <button
          type="button"
          class="all-row-button"
          :data-application-id="app.id"
          @click="drawer.open(app.applicantEmail)"
        >
          <span class="all-who">
            <span class="all-name">{{ nameOf(app) || app.applicantEmail }}</span>
            <span v-if="nameOf(app)" class="all-email">{{ app.applicantEmail }}</span>
          </span>
          <span class="all-leading">{{ leading(app) }}</span>
          <span class="all-state">
            <span :class="statusChip(app.status)" data-testid="applications-all-status">
              {{ statusLabel(app.status) }}
            </span>
            <span
              v-if="verdictGiverLine(app)"
              class="all-meta"
              data-testid="applications-all-giver"
              >{{ verdictGiverLine(app) }}</span
            >
            <span v-if="reviewerOf(app)" class="all-meta" data-testid="applications-all-reviewer">{{
              reviewerOf(app)
            }}</span>
            <span v-if="app.followUpOwner" class="all-meta" data-testid="applications-all-owner"
              >Followed up by {{ app.followUpOwner.email }}</span
            >
            <span v-if="holderOf(app)" class="all-meta" data-testid="applications-all-holder">{{
              holderOf(app)
            }}</span>
          </span>
        </button>
      </li>
    </ul>

    <VendorDrawer
      ref="drawerPanel"
      :market="market"
      :details="details"
      :email="drawer.email.value"
      :tab="drawer.tab.value"
      @close="drawer.close()"
      @update:tab="drawer.setTab"
      @infoUpdated="load"
    >
      <template v-if="opened" #actions>
        <div class="drawer-verdict" data-testid="applications-all-drawer-verdict">
          <p class="drawer-status">
            <span :class="statusChip(opened.status)">{{ statusLabel(opened.status) }}</span>
            <span v-if="verdictGiverLine(opened)" class="all-meta">{{
              verdictGiverLine(opened)
            }}</span>
            <span
              v-if="reviewerOf(opened)"
              class="all-meta"
              data-testid="applications-all-drawer-reviewer"
              >{{ reviewerOf(opened) }}</span
            >
            <span
              v-if="holderOf(opened)"
              class="all-meta"
              data-testid="applications-all-drawer-holder"
              >{{ holderOf(opened) }}</span
            >
          </p>
          <p v-if="verdictMessage" class="drawer-message" role="alert">{{ verdictMessage }}</p>
          <p
            v-if="decides && !decidesOpened"
            class="all-meta change-reason"
            data-testid="applications-all-drawer-change-reason"
          >
            {{ changeRefusal }}
          </p>
          <!-- On every such application, never a dialog to click through: helping stays easy. -->
          <p
            v-if="openedDealtElsewhere"
            class="drawer-dealt"
            data-testid="applications-all-drawer-dealt-warning"
          >
            {{ dealtWarning(openedDealtElsewhere) }}
          </p>
          <div v-if="decidesOpened" class="drawer-buttons">
            <button
              type="button"
              class="btn btn--destructive btn--compact"
              :disabled="saving"
              data-testid="applications-all-reject"
              @click="give(ApplicationStatus.ReviewerRejected)"
            >
              Reject
            </button>
            <button
              type="button"
              class="btn btn--secondary btn--compact"
              :disabled="saving || opened.status === ApplicationStatus.NeedsFollowUp"
              data-testid="applications-all-follow-up"
              @click="followUpOpen = true"
            >
              Needs follow-up
            </button>
            <button
              type="button"
              class="btn btn--primary btn--compact"
              :disabled="saving"
              data-testid="applications-all-approve"
              @click="give(ApplicationStatus.ReviewerApproved)"
            >
              Approve
            </button>
          </div>
        </div>
      </template>
    </VendorDrawer>

    <AppDialog
      :open="asking !== null"
      :title="askingTitle"
      testid="applications-all-confirm"
      :confirmLabel="asking ? VERDICT_WORDS[asking]?.verb : ''"
      :destructive="asking === ApplicationStatus.ReviewerRejected"
      :error="selectionError"
      @close="asking = null"
      @submit="decideSelection"
    >
      <p class="all-confirm">
        Each is written only if it is still as you see it here; any that another reviewer has
        changed or has open is skipped, and said so.
        <template v-if="asking === ApplicationStatus.NeedsFollowUp">
          You will own the follow-ups.</template
        >
      </p>
      <p v-if="askingDealtLine" class="all-confirm" data-testid="applications-all-confirm-dealt">
        {{ askingDealtLine }}
      </p>
    </AppDialog>

    <ExportVendorsDialog
      :open="exporting"
      :market-id="marketId"
      :seed="exportSeed"
      @close="exporting = false"
    />

    <FollowUpDialog
      :open="followUpOpen"
      :applicantEmail="opened?.applicantEmail ?? ''"
      :people="people"
      :me="me"
      :note="noteBefore"
      :writesNotes="writesNotes"
      :error="followUpError"
      @close="followUpOpen = false"
      @confirm="markFollowUp"
    />
  </div>
</template>

<style scoped>
.all-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.all-filter-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.all-filter-group .field-label {
  margin-bottom: 0;
}

.all-filter-hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.all-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.all-status {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.all-mine {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.all-assigned {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.all-assigned-label {
  white-space: nowrap;
}

.all-count {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.all-error,
.all-empty {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.all-error {
  color: var(--mm-red);
}

.all-selection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-green);
  border-radius: var(--radius-control);
  background: var(--mm-chip-positive);
}

.all-selected {
  margin-right: auto;
  font-size: var(--text-sm);
  color: var(--mm-text-green);
}

.all-result {
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.all-result p,
.all-result ul {
  margin: 0;
}

.all-result ul {
  padding-left: var(--space-4);
  color: var(--mm-text-muted);
}

.all-confirm {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.all-select-all {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.all-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.all-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.all-tick {
  flex: 0 0 auto;
}

.all-row-button {
  display: grid;
  grid-template-columns: minmax(0, 14rem) minmax(0, 1fr) minmax(0, 22rem);
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  background: white;
  text-align: left;
  cursor: pointer;
}

.all-row-button:hover {
  border-color: var(--mm-green);
}

.all-who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.all-name {
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.all-email,
.all-meta {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
  overflow-wrap: anywhere;
}

.all-leading {
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.all-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}

.drawer-verdict {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--mm-border);
}

.drawer-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
}

/* Why a verdict already given is not this reviewer's to change (E38/F06/S01), as a meta line. */
.change-reason {
  margin: 0;
}

.drawer-message,
.drawer-dealt {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--mm-yellow);
  border-radius: var(--radius-control);
  background: var(--mm-chip-attention);
  font-size: var(--text-sm);
  color: var(--mm-text-yellow-on-tint);
  overflow-wrap: anywhere;
}

.drawer-buttons {
  display: flex;
  gap: var(--space-2);
}
</style>
