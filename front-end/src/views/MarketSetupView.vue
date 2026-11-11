<script setup lang="ts">
import { MarketAction, actionRefusal, mayTake } from '@/utils/marketActions';
import { computed, reactive, nextTick, ref, watch } from 'vue';
import { marketPath } from '@/utils/market';
import { useRoute, useRouter } from 'vue-router';

import ChoosePathOverlay from '@/components/floorplan/ChoosePathOverlay.vue';
import DraftedFrom from '@/components/market/DraftedFrom.vue';
import MarketPlanTab from '@/components/market/MarketPlanTab.vue';
import PlanSaveStatus from '@/components/market/PlanSaveStatus.vue';
import {
  type SetupObject,
  type FormField,
  type IncompleteApplication,
  type Market,
} from '@/assets/types/datatypes';
import { api, getApiErrorMessage } from '@/utils/api';
import { assignRefusal } from '@/utils/assignPhase';
import {
  SETUP_VIEW_PAGES,
  hasAssignment,
  type MarketPage,
  type SetupViewPage,
} from '@/utils/marketPage';
import { IntakeMode, MarketPhase } from '@/assets/types/datatypes';
import MarketApplicationsTab from '@/components/market/MarketApplicationsTab.vue';
import MarketFormTab from '@/components/market/MarketFormTab.vue';
import MarketAssignmentTab from '@/components/market/MarketAssignmentTab.vue';
import MarketFrame from '@/components/MarketFrame.vue';
import { useOpenMarket } from '@/utils/openMarket';
import { fitsAPhone } from '@/utils/fitsAPhone';
import { takeDraftedFrom } from '@/utils/draftedFrom';
import { useAutosave } from '@/utils/useAutosave';
import { useUnsavedWork } from '@/utils/useUnsavedWork';

const router = useRouter();

const showPathChoice = ref(false);
/**
 * Which of the market's four screens is open.
 *
 * In the URL, so a tab can be linked to and returned to: Assign lands on the assignment tab, and
 * the Tables and Vendors screens come back to it. It used to be a route the organizer was pushed
 * to, which is how `Done` came to sit on it posting a phase transition (E10/F03/S01).
 */
const route = useRoute();

/**
 * The page on show, read off the address. A market's own address (`/markets/:id`) is what decides
 * by phase, in `MarketLanding`; an address that names a page always shows that page, so a shared or
 * bookmarked link keeps working (E18/F02/S02).
 */
const activeTab = computed((): SetupViewPage => {
  const page = String(route.params.page ?? '');
  return (SETUP_VIEW_PAGES as readonly string[]).includes(page) ? (page as SetupViewPage) : 'setup';
});

/**
 * Whether the page on show lays out on a phone, by the route's own answer (`utils/fitsAPhone.ts`):
 * the Applications page does (T180); the plan, the form and Settings keep this view's desktop floor.
 */
const onAPhoneLayout = computed(() => fitsAPhone(route));

/**
 * The responses file the market was just drafted from, on the arrival that follows the start's
 * confirm, and only then (T205/F20): its entry's mark is read once and cleared, so a reload, Back to
 * it, another page or a later visit to the Questions tab shows no notice.
 */
const draftedFrom = ref<string | null>(null);
watch(
  () => route.fullPath,
  (path) => {
    draftedFrom.value = takeDraftedFrom(router, path);
  },
  { immediate: true },
);

function showTab(page: MarketPage) {
  router.push(marketPath(marketId.value, page));
}

/**
 * The market this screen is routed to, as the server last reported it (E21/F02/S02).
 *
 * It used to be read out of `localStorage` at setup - the route (`/market-setup`) carried no id -
 * and patched in place by every write on the page. It comes from the one market store now, and is
 * never written here: a write is followed by `refreshMarket()`, and the store takes what the
 * server says.
 */
const marketId = computed(() => String(route.params.marketId ?? ''));
const { market, refresh: refreshMarket } = useOpenMarket(marketId);

