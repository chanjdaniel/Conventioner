<script setup lang="ts">
import { computed, onUnmounted, reactive, nextTick, ref, watch } from 'vue';
import { marketPath } from '@/utils/market';
import { useRoute, useRouter } from 'vue-router';

import ChoosePathOverlay from '@/components/floorplan/ChoosePathOverlay.vue';
import MarketPlanTab from '@/components/market/MarketPlanTab.vue';
import {
  type SetupObject,
  type FormField,
  type IncompleteApplication,
} from '@/assets/types/datatypes';
import { api, getApiErrorMessage } from '@/utils/api';
import { importRefusal } from '@/utils/importPhase';
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

function showTab(page: MarketPage) {
  router.push(marketPath(marketId.value, page));
}

// A page starts at its own top, directly under the pinned frame, rather than wherever the last one
// was scrolled to (E21/F04/S01).
watch(
  () => route.params.page,
  () => {
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
  },
);

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

  const halfProp = parseFiniteNumber(ao.maxHalfTableProportionPerSection);
  if (halfProp === null || halfProp < 0 || halfProp > 100) return false;

  return true;
});

/**
 * The plan's working copy (E21/F02/S02).
 *
 * The organizer edits `setupObject` and `planIntakeMode`, never the market in the store. They are
 * taken from the market when it arrives, and again whenever a re-read lands while there is nothing
 * unsaved in them - so a re-read never overwrites what the organizer is typing. `planEdits` counts
 * edits and `planSavedEdits` the edits the last successful save carried; they differ exactly while
 * there is unsaved work.
 */
const planIntakeMode = ref<IntakeMode | undefined>(undefined);
let planEdits = 0;
let planSavedEdits = 0;

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

watch(
  market,
  (fresh, previous) => {
    if (!fresh) return;
    const arrived = fresh.id !== previous?.id;
    if (!arrived && planEdits !== planSavedEdits) return;
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
  },
  { immediate: true },
);

/**
 * Why this person cannot import here, or null. Importing is an admin action, so who is asking
 * comes first (bug 37); then whether the phase takes applications at all.
 */
const importRefusalReason = computed(
  () => market.value?.adminActionsReason || importRefusal(market.value?.phase),
);

/**
 * Why the assignment cannot be run, or null (`E10/F03/S02`): by this person (bug 37), then in this
 * market's phase.
 *
 * The same arrangement as importing: the server enforces it, and this lets the button say no
 * before it is pressed rather than after. Safe to freeze now that a placement can be changed by
 * hand from the Tables view - shipping the freeze first would have stranded an organizer on
 * market day with archiving a running market as their only move.
 */
const assignRefusalReason = computed(
  () => market.value?.readOnlyReason || assignRefusal(market.value?.phase),
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
  planEdits += 1;
  void savePlan();
}

/**
 * Send the plan's working copy, then take the market back from the server.
 *
 * Through the plan's own write (E21/F03/S02), carrying the plan and the intake mode and nothing
 * else. It used to PUT the whole market, which is a client claiming its copy is the truth.
 */
const updateMarket = async () => {
  if (!market.value) return;
  const sending = planEdits;
  await api.put(`/markets/${encodeURIComponent(market.value.id)}/plan`, {
    setupObject: { ...setupObject },
    intakeMode: planIntakeMode.value,
  });
  planSavedEdits = Math.max(planSavedEdits, sending);
  await refreshMarket();
};

/**
 * The plan saves itself as it is edited.
 *
 * It used to be saved by the wizard's Back and Next, which were the only routine writes of the
 * plan to the server - everything else only touched localStorage. With the paging gone
 * (E10/F02/S01) those buttons are gone too, so an organizer who planned a market and then opened
 * applications without assigning would have had a plan that existed on their machine and nowhere
 * else. Autosave rather than a Save button: there is no step to press it on any more, and the
 * status below is what makes the writing visible (E09/F03/S05).
 *
 * Debounced, because every keystroke in a section name emits an update.
 */
const planSaveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
const planSaveError = ref('');
const planSaveTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const planSavedTimer = ref<ReturnType<typeof setTimeout> | null>(null);

async function savePlan() {
  // A plan that cannot change is never sent (bug 30): its controls are disabled, and this is the
  // one door every edit reaches the server through, so nothing slips past them.
  if (!market.value?.id || market.value.readOnlyReason) return;
  planSaveStatus.value = 'saving';
  planSaveError.value = '';
  try {
    await updateMarket();
    planSaveStatus.value = 'saved';
    if (planSavedTimer.value !== null) clearTimeout(planSavedTimer.value);
    planSavedTimer.value = setTimeout(() => {
      planSavedTimer.value = null;
      if (planSaveStatus.value === 'saved') planSaveStatus.value = 'idle';
    }, 2000);
  } catch (err: unknown) {
    planSaveStatus.value = 'error';
    planSaveError.value = getApiErrorMessage(err, 'Could not save the plan. Retry in a moment.');
  }
}

function schedulePlanSave() {
  if (planSaveTimer.value !== null) clearTimeout(planSaveTimer.value);
  planSaveTimer.value = setTimeout(() => {
    planSaveTimer.value = null;
    void savePlan();
  }, 600);
}

/**
 * Write any pending plan edit NOW, and wait for it.
 *
 * Every phase guard reads the market as the server holds it, so a transition fired while an edit
 * is still sitting in the debounce would be judged against a plan the organizer has already
 * changed - refused by their own unsaved work.
 */
async function flushPlanSave(): Promise<void> {
  if (planSaveTimer.value === null) return;
  clearTimeout(planSaveTimer.value);
  planSaveTimer.value = null;
  await savePlan();
}

