<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import ChoosePathOverlay from '@/components/floorplan/ChoosePathOverlay.vue';
import MarketPlanTab from '@/components/market/MarketPlanTab.vue';
import { type SetupObject, type Market, type FormField } from '@/assets/types/datatypes';
import { api, getApiErrorMessage } from '@/utils/api';
import { importRefusal } from '@/utils/importPhase';
import { assignRefusal } from '@/utils/assignPhase';
import {
  MARKET_SURFACES,
  isCurrentSurface,
  surfaceForPhase,
  type MarketSurface,
} from '@/utils/marketSurface';
import { IntakeMode, MarketPhase } from '@/assets/types/datatypes';
import MarketApplicationsTab from '@/components/market/MarketApplicationsTab.vue';
import MarketFormTab from '@/components/market/MarketFormTab.vue';
import MarketAssignmentTab from '@/components/market/MarketAssignmentTab.vue';
import PhaseRail from '@/components/PhaseRail.vue';
import NoMarketLoaded from '@/components/NoMarketLoaded.vue';

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
 * The surface to open on (E18/F02/S02).
 *
 * An explicit stage in the URL always wins, so a shared or bookmarked link keeps working - that is
 * the one requirement that survives the original finding. Otherwise the PHASE decides, rather than
 * the unconditional `'setup'` this used to fall back to whatever the market was doing.
 */
function tabFromRoute(): MarketSurface {
  const asked = String(route.query.tab ?? '');
  if ((MARKET_SURFACES as string[]).includes(asked)) return asked as MarketSurface;
  return surfaceForPhase(market.value?.phase);
}

const activeTab = ref<MarketSurface>('setup');

function showTab(tab: MarketSurface) {
  activeTab.value = tab;
  router.replace({ query: { ...route.query, tab } });
}

watch(
  () => route.query.tab,
  () => (activeTab.value = tabFromRoute()),
);

/**
 * Read at setup, not on mount: the page renders "no market is open" when there is none, and a
 * value that only arrives a tick later would flash that message on every page that does have one.
 */
const market = ref<Market | null>(JSON.parse(localStorage.getItem('market') || 'null'));

// The phase decides where an organizer lands, so this is set once the market is in hand.
activeTab.value = tabFromRoute();

/** Published by the form tab. The applications tab reads the first, the plan the second. */
const formEditable = ref(false);
const formFields = ref<FormField[]>([]);
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
 * Take the new phase from the server without throwing away the organizer's unsaved plan.
 *
 * This used to replace the whole market with the server's copy. A transition changes the phase and
 * nothing else, but the server's copy carries the setup as it was last SAVED - so every edit not
 * yet persisted vanished the moment the organizer advanced a phase, silently. The assignment
 * options showed it most often, because they live on the wizard's last page, which has no Next to
 * save them: type them, open applications, and they are gone, leaving Assign disabled for a reason
 * nothing states.
 */
function handlePhaseAdvanced(updatedMarket: Market) {
  const localSetup = market.value?.setupObject;
  market.value = localSetup ? { ...updatedMarket, setupObject: localSetup } : updatedMarket;
  localStorage.setItem('market', JSON.stringify(market.value));
}

/**
 * True when the required Assignment Options are set, which is what enables Assign.
 *
 * It used to also require four spreadsheet columns to be mapped - which vendor answer lived
 * where. The application form supplies all four now, so what is left is what the organizer
 * actually decides.
 */
const assignmentOptionsComplete = computed(() => {
  const ao = setupObject.assignmentOptions;
  const numMarketDates = setupObject.marketDates.length;

  const maxPer = parseFiniteInt(ao.maxAssignmentsPerVendor);
  if (maxPer === null || maxPer < 1) return false;
  if (numMarketDates > 0 && maxPer > numMarketDates) return false;

  const halfProp = parseFiniteNumber(ao.maxHalfTableProportionPerSection);
  if (halfProp === null || halfProp < 0 || halfProp > 100) return false;

  return true;
});

onMounted(() => {
  // create setup object

  if (market.value && market.value.setupObject) {
    Object.assign(setupObject, market.value.setupObject);
  }
});

const importRefusalReason = computed(() => importRefusal(market.value?.phase));

/**
 * Why the assignment cannot be run in this market's phase, or null (`E10/F03/S02`).
 *
 * The same arrangement as importing: the server enforces it, and this lets the button say no
 * before it is pressed rather than after. Safe to freeze now that a placement can be changed by
 * hand from the Tables view - shipping the freeze first would have stranded an organizer on
 * market day with archiving a running market as their only move.
 */
const assignRefusalReason = computed(() => assignRefusal(market.value?.phase));

/** Guidance for a form the organizer has not finished starting; not a mistake to flag in red. */
/**
 * How vendors reach this market. Settable while it is a draft and frozen afterwards, which is what
 * the back end enforces - this only stops an organizer reaching for something that would be
 * refused (E18/F04/S01).
 */
const intakeEditable = computed(() => market.value?.phase === MarketPhase.Draft);