/**
 * The questions a priority rule can order by: the market's own form, as the server holds it.
 *
 * This used to be published by the form tab, so it was empty until that tab had been opened on the
 * visit - and the Assignment tab, where an organizer usually arrives, offered none of the market's
 * questions and told them to add one they already had (E21/F02/S03).
 */
const formFields = computed<FormField[]>(() => market.value?.applicationForm?.fields ?? []);
const setupObject = reactive<SetupObject>({
  priority: [],
  marketDates: [],
  tiers: [],
  locations: [],
  sections: [],
  assignmentOptions: {
    maxAssignmentsPerVendor: null,
    maxHalfTableProportionPerSection: null,
  },
});

/**
 * The essential questions' offering as the server reports it: the frozen snapshot once an
 * applicant's answer exists, the stored plan otherwise.
 */
function parseFiniteInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function parseFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * True when the required Assignment Options are set, which is what enables Assign.
 *
 * It used to also require four spreadsheet columns to be mapped - which vendor answer lived
 * where. The application form supplies all four now, so what is left is what the organizer
 * actually decides.
 *
 * The ceiling is not required: blank means the organizer named none, as its help text says and
 * the solver reads it. Requiring one kept Assign disabled on every market that left it blank, and
 * on every market started from a Google Form whose proposal said "No limit" (bug 7).
 */
const assignmentOptionsComplete = computed(() => {
  const ao = setupObject.assignmentOptions;
  const numMarketDates = setupObject.marketDates.length;

  const maxPer = parseFiniteInt(ao.maxAssignmentsPerVendor);
  if (maxPer !== null && (maxPer < 1 || (numMarketDates > 0 && maxPer > numMarketDates))) {
    return false;
  }

  // Blank is the solver's 30% (E27), as blank is "no ceiling" above; only a value out of range
  // stops the run.
  const halfProp = parseFiniteNumber(ao.maxHalfTableProportionPerSection);
  if (halfProp !== null && (halfProp < 0 || halfProp > 100)) return false;

  return true;
});

/**
 * The plan's working copy (E21/F02/S02).
 *
 * The organizer edits `setupObject` and `planIntakeMode`, never the market in the store. They are
 * taken from the market when it arrives, and again whenever a re-read lands while nothing in them
 * is unsaved - so a re-read never overwrites what the organizer is typing.
 */
const planIntakeMode = ref<IntakeMode | undefined>(undefined);

/**
 * The market the working copy was taken from, as last read.
 *
 * What the plan's saves write to and ask about, rather than the store's market: a save sent on
 * leaving, or after a save out answers, runs once the store may already hold the next page's
 * market, or none while it reads it.
 */
let planMarket: Market | null = null;

/**
 * The plan exactly as the server last sent it, serialized, so an edit can be told from an echo.
 *
 * The plan cards deep-watch the working copy and report every change to it as an edit. Adopting a
 * re-read replaces the working copy, so each card reported the page's own replacement as one, and
 * every save's re-read scheduled the next save: after a single edit the page saved every 625 ms
 * until it was left, and each cycle re-sent a copy that overwrote any other editor's work
 * (E26/F04/S01, bug 25). A change is an edit only if the plan now differs from what the server
 * holds; a report that leaves it identical is the replacement coming back, and is not counted.
 */
let serverPlan = '';

function workingPlan(): string {
  return JSON.stringify({ setupObject, intakeMode: planIntakeMode.value });
}

