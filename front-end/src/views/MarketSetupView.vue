<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import ElementSettingContainer from '@/components/elements/ElementSettingContainer.vue';
import ElementMarketDates from '@/components/elements/ElementMarketDates.vue';
import ElementAssignmentPriority from '@/components/elements/ElementAssignmentPriority.vue';
import ElementAssignmentOptions from '@/components/elements/ElementAssignmentOptions.vue';
import ElementTierSetup from '@/components/elements/ElementTierSetup.vue';
import ElementLocationSetup from '@/components/elements/ElementLocationSetup.vue';
import ElementSectionSetup from '@/components/elements/ElementSectionSetup.vue';
import ChoosePathOverlay from '@/components/floorplan/ChoosePathOverlay.vue';
import {
  type SetupObject,
  type Market,
  type ApplicationForm,
  type EssentialFormOptions,
} from '@/assets/types/datatypes';
import { api, getApiErrorMessage, getApiErrorStatus } from '@/utils/api';
import { applicationFormError, applicationFormHint } from '@/utils/applicationForm';
import { importRefusal } from '@/utils/importPhase';
import { assignRefusal } from '@/utils/assignPhase';
import { EMPTY_ESSENTIAL_OPTIONS, essentialOptionsFromSetup } from '@/utils/essentialFields';
import FormBuilder from '@/components/application/FormBuilder.vue';
import FormPreview from '@/components/application/FormPreview.vue';
import EssentialFieldsPanel from '@/components/application/EssentialFieldsPanel.vue';
import ApplicationMonitor from '@/components/application/ApplicationMonitor.vue';
import AssignmentResults from '@/components/AssignmentResults.vue';
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
type MarketTab = 'form' | 'setup' | 'applications' | 'assignment';
const MARKET_TABS: MarketTab[] = ['form', 'setup', 'applications', 'assignment'];

const route = useRoute();

function tabFromRoute(): MarketTab {
  const asked = String(route.query.tab ?? '');
  return (MARKET_TABS as string[]).includes(asked) ? (asked as MarketTab) : 'setup';
}

const activeTab = ref<MarketTab>(tabFromRoute());

function showTab(tab: MarketTab) {
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
const applicationForm = ref<ApplicationForm | null>(null);
/**
 * Per-field "the organizer typed this key themselves" flags, positionally aligned with the
 * form's fields. It lives beside the form, whose lifetime it shares, rather than inside the
 * FormBuilder that tabbing away unmounts. It records intent, which a stored key cannot: an
 * auto-derived key and a hand-typed one are indistinguishable once written. Only a direct edit
 * of a key input and the stored-form seed in {@link adoptStoredApplicationForm} ever write it.
 */
const keyTouched = ref<boolean[]>([]);
const formSaveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
const formErrorMessage = ref<string | null>(null);
const formLockReason = ref<string | null>(null);
const formLoadStatus = ref<'loading' | 'loaded' | 'error'>('loading');
const formLoadError = ref<string | null>(null);
const formLocked = computed(() => formLockReason.value !== null);
/**
 * Only edit a form we know to be editable. Until the server answers - the load is still in
 * flight, or it failed - the lock state is unknown, and assuming "editable" there invites the
 * organizer to rework a locked form and lose it to a 409.
 */
const formEditable = computed(() => formLoadStatus.value === 'loaded' && !formLocked.value);
/**
 * No answer from the server and nothing cached tells us nothing about the market's form - not
 * even whether it has one - so there is nothing we can honestly render but the load state.
 */
const formStateUnknown = computed(
  () => formLoadStatus.value !== 'loaded' && applicationForm.value === null,
);
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
const serverEssentialOptions = ref<EssentialFormOptions | null>(null);
/**
 * What the essential questions offer right now. While the form is editable it follows the
 * organizer's local market plan live - an unsaved date shows up immediately - and once the form
 * is locked it is the server's frozen offering, which local plan edits can no longer move.
 */
const essentialOptions = computed<EssentialFormOptions>(() => {
  // The declaration of which questions this market asks lives on the FORM, and the offering is
  // derived or frozen - so it has to be carried across, or an unasked question reappears the
  // moment the offering is recomputed. Mirrors `_with_unasked` in back-end/essential_fields.py.
  const unasked = applicationForm.value?.unaskedEssentials ?? [];
  const base = formLocked.value
    ? (serverEssentialOptions.value ?? EMPTY_ESSENTIAL_OPTIONS)
    : essentialOptionsFromSetup(setupObject);
  return unasked.length ? { ...base, unasked } : base;
});

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

  // Paint the cached form immediately, then reconcile with the server, which also
  // tells us whether the form is still editable.
  adoptStoredApplicationForm(market.value?.applicationForm ?? null);
  loadApplicationForm();
});