function handleUpdateIntakeMode(mode: IntakeMode) {
  if (!market.value) return;
  market.value.intakeMode = mode;
  void savePlan();
}

const updateMarket = async () => {
  localStorage.setItem('market', JSON.stringify(market.value));
  await api.put('/markets/' + market.value!.id, market.value);
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
  if (!market.value?.id) return;
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
      market.value.setupObject = newSetupObject;
      localStorage.setItem('market', JSON.stringify(market.value));
      schedulePlanSave();
    }
  });
};

const assignError = ref('');

/**
 * Run the assignment, or say why it was refused.
 *
 * The back end refuses the whole run when an approved application is missing an answer the
 * solver needs, naming the applicants, because an assignment that looks complete with someone
 * silently missing is worse than no assignment. That refusal has to reach the organizer: this
 * used to let the error escape unhandled, so the button did nothing at all and the page simply
 * sat there.
 */
/** Changes when an assignment has just been stored, so the results below re-read it. */
const assignedAt = ref(0);

const handleAssign = async () => {
  if (!assignmentOptionsComplete.value || assignRefusalReason.value) {
    return;
  }
  assignError.value = '';
  try {
    await updateMarket();

    // POST, not GET-then-PUT. `assignmentObject` is server-owned (E11/F01/S01), so a market PUT
    // no longer stores an assignment the browser was handed - and never should have: a stale
    // copy in one tab could overwrite what another had just saved.
    const response = await api.post('/markets/' + market.value!.id + '/assignment');

    const assignedMarket: Market = response.data;
    market.value = assignedMarket;
    localStorage.setItem('market', JSON.stringify(market.value));

    // The results read the assignment when they mount, and the organizer is already looking at
    // them - so say that it changed.
    assignedAt.value = Date.now();
    showTab('assignment');
  } catch (err: unknown) {
    const detail = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
    assignError.value = detail || 'Assignment failed. Please try again.';
  }
};

function handlePathChoice(path: 'manual' | 'floorplan') {
  showPathChoice.value = false;
  if (path === 'floorplan') {
    router.push({
      path: '/floorplan-editor',
      query: { marketId: market.value?.id },
    });
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
  <NoMarketLoaded v-if="!market" shows="a market's plan and application form" />
  <div v-else class="market-setup-view">
    <ChoosePathOverlay v-if="showPathChoice" @select="handlePathChoice" />
    <div class="market-setup-body">
      <div class="settings-container">
        <div class="settings-header">
          <!-- The market's own name, so the page says which market this is. It read "Settings" on
               every market, and the route (/market-setup) carries no id to tell them apart. -->
          <h1 data-testid="market-setup-title">{{ market.name }}</h1>
          <!--
            Navigation along the spine, not four peers (E18/F02/S02).

            The plan comes BEFORE the form, because the form is built from it - the back end says
            the essential questions' offering "is never an independent list: it is the market plan
            itself", and the old left-to-right order stated the dependency backwards.

            Every surface stays reachable: the plan is editable in every phase, and an organizer
            looking back at what they asked applicants is not doing anything wrong. What the bar
            adds is WHERE THE MARKET IS - `aria-current` and a mark on the surface this phase is
            worked on - so the bar and the rail beneath it say the same thing.
          -->
          <div class="tab-bar">
            <button
              :class="[
                'tab-button',
                {
                  active: activeTab === 'setup',
                  current: isCurrentSurface('setup', market?.phase),
                },
              ]"
              :aria-current="isCurrentSurface('setup', market?.phase) ? 'step' : undefined"
              @click="showTab('setup')"
              data-testid="market-setup-setup-tab"
            >
              Market Setup
            </button>
            <button
              :class="[
                'tab-button',
                { active: activeTab === 'form', current: isCurrentSurface('form', market?.phase) },
              ]"
              @click="showTab('form')"
              data-testid="market-setup-form-tab"
            >
              Application Form
            </button>
            <button
              :class="[
                'tab-button',
                {
                  active: activeTab === 'applications',
                  current: isCurrentSurface('applications', market?.phase),
                },
              ]"
              :aria-current="isCurrentSurface('applications', market?.phase) ? 'step' : undefined"
              @click="showTab('applications')"
              data-testid="market-setup-applications-tab"
            >
              Applications
            </button>
            <button
              :class="[
                'tab-button',
                {
                  active: activeTab === 'assignment',
                  current: isCurrentSurface('assignment', market?.phase),
                },
              ]"
              :aria-current="isCurrentSurface('assignment', market?.phase) ? 'step' : undefined"
              @click="showTab('assignment')"
              data-testid="market-setup-assignment-tab"
            >
              Assignment Results
            </button>
          </div>
        </div>

        <!-- The lifecycle, directly below the market header and inside the card (E10/F01/S01).
             It used to float above the card as a strip of coloured pills. -->
        <PhaseRail
          :market="market"
          :beforeTransition="flushPlanSave"
          @phase-advanced="handlePhaseAdvanced"
        />

        <!-- Application Form Tab -->
        <MarketFormTab
          v-if="activeTab === 'form'"
          :market="market"
          :setupObject="setupObject"
          @update:formEditable="formEditable = $event"
          @update:formFields="formFields = $event"
        />

        <MarketPlanTab
          v-if="activeTab === 'setup'"
          :setupObject="setupObject"
          :market="market"
          :intakeEditable="intakeEditable"
          @update:setupObject="handleUpdateSetupObject"
          @update:intakeMode="handleUpdateIntakeMode"
          @choosePath="showPathChoice = true"
          @openForm="showTab('form')"
        />

        <!-- Applications Tab -->
        <MarketApplicationsTab
          v-if="activeTab === 'applications'"
          :market="market"
          :visible="activeTab === 'applications'"
          :formEditable="formEditable"
          :importRefusalReason="importRefusalReason"
        />

        <!-- Assignment Results, a tab rather than a place the organizer is pushed to. Reachable
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
          :assignedAt="assignedAt"
          @update:setupObject="handleUpdateSetupObject"
          @assign="handleAssign"
        />
      </div>
      <!-- A real, wired feature that sat here as a bare URL box between Back and Next, saying
           nothing about what it sends, when, or that it is optional. Silence about a working
           feature is worse than silence about a stub: the organizer who skips it never learns
           what they skipped, and the one who fills it in does not know what they just armed. -->
      <div v-if="activeTab === 'setup'" class="plan-actions">
        <!-- Whether what the organizer just typed is on the server. Nothing else on this page
             says so now that Next is gone. -->
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
    </div>
  </div>