/**
 * The plan saves itself as it is edited, one save at a time (`utils/useAutosave.ts`, T271).
 *
 * It used to be saved by the wizard's Back and Next, which were the only routine writes of the
 * plan to the server - everything else only touched localStorage. With the paging gone
 * (E10/F02/S01) those buttons are gone too, so an organizer who planned a market and then opened
 * applications without assigning would have had a plan that existed on their machine and nowhere
 * else. Autosave rather than a Save button: there is no step to press it on any more, and the
 * status below is what makes the writing visible (E09/F03/S05). It waits a pause after each edit,
 * because every keystroke in a section name emits an update.
 *
 * The write is the plan's own (E21/F03/S02), carrying the plan and the intake mode and nothing
 * else; it used to PUT the whole market, which is a client claiming its copy is the truth. A plan
 * that cannot change is never sent (bug 30): its controls are disabled, and this is the one door
 * every edit reaches the server through, so nothing slips past them.
 *
 * A save the server refuses (the market left draft under the organizer, the rules settled, a role
 * lost) puts the plan back as the server holds it and says why; one that failed on the way keeps
 * the edit and offers Retry (T271). Either stops a move, an allocation or a start from a CSV that
 * would read the plan.
 *
 * A reload or a closed tab never unmounts the page, so an edit still waiting then was lost (T271).
 * The browser asks first, and if the organizer goes, the plan is sent one last time with a
 * keepalive write, which may outlive the page. That write is a best effort, unproven where the back
 * end is another origin (production's), so the browser's question is the guard. A move inside the
 * app asks nothing: the page's unmount sends the edit, and an in-app move does not cancel it.
 */
const {
  status: planSaveStatus,
  message: planSaveMessage,
  unsaved: planUnsaved,
  edited: planEdited,
  hold: holdPlan,
  flush: flushPlan,
  retry: retryPlan,
  forgetUnsendable: forgetUnsendablePlan,
} = useAutosave({
  send: async () => {
    await api.put(`/markets/${encodeURIComponent(planMarket!.id)}/plan`, {
      setupObject: { ...setupObject },
      intakeMode: planIntakeMode.value,
    });
  },
  sendOnUnload: () => {
    // `fetch`, not the app's axios: axios's browser adapter is XHR, which has no `keepalive`.
    try {
      void fetch(
        `${import.meta.env.VITE_FLASK_HOST}/markets/${encodeURIComponent(planMarket!.id)}/plan`,
        {
          method: 'PUT',
          keepalive: true,
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ setupObject, intakeMode: planIntakeMode.value }),
        },
      ).catch(() => {});
      return true;
    } catch {
      // A body over the browser's 64 KiB keepalive limit throws at the call.
      return false;
    }
  },
  afterSave: () => refreshMarket(),
  afterRefusal: async () => {
    await refreshMarket();
    // Taken back here as well as by the watch: a re-read that failed, or handed back the market
    // the page already had, leaves the watch silent and the refused plan on screen.
    if (market.value && market.value.id === planMarket?.id) adoptPlan(market.value);
  },
  may: () => Boolean(planMarket?.id) && mayTake(planMarket, MarketAction.ChangeSetup),
  failure: 'The plan was not saved.',
});

useUnsavedWork({ unsaved: () => planUnsaved.value, inApp: false });

/** The status line's failed and refused sentences also show on Settings, whose rules ride in the plan. */
const planSaveDidNotLand = computed(
  () => planSaveStatus.value === 'failed' || planSaveStatus.value === 'refused',
);

/** Take the market's plan as the working copy. */
function adoptPlan(fresh: Market) {
  if (fresh.setupObject) {
    // Replace, not merge: a key the server no longer holds must not live on in the working copy
    // and be written back by the next save.
    for (const key of Object.keys(setupObject)) {
      if (!(key in fresh.setupObject)) delete (setupObject as Record<string, unknown>)[key];
    }
    Object.assign(setupObject, fresh.setupObject);
  }
  planIntakeMode.value = fresh.intakeMode;
  serverPlan = workingPlan();
}

watch(
  market,
  (fresh) => {
    if (!fresh) return;
    const arrived = fresh.id !== planMarket?.id;
    planMarket = fresh;
    // An unsaved edit keeps the working copy, unless the organizer may no longer save it (another
    // person archived the market or took their role): the autosave drops it then, even one no send
    // is coming for (a failed save's, or one held), and the screen shows the plan as the server
    // holds it.
    if (!arrived && planUnsaved.value) {
      if (mayTake(fresh, MarketAction.ChangeSetup)) return;
      forgetUnsendablePlan();
    }
    adoptPlan(fresh);
  },
  { immediate: true },
);