/**
 * The market document is the single source of truth for the form; keep it in step. The key flags
 * are the organizer's intent, so they are left exactly as they are: a save hands back the same
 * fields it was given, and saving does not make an auto-derived key a hand-typed one.
 */
function adoptApplicationForm(form: ApplicationForm | null) {
  applicationForm.value = form;
  if (market.value) {
    market.value.applicationForm = form ?? undefined;
    localStorage.setItem('market', JSON.stringify(market.value));
  }
}

/**
 * Adopt a form read back from storage, dropping whatever the organizer had in flight. Its keys
 * are already stored as those fields' answer keys, so re-labelling one must never rewrite it:
 * seed every flag as the organizer's own. The one place the flags come from field data.
 */
function adoptStoredApplicationForm(form: ApplicationForm | null) {
  adoptApplicationForm(form);
  keyTouched.value = (form?.fields ?? []).map(() => true);
}

async function loadApplicationForm() {
  if (!market.value?.id) {
    formLoadStatus.value = 'error';
    formLoadError.value = 'No market is loaded, so its application form is unknown.';
    return;
  }
  formLoadStatus.value = 'loading';
  formLoadError.value = null;
  try {
    const response = await api.get(`/markets/${market.value.id}/application-form`);
    adoptStoredApplicationForm(response.data?.application_form ?? null);
    formLockReason.value = response.data?.lock_reason ?? null;
    serverEssentialOptions.value = response.data?.essential_options ?? null;
    formLoadStatus.value = 'loaded';
  } catch (err: unknown) {
    formLoadStatus.value = 'error';
    formLoadError.value = getApiErrorMessage(
      err,
      'Could not load the application form. Retry before editing it.',
    );
  }
}

/** Why importing is refused in this market's phase, or null. Mirrors the server's own rule. */
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
const formIncompleteHint = computed(() => applicationFormHint(applicationForm.value));

const formValidationError = computed(() => applicationFormError(applicationForm.value));

const canSaveForm = computed(
  () =>
    formEditable.value &&
    formIncompleteHint.value === null &&
    formValidationError.value === null &&
    formSaveStatus.value !== 'saving',
);

const savedStatusTimer = ref<ReturnType<typeof setTimeout> | null>(null);

function clearSavedStatusTimer() {
  if (savedStatusTimer.value !== null) {
    clearTimeout(savedStatusTimer.value);
    savedStatusTimer.value = null;
  }
}

onUnmounted(clearSavedStatusTimer);

/**
 * Switch a preference ordering on or off for this market (E01/F06).
 *
 * Saved immediately rather than on the form's Save button: it is a property of what the market
 * asks, not of the custom fields being edited, and Save is disabled until a custom field exists.
 * The back end refuses anything but a ranking, so this cannot turn off a constraint.
 */
async function handleToggleUnasked(key: string, unasked: boolean) {
  if (!market.value?.id || !formEditable.value) return;
  const current = applicationForm.value ?? { fields: [] };
  const next = new Set(current.unaskedEssentials ?? []);
  if (unasked) {
    next.add(key);
  } else {
    next.delete(key);
  }
  const updated = { ...current, unaskedEssentials: [...next] };
  formErrorMessage.value = null;
  // This writes immediately through its own endpoint, unlike the custom fields beside it which
  // wait for Save Form. Reporting through the same status is what tells the organizer which of
  // their changes are already persisted; it used to save in complete silence.
  clearSavedStatusTimer();
  formSaveStatus.value = 'saving';
  try {
    const response = await api.put(`/markets/${market.value.id}/application-form`, updated);
    adoptApplicationForm(response.data?.application_form ?? updated);
    formSaveStatus.value = 'saved';
    savedStatusTimer.value = setTimeout(() => {
      savedStatusTimer.value = null;
      if (formSaveStatus.value === 'saved') formSaveStatus.value = 'idle';
    }, 2000);
  } catch (err: unknown) {
    formSaveStatus.value = 'error';
    formErrorMessage.value = getApiErrorMessage(err, 'Could not update the form.');
  }
}

