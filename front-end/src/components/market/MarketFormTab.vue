<script setup lang="ts">
/**
 * The application form tab's body (E18/F02/S01).
 *
 * Extracted from `MarketSetupView`, which held all four tab bodies inline across 1300 lines along
 * with each one's state. The DOM and every `data-testid` are unchanged - this is the prefactor
 * that makes `S02`'s shell change a shell change rather than a whole-file rewrite carrying a
 * fifteen-spec migration.
 *
 * It owns the form: the document, its load and save status, the lock, and what the essential
 * questions offer. What it cannot own arrives as props - the market it belongs to, and the PLAN,
 * because while the form is editable the essential offering follows the organizer's local plan
 * Two things others need back, so they are emitted rather than reached for: whether the form is
 * editable, which the applications tab reads, and the form's FIELDS, which the plan's assignment
 * priority offers as the questions a rule can order by.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useMarketStore } from '@/stores/market';
import ElementSettingContainer from '@/components/elements/ElementSettingContainer.vue';
import FormBuilder from '@/components/application/FormBuilder.vue';
import FormPreview from '@/components/application/FormPreview.vue';
import EssentialFieldsPanel from '@/components/application/EssentialFieldsPanel.vue';
import ReviewHighlights from '@/components/application/ReviewHighlights.vue';
import { useReviewHighlights } from '@/utils/reviewHighlights';
import { api, getApiErrorMessage, getApiErrorStatus } from '@/utils/api';
import { applicationFormError, applicationFormHint } from '@/utils/applicationForm';
import { EMPTY_ESSENTIAL_OPTIONS, essentialOptionsFromSetup } from '@/utils/essentialFields';
import type {
  ApplicationForm,
  EssentialFormOptions,
  Market,
  SetupObject,
} from '@/assets/types/datatypes';

const props = defineProps<{ market: Market | null; setupObject: SetupObject }>();
/** A save is a write, so it is followed by the store re-reading the market (E21/F02/S02). */
const marketStore = useMarketStore();

const market = computed(() => props.market);

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
const formLoadStatus = ref<'loading' | 'loaded' | 'error'>('loading');
const formLoadError = ref<string | null>(null);
/**
 * Why the form cannot be edited, read off the MARKET (E21/F02/S03).
 *
 * It used to be fetched once, when this tab mounted, and nothing re-read it: open applications from
 * the rail and Add field stayed live; reopen and a notice named a phase the rail directly above it
 * contradicted. The server computes it on every read of the market, and the store re-reads the
 * market after every write - a transition included - so it is right the moment one lands.
 */
const formLockReason = computed(() => market.value?.applicationFormLockReason ?? null);
const formLockKnown = computed(() => market.value?.applicationFormLockReason !== undefined);
const formLocked = computed(() => formLockReason.value !== null);
/**
 * Only edit a form we know to be editable. Until the server answers - the load is still in
 * flight, it failed, or the market in hand has not said whether it is locked - the lock state is
 * unknown, and assuming "editable" there invites the organizer to rework a locked form and lose it
 * to a 409.
 */
const formEditable = computed(
  () => formLoadStatus.value === 'loaded' && formLockKnown.value && !formLocked.value,
);
/**
 * No answer from the server and nothing cached tells us nothing about the market's form - not
 * even whether it has one - so there is nothing we can honestly render but the load state.
 */
const formStateUnknown = computed(
  () => formLoadStatus.value !== 'loaded' && applicationForm.value === null,
);

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
    : essentialOptionsFromSetup(props.setupObject);
  return unasked.length ? { ...base, unasked } : base;
});

/**
 * Take the form the server holds as this tab's working copy. The key flags are the organizer's
 * intent, so they are left exactly as they are: a save hands back the same fields it was given,
 * and saving does not make an auto-derived key a hand-typed one.
 *
 * It used to write the form onto the market it was handed, and into `localStorage`, so the rest of
 * the page would see it. The market belongs to the store now (E21/F02/S02): a save is followed by
 * the store re-reading it, which is how every other surface learns the form changed.
 */
function adoptApplicationForm(form: ApplicationForm | null) {
  applicationForm.value = form;
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
    void marketStore.refresh();
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
    void marketStore.refresh();
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
      await Promise.all([marketStore.refresh(), loadApplicationForm()]);
    }
  }
}