/**
 * Why the assignment cannot be run, or null (`E10/F03/S02`): by this person (bug 37), then in this
 * market's phase.
 *
 * The server enforces it, and this lets the button say no before it is pressed rather than after.
 * Safe to freeze now that a placement can be changed by hand from the Tables view - shipping the
 * freeze first would have stranded an organizer on market day with archiving a running market as
 * their only move.
 */
// The server's word on whether the run may happen (E36/F04/S02): its phase, and not once results
// are published. The phase mirror stands in only until the market has been read.
const assignRefusalReason = computed(
  () =>
    actionRefusal(market.value, MarketAction.Assign) ||
    (market.value?.assignRefusalReason !== undefined
      ? market.value.assignRefusalReason
      : assignRefusal(market.value?.phase)),
);

/**
 * Whether this person may change the assignment rules. They ride in the plan, so their write asks
 * both the Market Setup row and the Assignment row (E39/F01/S01).
 */
const rulesWritable = computed(
  () =>
    mayTake(market.value, MarketAction.ChangeSetup) && mayTake(market.value, MarketAction.Assign),
);

/**
 * How vendors reach this market. Settable while it is a draft and frozen afterwards, which is what
 * the back end enforces - this only stops an organizer reaching for something that would be
 * refused (E18/F04/S01).
 */
const intakeEditable = computed(() => market.value?.phase === MarketPhase.Draft);

function handleUpdateIntakeMode(mode: IntakeMode) {
  if (!market.value) return;
  planIntakeMode.value = mode;
  // Saved at once, through the queue, so it never races a plan save out.
  planEdited();
  void flushPlan();
}

/** Whether the form tab holds questions not yet saved, as it reports (T271). */
const formUnsaved = ref(false);

/**
 * Unsaved questions refuse a move as it is pressed, before any dialog of the move's opens:
 * "Open applications" over them opened the form as last saved, so applicants got a form without its
 * last questions (T271).
 */
function refuseMove(): string | null {
  return formUnsaved.value
    ? 'The market did not move: the form has changes that are not saved. Save Form first.'
    : null;
}

/**
 * Every phase guard reads the market as the server holds it, so a transition fired while an edit
 * is still sitting in the pause would be judged against a plan the organizer has already changed -
 * refused by their own unsaved work. So the plan's edits land first, and a plan that did not land
 * stops the move, which would otherwise go ahead over a plan the organizer did not mean (T271).
 */
async function beforeTransition(): Promise<string | null> {
  const why = await flushPlan();
  return why === null ? null : `The market did not move, because the plan did not save. ${why}`;
}

/**
 * The plan's pending edits land first: the proposal reads the plan's dates and tiers. One that did
 * not land keeps the organizer here, where the status line says why.
 */
async function startFromCsv(): Promise<void> {
  if ((await flushPlan()) !== null) return;
  void router.push(marketPath(marketId.value, 'start-from-csv'));
}

const handleUpdateSetupObject = (newSetupObject: SetupObject) => {
  nextTick(() => {
    if (market.value) {
      Object.assign(setupObject, newSetupObject);
      // A card reporting the re-read the page just adopted, not the organizer (see `serverPlan`).
      if (!planUnsaved.value && workingPlan() === serverPlan) return;
      planEdited();
    }
  });
};

const assignError = ref('');
/** The applications a refused run named, each with what it lacks (bug 42). */
const assignIncomplete = ref<IncompleteApplication[]>([]);

/** How many hand placements the stored assignment holds; null until one has been run. */
const handPlacements = computed((): number | null => {
  if (!hasAssignment(market.value)) return null;
  return (market.value?.assignmentObject?.vendorAssignments ?? []).filter((row) => row.handPlaced)
    .length;
});