</template>

<style scoped>
.plan-actions {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
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
  /* `safe` centres only while the content fits. Plain `center` splits any overflow
       evenly above and below, and content above the scroll origin cannot be reached at
       any scroll position - it would strand the organizer with no way back to the tabs. */
  justify-content: safe center;
  align-items: center;
}

/*
 * A card of the workspace width that grows to its content, while the PAGE scrolls (E16/F03).
 *
 * This was `width: 80%; height: 80%`, which `git log -S` dates to the first commit of this view in
 * Feb 2025 - scaffolding nobody chose. At 1920x1080 it gave the plan a 547px window for 1,032px of
 * content and could not scroll the page at all, so the organizer scrolled inside a box on a screen
 * that was 19% empty at the sides. Even the emptiest possible plan is 812px, so no market ever fit.
 */
.market-setup-body {
  width: 100%;
  max-width: var(--workspace-max);

  /*
   * A gutter on three sides (E17/F02/S02), so the panel reads as a card sitting on the page rather
   * than as the page itself. Top is deliberately absent: the panel meets the header above it.
   */
  padding: 0 var(--space-4) var(--space-4);
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.settings-container {
  align-self: stretch;
  flex: 1;
  min-height: 0;
  background-color: white;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
}

.settings-right-container {
  display: grid;
  grid-template-rows: 48% 4% 48%;
}

.settings-header {
  align-self: stretch;
  height: 50px;
  background-color: var(--mm-black);
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
}

.tab-bar {
  display: flex;
  flex-direction: row;
  gap: 2px;
}

.tab-button {
  padding: 6px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: var(--text-sm);
  color: var(--mm-text-muted-on-dark);
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s;
}

.tab-button:hover {
  color: var(--mm-border);
}

.tab-button.active {
  color: white;
  border-bottom-color: var(--mm-green);
}

/*
 * Where the market IS, as against which surface is open (E18/F02/S02).
 *
 * A dot rather than a second underline: the underline already means "you are looking at this", and
 * two treatments for two different ideas on one control is how a bar stops being readable. The
 * rail beneath says the same thing at length; this is the one-glance version.
 */
.tab-button.current::after {
  content: '';
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-left: var(--space-2);
  vertical-align: middle;
  border-radius: var(--radius-pill);
  background: var(--mm-green);
}

.settings-body {
  align-self: stretch;
  display: flex;
  gap: 30px;
  padding: 40px;
}

/* Each of these lays its cards out in a single row. The row must be `minmax(0, 1fr)`:
   an auto row grows to its tallest card's content, which the cards then resolve their
   `height: 100%` against, so the whole settings panel outgrows the viewport. */
.single-column-body {
  align-self: stretch;
  flex-grow: 1;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: minmax(0, 1fr);
  gap: 30px;
  min-height: 0;
  flex: 1;
}

h1 {
  text-align: center;
  font-size: var(--text-2xl);
  color: white;
}

/*
 * Height, padding, radius, type, focus and the disabled state come from `.btn btn--primary`
 * (E17/F03/S02). This re-decided all of them, and set its label at `--text-lg` - which the scale
 * documents as "section headings, card titles", two steps above the `--text-sm` it names for
 * BUTTONS. Only the minimum footprint is this screen's own.
 */
.done-button {
  margin-top: 15px;
  min-width: 100px;
}

.assign-disabled-hint {
  margin: 6px 0 0;
  font-size: var(--text-xs);
  color: rgba(39, 35, 35, 0.65);
}

.assign-error-banner {
  margin-top: 10px;
  max-width: 520px;
}

.retry-button:hover {
  background: var(--mm-red);
  color: white;
}
</style>