/** The plan's pending edits land first: the proposal reads the plan's dates and tiers. */
async function startFromCsv(): Promise<void> {
  await flushPlanSave();
  void router.push(marketPath(marketId.value, 'start-from-csv'));
}

/** A pending edit must not be lost to leaving the page, so it is sent without waiting. */
onUnmounted(() => {
  if (planSaveTimer.value === null) return;
  clearTimeout(planSaveTimer.value);
  planSaveTimer.value = null;
  void savePlan();
});

const handleUpdateSetupObject = (newSetupObject: SetupObject) => {
  nextTick(() => {
    if (market.value) {
      Object.assign(setupObject, newSetupObject);
      // A card reporting the re-read the page just adopted, not the organizer (see `serverPlan`).
      if (planEdits === planSavedEdits && workingPlan() === serverPlan) return;
      planEdits += 1;
      schedulePlanSave();
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
    await updateMarket();

    // POST, not GET-then-PUT. `assignmentObject` is server-owned (E11/F01/S01), so a market PUT
    // no longer stores an assignment the browser was handed - and never should have: a stale
    // copy in one tab could overwrite what another had just saved.
    await api.post('/markets/' + market.value!.id + '/assignment');

    // The results below re-read their statistics when the market in the store changes, so taking
    // the market back from the server is all it takes for them to show the new run.
    await refreshMarket();
    // A run lands on the result it produced (E22/F04/S03).
    showTab('result');
  } catch (err: unknown) {
    const data = (
      err as {
        response?: { data?: { error?: string; incomplete?: IncompleteApplication[] } };
      }
    )?.response?.data;
    assignError.value = data?.error || 'Assignment failed. Please try again.';
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
  <div class="market-setup-view">
    <ChoosePathOverlay v-if="market && showPathChoice" @select="handlePathChoice" />
    <!-- The frame (E21/F04/S01): the market's bar and the whole phase rail stay put under the
         banner while the page scrolls. Nothing about a market is kept in the browser, so until the
         server answers the frame paints the state of asking (E21/F02/S02). -->
    <MarketFrame :market="market" :beforeTransition="flushPlanSave">
      <template v-if="market">
        <!-- Application Form Tab -->
        <MarketFormTab v-if="activeTab === 'form'" :market="market" :setupObject="setupObject" />

        <MarketPlanTab
          v-if="activeTab === 'setup'"
          :setupObject="setupObject"
          :intakeMode="planIntakeMode"
          :intakeEditable="intakeEditable"
          :csvStartRefusal="market?.adminActionsReason || market?.csvStartRefusal || null"
          :readOnlyReason="market?.readOnlyReason ?? null"
          :formQuestions="market.applicationForm?.fields?.length ?? 0"
          :formLockReason="market.applicationFormLockReason ?? null"
          @update:setupObject="handleUpdateSetupObject"
          @update:intakeMode="handleUpdateIntakeMode"
          @choosePath="showPathChoice = true"
          @startFromCsv="startFromCsv"
          @openForm="showTab('form')"
        />

        <!-- Applications Tab -->
        <MarketApplicationsTab
          v-if="activeTab === 'applications'"
          :market="market"
          :visible="activeTab === 'applications'"
          :importRefusalReason="importRefusalReason"
        />

        <!-- Assignment, a tab rather than a place the organizer is pushed to. Reachable
               in every phase, and nothing on it posts a transition: publishing is a step on the
               phase strip above, and "I have finished looking at this" is what leaving a page
               already is. -->
        <MarketAssignmentTab
          v-if="activeTab === 'assignment'"
          :setupObject="setupObject"
          :formFields="formFields"
          :assignmentOptionsComplete="assignmentOptionsComplete"
          :assignRefusalReason="assignRefusalReason"
          :assignError="assignError"
          :assignIncomplete="assignIncomplete"
          :marketId="market.id"
          :rulesLockReason="market?.assignmentRulesLockReason || market?.readOnlyReason || null"
          :handPlacements="handPlacements"
          @update:setupObject="handleUpdateSetupObject"
          @assign="handleAssign"
        />

        <!-- Whether what the organizer just typed is on the server. Nothing else on this page
             says so now that Next is gone. At the foot of the card, which it belongs to: it sat
             below it, on the page. -->
        <div v-if="activeTab === 'setup'" class="plan-actions">
          <span
            v-if="planSaveStatus === 'saving'"
            class="plan-save-status"
            data-testid="market-setup-plan-saving"
          >
            Saving…
          </span>
          <span
            v-else-if="planSaveStatus === 'saved'"
            class="plan-save-status plan-save-status--saved"
            data-testid="market-setup-plan-saved"
          >
            Plan saved
          </span>
          <span
            v-else-if="planSaveStatus === 'error'"
            class="plan-save-status plan-save-status--error"
            data-testid="market-setup-plan-save-error"
          >
            {{ planSaveError }}
          </span>
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
  gap: 6px;
  /* In the plan's own 40px gutter, under its cards' right edge: with none, "Plan saved" sat in the
     card's bottom-right corner, touching both edges (E26 re-walk). */
  padding: 0 40px var(--space-6);
}

.plan-save-status {
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.plan-save-status--saved {
  color: var(--mm-green);
}

.plan-save-status--error {
  color: var(--mm-text-yellow);
}

.settings-body-stacked {
  flex-direction: column;
  gap: 0;
  /* The review queue grows with the application in front of the organizer, and the reviewed list
     grows with the market. Without its own scroll the content spilled out past the white panel,
     where it was unreachable. The other tabs each scroll inside their own card; this one has no
     card to scroll inside. */
  overflow-y: auto;
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

.settings-body {
  align-self: stretch;
  display: flex;
  gap: 30px;
  padding: 40px;
}
</style>