/**
 * Run the assignment, or say why it was refused.
 *
 * The back end refuses the whole run when an approved application is missing an answer the
 * solver needs, naming the applicants, because an assignment that looks complete with someone
 * silently missing is worse than no assignment. That refusal has to reach the organizer: this
 * used to let the error escape unhandled, so the button did nothing at all and the page simply
 * sat there.
 */
const handleAssign = async () => {
  if (!assignmentOptionsComplete.value || assignRefusalReason.value) {
    return;
  }
  assignError.value = '';
  assignIncomplete.value = [];
  try {
    // Allocating reads the plan as the server holds it, so a pending edit is written first - by
    // someone who may change the plan. Allocating asks the Assignment row alone, and a market's
    // owner may set it apart from Change Market Setup (E39/F01/S03): to anyone that row refuses,
    // the rules are read only, there is nothing of theirs to save, and the plan's write would
    // refuse the allocation they may make. A plan that did not land stops the run, which would
    // otherwise read an older plan.
    if (mayTake(market.value, MarketAction.ChangeSetup)) {
      const why = await flushPlan();
      if (why !== null) {
        // The plan's line says the same sentence: this one says what it stopped.
        assignError.value = `The tables were not allocated, because the plan did not save. ${why}`;
        return;
      }
    }

    // POST, not GET-then-PUT. `assignmentObject` is server-owned (E11/F01/S01), so a market PUT
    // no longer stores an assignment the browser was handed - and never should have: a stale
    // copy in one tab could overwrite what another had just saved.
    await api.post('/markets/' + market.value!.id + '/assignment');

    // The results below re-read their statistics when the market in the store changes, so taking
    // the market back from the server is all it takes for them to show the new run.
    await refreshMarket();
    // A run lands on the result it produced (E22/F04/S03).
    showTab('assignments');
  } catch (err: unknown) {
    const data = (
      err as {
        response?: { data?: { error?: string; incomplete?: IncompleteApplication[] } };
      }
    )?.response?.data;
    assignError.value = getApiErrorMessage(err, 'The tables were not allocated.');
    assignIncomplete.value = data?.incomplete ?? [];
  }
};

function handlePathChoice(path: 'manual' | 'floorplan') {
  showPathChoice.value = false;
  if (path === 'floorplan') {
    if (market.value) router.push(marketPath(market.value.id, 'floorplan'));
  }
  // For 'manual': just hide overlay, existing text-based UI is already underneath
}

/**
 * Whether the organizer has yet said how this market's sections are described.
 *
 * The floorplan-or-by-hand choice used to interrupt: it opened by itself on arriving at the
 * wizard's sections page. That page is gone, and on one page an overlay that opens by itself
 * covers the dates the organizer is in the middle of typing. It is offered from the Section Setup
 * card instead - the place it is a question about - and opened when they ask for it.
 */
</script>