/**
 * Which answers a reviewer reads first. Saved to its own endpoint, not through the market PUT:
 * the list is server-owned precisely because a reviewer changes it mid-queue (E19/F03).
 *
 * The queue changes the same list through the same composable, so the two screens cannot diverge.
 */
const { highlights, error: highlightsError, save: saveHighlights } = useReviewHighlights(market);

onMounted(() => {
  // Paint the cached form immediately, then reconcile with the server, which also
  // tells us whether the form is still editable.
  adoptStoredApplicationForm(market.value?.applicationForm ?? null);
  loadApplicationForm();
});

/**
 * A form that has just become locked - a transition landed while the organizer had edits in hand -
 * shows what applicants will actually see, rather than edits that can no longer be saved.
 */
watch(formLocked, (locked, wasLocked) => {
  if (locked && !wasLocked && formLoadStatus.value === 'loaded') void loadApplicationForm();
});
</script>

<template>
  <div class="settings-body">
    <div class="double-column-body">
      <ElementSettingContainer>
        <template #setting-title>
          <h2>Form Builder</h2>
        </template>
        <template #setting-content>
          <div class="form-builder-container">
            <div v-if="formLocked" class="form-lock-banner" data-testid="form-builder-lock-banner">
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
            <!--
              Which answers a reviewer reads first (E19/F03/S01). NOT gated on `formEditable`: the
              form freezes at the first application, and this deliberately does not, because an
              organizer only finds out which answers they needed once they are reviewing.
            -->
            <div v-if="!formStateUnknown" class="review-highlights-block">
              <h3 class="review-highlights-title">What a reviewer reads first</h3>
              <ReviewHighlights
                :fields="applicationForm?.fields ?? []"
                :essentialOptions="essentialOptions"
                :highlights="highlights"
                @update:highlights="saveHighlights"
              />
              <p
                v-if="highlightsError"
                class="review-highlights-error"
                data-testid="review-highlights-error"
              >
                {{ highlightsError }}
              </p>
            </div>

            <div v-if="formEditable" class="form-save-row">
              <button
                class="btn btn--primary done-button"
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
</template>

<style scoped>
.review-highlights-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--mm-border);
}

.review-highlights-title {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.review-highlights-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}

.settings-body {
  align-self: stretch;
  display: flex;
  gap: 30px;
  padding: 40px;
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
.form-builder-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  overflow-y: auto;
}
.form-lock-banner {
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--mm-text-yellow-on-tint);
  background: rgba(228, 166, 41, 0.18);
  border: 1px solid var(--mm-yellow);
  border-radius: var(--radius-control);
  padding: 10px 12px;
}
.form-load-error-banner {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--mm-red);
  background: rgba(192, 57, 43, 0.14);
  border: 1px solid var(--mm-red);
  border-radius: var(--radius-control);
  padding: 10px 12px;
}
.retry-button {
  flex-shrink: 0;
  background: none;
  border: 1px solid var(--mm-red);
  color: var(--mm-red);
  border-radius: var(--radius-control);
  padding: 3px 12px;
  cursor: pointer;
  font-size: var(--text-xs);
}
.form-loading-banner {
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--mm-text-muted);
  background: var(--mm-beige);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-control);
  padding: 10px 12px;
}
/*
 * The confirm action sits at the row's right (E17/F03/S02). The row had no `justify-content`, so it
 * defaulted to the start and the save button sat bottom LEFT with its status messages trailing to
 * its right.
 *
 * `margin-left: auto` on the button rather than `justify-content: flex-end` on the row, so the
 * status - saved, the validation error, the incomplete hint - stays readable at the START of the
 * row instead of being crowded against the button.
 */
.form-save-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--mm-border);
}
.form-save-row .done-button {
  order: 1;
  margin-left: auto;
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
.save-status {
  font-size: var(--text-xs);
}
.save-status.success {
  color: var(--mm-green);
}
.save-status.error {
  color: var(--mm-red);
}
.save-status.hint {
  color: var(--mm-text-muted);
}
.preview-unavailable {
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
  text-align: center;
  padding: 40px;
}
</style>