async function saveApplicationForm() {
  if (!market.value?.id || !canSaveForm.value) return;
  clearSavedStatusTimer();
  formSaveStatus.value = 'saving';
  formErrorMessage.value = null;
  try {
    const response = await api.put(
      `/markets/${market.value.id}/application-form`,
      applicationForm.value,
    );
    formSaveStatus.value = 'saved';
    if (response.data?.application_form) {
      adoptApplicationForm(response.data.application_form);
    }
    savedStatusTimer.value = setTimeout(() => {
      savedStatusTimer.value = null;
      if (formSaveStatus.value === 'saved') formSaveStatus.value = 'idle';
    }, 2000);
  } catch (err: unknown) {
    formSaveStatus.value = 'error';
    formErrorMessage.value = getApiErrorMessage(err, 'Failed to save form');
    // A 409 means the server locked the form under us; stop presenting the rejected edits as
    // editable, and put back the form applicants will actually see.
    if (getApiErrorStatus(err) === 409) {
      formLockReason.value = formErrorMessage.value;
      await loadApplicationForm();
    }
  }
}

const updateMarket = async () => {
  localStorage.setItem('market', JSON.stringify(market.value));
  await api.put('/markets/' + market.value!.id, market.value);
};

const handleDiscordWebhookInput = (event: Event) => {
  if (!market.value) return;
  const value = (event.target as HTMLInputElement).value;
  const trimmed = value.trim();
  market.value.discordWebhookUrl = trimmed === '' ? null : value;
  localStorage.setItem('market', JSON.stringify(market.value));
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
const sectionsUndescribed = computed(
  () =>
    setupObject.sections.length === 0 &&
    !(setupObject.floorplans && setupObject.floorplans.length > 0),
);
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
          <div class="tab-bar">
            <button
              :class="['tab-button', { active: activeTab === 'form' }]"
              @click="showTab('form')"
              data-testid="market-setup-form-tab"
            >
              Application Form
            </button>
            <button
              :class="['tab-button', { active: activeTab === 'setup' }]"
              @click="showTab('setup')"
              data-testid="market-setup-setup-tab"
            >
              Market Setup
            </button>
            <button
              :class="['tab-button', { active: activeTab === 'applications' }]"
              @click="showTab('applications')"
              data-testid="market-setup-applications-tab"
            >
              Applications
            </button>
            <button
              :class="['tab-button', { active: activeTab === 'assignment' }]"
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
        <div v-if="activeTab === 'form'" class="settings-body">
          <div class="double-column-body">
            <ElementSettingContainer>
              <template #setting-title>
                <h2>Form Builder</h2>
              </template>
              <template #setting-content>
                <div class="form-builder-container">
                  <div
                    v-if="formLocked"
                    class="form-lock-banner"
                    data-testid="form-builder-lock-banner"
                  >
                    {{ formLockReason }}
                  </div>
                  <div
                    v-else-if="formLoadStatus === 'error'"
                    class="form-load-error-banner"
                    data-testid="form-builder-load-error"
                  >
                    <span>{{ formLoadError }}</span>
                    <button
                      class="retry-button"
                      @click="loadApplicationForm()"
                      data-testid="form-builder-retry-button"
                    >
                      Retry
                    </button>
                  </div>
                  <div
                    v-else-if="formLoadStatus === 'loading'"
                    class="form-loading-banner"
                    data-testid="form-builder-loading"
                  >
                    Loading the application form...
                  </div>
                  <EssentialFieldsPanel
                    v-if="!formStateUnknown"
                    :options="essentialOptions"
                    :locked="formLocked"
                    :editable="formEditable"
                    @toggleUnasked="handleToggleUnasked"
                  />
                  <FormBuilder
                    v-if="!formStateUnknown"
                    :applicationForm="applicationForm"
                    :keyTouched="keyTouched"
                    :readonly="!formEditable"
                    @update:applicationForm="(form: ApplicationForm) => (applicationForm = form)"
                    @update:keyTouched="(touched: boolean[]) => (keyTouched = touched)"
                  />
                  <div v-if="formEditable" class="form-save-row">
                    <button
                      class="done-button"
                      :disabled="!canSaveForm"
                      @click="saveApplicationForm()"
                      data-testid="form-builder-save-button"
                    >
                      {{ formSaveStatus === 'saving' ? 'Saving...' : 'Save Form' }}
                    </button>
                    <span
                      v-if="formSaveStatus === 'saved'"
                      class="save-status success"
                      data-testid="form-builder-save-success"
                    >
                      Saved
                    </span>
                    <span
                      v-else-if="formSaveStatus === 'error'"
                      class="save-status error"
                      data-testid="form-builder-save-error"
                    >
                      {{ formErrorMessage }}
                    </span>
                    <span
                      v-else-if="formValidationError"
                      class="save-status error"
                      data-testid="form-builder-validation-error"
                    >
                      {{ formValidationError }}
                    </span>
                    <span
                      v-else-if="formIncompleteHint"
                      class="save-status hint"
                      data-testid="form-builder-save-hint"
                    >
                      {{ formIncompleteHint }}
                    </span>
                  </div>
                </div>
              </template>
            </ElementSettingContainer>
            <ElementSettingContainer>
              <template #setting-title>
                <h2>Preview</h2>
              </template>
              <template #setting-content>
                <FormPreview
                  v-if="!formStateUnknown"
                  :applicationForm="applicationForm"
                  :essentialOptions="essentialOptions"
                />
                <p v-else class="preview-unavailable" data-testid="form-preview-unavailable">
                  Preview unavailable until the application form loads.
                </p>
              </template>
            </ElementSettingContainer>
          </div>
        </div>

        <!-- Market Setup Tab: the whole plan, one page.
             It was three wizard pages, which implied an ordering the data does not have. The only
             dependency worth respecting - tiers and locations before a section can reference one -
             lives entirely within the second row, and the only cross-row one is that the market's
             dates bound the max-assignments clamp, which the organizer can now see move. Paging it
             was the same mistake as the wizard pretending to be the lifecycle, one level down. -->
        <div v-if="activeTab === 'setup'" class="settings-body settings-body-plan">
          <section class="plan-row plan-row--single">
            <ElementSettingContainer>
              <template #setting-title>
                <h2>Market Dates</h2>
              </template>
              <template #setting-content>
                <ElementMarketDates
                  :setupObject="setupObject"
                  @update:setupObject="handleUpdateSetupObject"
                />
              </template>
            </ElementSettingContainer>
          </section>

          <section class="plan-row plan-row--triple">
            <ElementSettingContainer>
              <template #setting-title>
                <h2>Tier Setup</h2>
              </template>
              <template #setting-content>
                <ElementTierSetup
                  :setupObject="setupObject"
                  @update:setupObject="handleUpdateSetupObject"
                />
              </template>
            </ElementSettingContainer>
            <ElementSettingContainer>
              <template #setting-title>
                <h2>Location Setup</h2>
              </template>
              <template #setting-content>
                <ElementLocationSetup
                  :setupObject="setupObject"
                  @update:setupObject="handleUpdateSetupObject"
                />
              </template>
            </ElementSettingContainer>
            <ElementSettingContainer>
              <template #setting-title>
                <h2>Section Setup</h2>
              </template>
              <template #setting-content>
                <!-- The choice belongs here, where sections are described, rather than over the
                     whole page - and it is offered rather than imposed. -->
                <button
                  v-if="sectionsUndescribed"
                  type="button"
                  class="section-path-button"
                  @click="showPathChoice = true"
                  data-testid="market-setup-choose-path-button"
                >
                  Set up sections from a floorplan instead
                </button>
                <ElementSectionSetup
                  :setupObject="setupObject"
                  @update:setupObject="handleUpdateSetupObject"
                />
              </template>
            </ElementSettingContainer>
          </section>

          <section class="plan-row plan-row--asymmetric">
            <ElementSettingContainer>
              <template #setting-title>
                <h2>Assignment Priority</h2>
              </template>
              <template #setting-content>
                <ElementAssignmentPriority
                  :setupObject="setupObject"
                  :formFields="applicationForm?.fields ?? []"
                  @update:setupObject="handleUpdateSetupObject"
                />
              </template>
            </ElementSettingContainer>
            <ElementSettingContainer>
              <template #setting-title>
                <h2>Assignment Options</h2>
              </template>
              <template #setting-content>
                <ElementAssignmentOptions
                  :setupObject="setupObject"
                  @update:setupObject="handleUpdateSetupObject"
                />
              </template>
            </ElementSettingContainer>
          </section>
        </div>

        <!-- Applications Tab -->
        <!-- `settings-body` lays its children out in a row, which is right for the two-card tabs
             but put the import button in a dead column beside the list. This one stacks. -->
        <div v-if="activeTab === 'applications'" class="settings-body settings-body-stacked">
          <!-- The button used to be live in every phase and navigate to a page whose only
               content was the refusal. The gate is right; being told before the click is the
               part that was missing. -->
          <div class="applications-toolbar">
            <button
              class="import-entry-button"
              :disabled="importRefusalReason !== null"
              data-testid="market-setup-import-button"
              @click="router.push({ name: 'import-applications' })"
            >
              Import from CSV
            </button>
            <span
              v-if="importRefusalReason"
              class="import-entry-hint import-entry-hint--blocked"
              data-testid="market-setup-import-blocked-reason"
            >
              {{ importRefusalReason }}
            </span>
            <span v-else class="import-entry-hint">
              Bring in the responses you already collected, as a CSV from any form tool or
              spreadsheet.
            </span>
          </div>
          <ApplicationMonitor
            :market="market"
            :visible="activeTab === 'applications'"
            :formEditable="formEditable"
          />
        </div>

        <!-- Assignment Results, a tab rather than a place the organizer is pushed to. Reachable
             in every phase, and nothing on it posts a transition: publishing is a step on the
             phase strip above, and "I have finished looking at this" is what leaving a page
             already is. -->
        <div v-if="activeTab === 'assignment'" class="settings-body settings-body-stacked">
          <AssignmentResults />
        </div>
      </div>
      <!-- A real, wired feature that sat here as a bare URL box between Back and Next, saying
           nothing about what it sends, when, or that it is optional. Silence about a working
           feature is worse than silence about a stub: the organizer who skips it never learns
           what they skipped, and the one who fills it in does not know what they just armed. -->
      <div v-if="activeTab === 'setup'" class="discord-webhook-row">
        <div class="discord-webhook-heading">
          <label class="discord-webhook-label" for="discord-webhook-url">
            Discord webhook URL <span class="discord-webhook-optional">optional</span>
          </label>
          <p class="discord-webhook-help">
            Paste one and a Send to Discord button on the results screen will post the finished
            assignment to that channel. Nothing is sent until you press it.
          </p>
        </div>
        <input
          id="discord-webhook-url"
          type="url"
          class="discord-webhook-input"
          placeholder="https://discord.com/api/webhooks/..."
          :value="market?.discordWebhookUrl ?? ''"
          @input="handleDiscordWebhookInput"
          @change="updateMarket"
          data-testid="market-setup-discord-webhook-input"
        />
      </div>
      <!-- Back and Next are gone with the paging: the plan is one page, so there is nowhere to
           page to. Assign is the only action here, and it no longer needs to say which page it
           belongs to. -->
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
        <button
          type="button"
          class="done-button"
          :disabled="!assignmentOptionsComplete || !!assignRefusalReason"
          @click="handleAssign"
          data-testid="market-setup-assign-button"
        >
          Assign
        </button>
        <!-- The phase comes first: a market that may not be assigned at all is not waiting on
             two numbers, and saying so would send the organizer to fix the wrong thing. -->
        <p
          v-if="assignRefusalReason"
          class="assign-disabled-hint"
          data-testid="market-setup-assign-phase-hint"
        >
          {{ assignRefusalReason }}
        </p>
        <p
          v-else-if="!assignmentOptionsComplete"
          class="assign-disabled-hint"
          data-testid="market-setup-assign-hint"
        >
          Set both assignment options above to run the assignment.
        </p>
        <div
          v-if="assignError"
          class="form-load-error-banner assign-error-banner"
          data-testid="market-setup-assign-error"
        >
          <span>{{ assignError }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The plan is one scrolling page of rows rather than a row of cards, so it overrides
   `.settings-body`'s single-row flex. */
.settings-body-plan {
  flex-direction: column;
  gap: 30px;
  overflow-y: auto;
}

.plan-row {
  display: grid;
  gap: 30px;
  align-items: stretch;
  /* Each row sizes to its own content; the page scrolls, not the rows. */
  flex: 0 0 auto;
  min-height: 320px;
}

.plan-row--single {
  grid-template-columns: minmax(0, 1fr);
}

.plan-row--triple {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.plan-row--asymmetric {
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
}

.plan-actions {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.section-path-button {
  align-self: flex-start;
  margin-bottom: 8px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--mm-border);
  background: white;
  font-size: 13px;
  color: var(--mm-text-link);
  cursor: pointer;
}

.section-path-button:hover {
  border-color: var(--mm-text-link);
}

.plan-save-status {
  font-size: 13px;
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

.applications-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.import-entry-button {
  height: 36px;
  padding: 0 16px;
  border-radius: 6px;
  border: 1px solid var(--mm-green);
  background: var(--mm-green);
  color: white;
  font-size: 14px;
  cursor: pointer;
}

.import-entry-button:disabled {
  background: var(--mm-border);
  border-color: var(--mm-border);
  color: var(--mm-black);
  cursor: not-allowed;
}

.import-entry-hint {
  font-size: 13px;
  color: var(--mm-text-muted);
}

.import-entry-hint--blocked {
  color: var(--mm-text-yellow);
  max-width: 60ch;
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

.market-setup-body {
  width: 80%;
  height: 80%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: safe center;
  align-items: center;
}

.settings-container {
  align-self: stretch;
  flex: 1;
  min-height: 0;
  background-color: white;
  box-shadow: 0px 0px 4px 5px rgba(0, 0, 0, 0.25);
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
  font-size: 14px;
  color: var(--mm-text-muted-on-dark);
  cursor: pointer;
  transition:
    color 0.15s,
    border-color 0.15s;
}

.tab-button:hover {
  color: #ddd;
}

.tab-button.active {
  color: white;
  border-bottom-color: var(--mm-green);
}

.settings-body {
  align-self: stretch;
  flex-grow: 1;
  display: flex;
  gap: 30px;
  padding: 40px;
  min-height: 0;
  flex: 1;
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

.double-column-body {
  align-self: stretch;
  flex-grow: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: minmax(0, 1fr);
  gap: 30px;
  min-height: 0;
  flex: 1;
}

h1 {
  text-align: center;
  font-size: 30px;
  color: white;
}

h2 {
  font-family: 'Merge One';
  text-align: left;
  font-size: 20px;
  color: white;
}

.done-button {
  margin-top: 15px;
  /* Sized to fit the label, with the original 100x35 box as the floor so the
       single-word buttons ("Back", "Next", "Assign") keep their footprint. */
  min-width: 100px;
  min-height: 35px;
  padding: 0 14px;

  background: var(--mm-green);
  border-radius: 5px;
  border: none;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;

  font-family: 'Merge One';
  font-style: normal;
  font-weight: 400;
  font-size: 20px;
  line-height: 1.2;
  text-align: center;

  color: #ffffff;
}

.done-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.discord-webhook-row {
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
  margin-top: 15px;
}

.discord-webhook-heading {
  max-width: 420px;
}

.discord-webhook-label {
  font-size: 14px;
  color: var(--mm-black);
}

.discord-webhook-optional {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--mm-text-muted);
}

.discord-webhook-help {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--mm-text-muted);
}

.discord-webhook-input {
  flex: 1;
  height: 32px;
  padding: 4px 10px;
  font-size: 14px;
  border: 1px solid var(--mm-border);
  border-radius: 5px;
  background-color: white;
}

.form-builder-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  overflow-y: auto;
}

.form-save-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--mm-border);
}

.form-lock-banner {
  font-size: 13px;
  line-height: 1.4;
  color: #7a5200;
  background: #fff6e0;
  border: 1px solid #f0d089;
  border-radius: 6px;
  padding: 10px 12px;
}

.form-loading-banner {
  font-size: 13px;
  line-height: 1.4;
  color: var(--mm-text-muted);
  background: #f4f4f4;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 10px 12px;
}

.assign-disabled-hint {
  margin: 6px 0 0;
  font-size: 0.85rem;
  color: rgba(39, 35, 35, 0.65);
}

.assign-error-banner {
  margin-top: 10px;
  max-width: 520px;
}

.form-load-error-banner {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  line-height: 1.4;
  color: #8a1f1f;
  background: #fdeaea;
  border: 1px solid #f0a9a9;
  border-radius: 6px;
  padding: 10px 12px;
}

.retry-button {
  flex-shrink: 0;
  background: none;
  border: 1px solid #8a1f1f;
  color: #8a1f1f;
  border-radius: 4px;
  padding: 3px 12px;
  cursor: pointer;
  font-size: 12px;
}

.retry-button:hover {
  background: #8a1f1f;
  color: white;
}

.save-status {
  font-size: 13px;
}

.save-status.success {
  color: var(--mm-green);
}

.save-status.error {
  color: var(--mm-red, #cc0000);
}

.save-status.hint {
  color: var(--mm-text-muted);
}

.preview-unavailable {
  font-size: 14px;
  color: var(--mm-text-muted);
  text-align: center;
  padding: 40px;
}
</style>