<template>
  <div class="market-setup-view" :class="{ 'market-setup-view--fits-a-phone': onAPhoneLayout }">
    <ChoosePathOverlay v-if="market && showPathChoice" @select="handlePathChoice" />
    <!-- The frame (E21/F04/S01): the market's bar and the whole phase rail stay put under the
         app bar while the page scrolls. Nothing about a market is kept in the browser, so until the
         server answers the frame paints the state of asking (E21/F02/S02). -->
    <MarketFrame :market="market" :beforeTransition="beforeTransition" :refuseMove="refuseMove">
      <template v-if="market">
        <!-- What the start from a Google Form just did, said once above the Questions tab it lands
             on; here rather than in the tab's body, which owns the form. -->
        <DraftedFrom
          v-if="activeTab === 'form' && draftedFrom"
          class="market-setup-drafted-from"
          :market="market"
          :fileName="draftedFrom"
        />

        <!-- Application Form Tab -->
        <MarketFormTab
          v-if="activeTab === 'form'"
          :market="market"
          :setupObject="setupObject"
          @unsaved="(now: boolean) => (formUnsaved = now)"
        />

        <MarketPlanTab
          v-if="activeTab === 'setup'"
          :setupObject="setupObject"
          :intakeMode="planIntakeMode"
          :intakeEditable="intakeEditable"
          :csvStartRefusal="
            actionRefusal(market, MarketAction.ImportApplications) ||
            market?.csvStartRefusal ||
            null
          "
          :readOnly="!mayTake(market, MarketAction.ChangeSetup)"
          :setupLockReason="market.setupLockReason ?? null"
          :formQuestions="market.applicationForm?.fields?.length ?? 0"
          :formLockReason="market.applicationFormLockReason ?? null"
          :choiceQuestions="market.rejectionQuestions ?? []"
          @update:setupObject="handleUpdateSetupObject"
          @update:intakeMode="handleUpdateIntakeMode"
          @held="holdPlan"
          @choosePath="showPathChoice = true"
          @startFromCsv="startFromCsv"
          @openForm="showTab('form')"
        />

        <!-- Applications Tab -->
        <MarketApplicationsTab
          v-if="activeTab === 'applications'"
          :market="market"
          :visible="activeTab === 'applications'"
        />

        <!-- Assignment, a tab rather than a place the organizer is pushed to. Reachable
               in every phase, and nothing on it posts a transition: publishing is a step on the
               phase strip above, and "I have finished looking at this" is what leaving a page
               already is. -->
        <MarketAssignmentTab
          v-if="activeTab === 'settings'"
          :setupObject="setupObject"
          :formFields="formFields"
          :assignmentOptionsComplete="assignmentOptionsComplete"
          :assignRefusalReason="assignRefusalReason"
          :assignError="assignError"
          :assignIncomplete="assignIncomplete"
          :marketId="market.id"
          :readOnly="!rulesWritable"
          :mayAllocate="mayTake(market, MarketAction.Assign)"
          :rulesLockReason="market.assignmentRulesLockReason ?? null"
          :handPlacements="handPlacements"
          @update:setupObject="handleUpdateSetupObject"
          @assign="handleAssign"
        >
          <template v-if="planSaveDidNotLand" #planStatus>
            <PlanSaveStatus
              :status="planSaveStatus"
              :message="planSaveMessage"
              @retry="retryPlan"
            />
          </template>
        </MarketAssignmentTab>

        <!-- Whether what the organizer just typed is on the server. Nothing else on this page
             says so now that Next is gone. At the foot of the card, which it belongs to: it sat
             below it, on the page. -->
        <div v-if="activeTab === 'setup'" class="plan-actions">
          <PlanSaveStatus :status="planSaveStatus" :message="planSaveMessage" @retry="retryPlan" />
        </div>
      </template>
    </MarketFrame>
  </div>
</template>

<style scoped>
.plan-actions {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
  /* In the plan's own gutter, under its cards' right edge: with none, "Plan saved" sat in the
     card's bottom-right corner, touching both edges (E26 re-walk). */
  padding: 0 var(--space-6) var(--space-6);
}

/* In the tab's own gutter, as the read-only note is, so it lines up with the steps under it. */
.market-setup-drafted-from {
  margin: var(--space-6) var(--space-6) 0;
}

.settings-body-stacked {
  flex-direction: column;
  gap: 0;
}

.market-setup-view {
  width: 100%;
  min-width: 1000px;
  flex: 1;
  min-height: 0;

  display: flex;
  flex-direction: column;
  /* The top, never the middle (E21/F01/S02). This was `safe center`, which floated the whole card
     - header and rail with it - into the middle of the window whenever a surface was shorter than
     the viewport, so the market's own header moved as the organizer changed tabs. */
  justify-content: flex-start;
  align-items: center;
}

/* A page that fits a phone lays out at the window's width below the desk's, as the door does. */
.market-setup-view--fits-a-phone {
  min-width: 0;
}

.settings-body {
  align-self: stretch;
  display: flex;
  gap: var(--space-8);
  padding: var(--space-6);
}
</style>
