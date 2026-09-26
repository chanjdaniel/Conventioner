<script setup lang="ts">
/**
 * Fixing the form without leaving the import (E20/F03/S01).
 *
 * The wizard used to print four manual steps and two phase transitions - "reopen the market for
 * editing, turn it off in the form builder, then open applications and import again" - and the
 * organizer lost their upload on the way. This does the walk, and the wizard keeps the file, the
 * mapping and the cursor while it runs.
 *
 * It covers BOTH of the wizard's dead ends, because the source itself calls them the same shape:
 * a column with nowhere to go needs a custom field, and a question the form never asked needs
 * that question turned off. Either way the answer is an edit to the form.
 *
 * **Pre-flight, not rollback.** The server checks every guard on the return path against the
 * PROPOSED form before the market leaves its phase, so a refusal here has moved nothing. This
 * dialog mirrors the one refusal an organizer can cause - a form that would ask nothing - so it
 * is immediate, but the server is the authority and its answer is the one shown.
 */
import { computed, ref, watch } from 'vue';
import AppDialog from '@/components/AppDialog.vue';
import { api, getApiErrorMessage } from '@/utils/api';
import {
  ESSENTIAL_KEY_PREFIX,
  SECTION_RANKING_KEY,
  SECTION_RANKING_LABEL,
  TABLE_TYPE_RANKING_KEY,
  TABLE_TYPE_RANKING_LABEL,
  UNASKABLE_ESSENTIAL_KEYS,
  askedEssentialAnswers,
} from '@/utils/essentialFields';
import { FIELD_KEY_PATTERN } from '@/utils/applicationForm';
import type { ApplicationForm, EssentialFormOptions, FormField } from '@/assets/types/datatypes';

const props = defineProps<{
  open: boolean;
  marketId: string;
  /** The form as stored, which is what this dialog edits a copy of. */
  applicationForm: ApplicationForm | null;
  essentialOptions: EssentialFormOptions;
  /** Prefilled when the dialog was opened from a column with nowhere to go. */
  suggestedFieldLabel?: string;
  /** Prefilled when it was opened from a question the form never asked. */
  suggestedUnasked?: string;
  /** A form-intake market's public application page is off the air while the chain runs. */
  intakeIsForm: boolean;
}>();

const emit = defineEmits<{ close: []; amended: [form: ApplicationForm] }>();

const newFieldLabel = ref('');
const newFieldKey = ref('');
const unasked = ref<string[]>([]);
const keyTouched = ref(false);
const saving = ref(false);
const errorMessage = ref('');
const blockers = ref<string[]>([]);
const stalled = ref<{ message: string; canResume: boolean } | null>(null);

/** A label becomes a key until the organizer names one - the form builder's own rule. */
watch(newFieldLabel, (label) => {
  if (keyTouched.value) return;
  newFieldKey.value = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    newFieldLabel.value = props.suggestedFieldLabel ?? '';
    keyTouched.value = false;
    unasked.value = [...(props.applicationForm?.unaskedEssentials ?? [])];
    if (props.suggestedUnasked && !unasked.value.includes(props.suggestedUnasked)) {
      unasked.value.push(props.suggestedUnasked);
    }
    errorMessage.value = '';
    blockers.value = [];
    stalled.value = null;
  },
  { immediate: true },
);

/** Only rankings may be turned off, and only the ones this market's plan actually offers. */
const UNASKABLE_LABELS: Record<string, string> = {
  [SECTION_RANKING_KEY]: SECTION_RANKING_LABEL,
  [TABLE_TYPE_RANKING_KEY]: TABLE_TYPE_RANKING_LABEL,
};

/** What the essential questions currently ask, ignoring what is already turned off. */
const askedNow = computed(() =>
  askedEssentialAnswers({ ...props.essentialOptions, unasked: [] }).map((answer) => answer.key),
);

const togglable = computed(() =>
  UNASKABLE_ESSENTIAL_KEYS.filter((key) => askedNow.value.includes(key)).map((key) => ({
    key,
    label: UNASKABLE_LABELS[key] ?? key,
  })),
);

const existingFields = computed(() => props.applicationForm?.fields ?? []);

const keyError = computed(() => {
  if (!newFieldLabel.value.trim()) return '';
  const key = newFieldKey.value.trim();
  if (!FIELD_KEY_PATTERN.test(key)) {
    return 'Use lowercase letters, numbers and underscores only.';
  }
  if (key.startsWith(ESSENTIAL_KEY_PREFIX)) {
    return `Keys beginning "${ESSENTIAL_KEY_PREFIX}" belong to the essential questions.`;
  }
  if (existingFields.value.some((field) => field.key === key)) {
    return 'This market already asks a question with that key.';
  }
  return '';
});

/** The form this dialog would save. */
const proposed = computed<ApplicationForm>(() => {
  const fields: FormField[] = [...existingFields.value];
  const label = newFieldLabel.value.trim();
  if (label && !keyError.value) {
    fields.push({
      key: newFieldKey.value.trim(),
      label,
      type: 'text',
      required: false,
      options: [],
      order: fields.length,
    } as FormField);
  }
  return {
    ...(props.applicationForm ?? { fields: [] }),
    fields,
    unaskedEssentials: [...unasked.value],
  };
});

/**
 * The one refusal an organizer can cause from here, mirrored so it is immediate.
 *
 * A form is its custom fields PLUS the essential questions the plan asks, so turning every
 * essential question off while adding no field leaves a market that would open applications and
 * then refuse every application it received. The server refuses this too, and its answer wins.
 */
const wouldAskNothing = computed(() => {
  const essentialsLeft = askedEssentialAnswers({
    ...props.essentialOptions,
    unasked: [...unasked.value],
  }).filter((answer) => answer.key.startsWith(ESSENTIAL_KEY_PREFIX));
  // The name is asked unconditionally, so counting it would make this never true - and what it
  // holds is the last thing stopping a market collecting applications it cannot place.
  const planDerived = essentialsLeft.filter((answer) => askedNow.value.includes(answer.key));
  return proposed.value.fields.length === 0 && planDerived.length === 0;
});

const changesNothing = computed(
  () =>
    proposed.value.fields.length === existingFields.value.length &&
    unasked.value.length === (props.applicationForm?.unaskedEssentials ?? []).length,
);

const cannotSave = computed(
  () => saving.value || Boolean(keyError.value) || wouldAskNothing.value || changesNothing.value,
);

async function save() {
  if (cannotSave.value) return;
  saving.value = true;
  errorMessage.value = '';
  blockers.value = [];
  stalled.value = null;
  try {
    const { data } = await api.post(`/markets/${props.marketId}/application-form/amendment`, {
      applicationForm: proposed.value,
    });
    emit('amended', (data?.applicationForm ?? proposed.value) as ApplicationForm);
    emit('close');
  } catch (err: unknown) {
    const body = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
    if (body?.error === 'preconditions_not_met') {
      blockers.value = ((body.blockers ?? []) as Array<{ message: string }>).map((b) => b.message);
      errorMessage.value = String(body.message ?? 'The form as edited cannot reopen applications.');
    } else if (body?.error === 'amendment_stalled') {
      // Where it stopped, and the offer to finish - never left to the phase rail to reveal.
      stalled.value = { message: String(body.message), canResume: Boolean(body.canResume) };
    } else {
      errorMessage.value = getApiErrorMessage(err, 'Could not amend the form.');
    }
  } finally {
    saving.value = false;
  }
}

async function resume() {
  saving.value = true;
  try {
    await api.post(`/markets/${props.marketId}/application-form/amendment/resume`);
    stalled.value = null;
    emit('close');
  } catch (err: unknown) {
    errorMessage.value = getApiErrorMessage(err, 'Could not finish returning the market.');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <AppDialog
    :open="open"
    title="Fix the form"
    testid="amend-form"
    wide
    confirm-label="Save and carry on"
    :confirm-disabled="cannotSave"
    @close="emit('close')"
    @submit="save"
  >
    <p class="amend-lede">
      Your upload and your mapping stay exactly as they are. This reopens the market for editing,
      writes the form, and puts it back where it was.
    </p>

    <section v-if="togglable.length" class="amend-section">
      <h3>Questions this market asks</h3>
      <p class="amend-help">
        Turn one off and every applicant is treated equally on it. These are preferences, not
        constraints, so a market can stop asking them.
      </p>
      <label
        v-for="question in togglable"
        :key="question.key"
        class="amend-toggle"
        :data-testid="`amend-form-unask-${question.key}`"
      >
        <input v-model="unasked" type="checkbox" :value="question.key" />
        <span>Stop asking {{ question.label }}</span>
      </label>
    </section>

    <section class="amend-section">
      <h3>Add a question</h3>
      <p class="amend-help">For a column with nowhere to go. Leave it blank to add nothing.</p>
      <label class="amend-field">
        <span class="field-label">Question</span>
        <input
          v-model="newFieldLabel"
          type="text"
          class="field"
          placeholder="e.g. What do you sell?"
          data-testid="amend-form-label-input"
        />
      </label>
      <label v-if="newFieldLabel.trim()" class="amend-field">
        <span class="field-label">Answer key</span>
        <input
          v-model="newFieldKey"
          type="text"
          class="field"
          data-testid="amend-form-key-input"
          @input="keyTouched = true"
        />
        <p v-if="keyError" class="amend-error" data-testid="amend-form-key-error">{{ keyError }}</p>
      </label>
    </section>

    <!--
      Stated, not discovered. The exposure is bounded - this chain is only possible while nobody
      has applied - but an organizer whose applicants meet a missing page deserves to have been
      told, not to find out.
    -->
    <p v-if="intakeIsForm" class="amend-note" data-testid="amend-form-exposure-note">
      While this runs, this market's public application page is briefly unavailable. Nobody has
      applied yet, which is the only reason this is possible at all.
    </p>

    <!-- Invisible in the workflow, but not in the record (E18/F03/S01). -->
    <p class="amend-note" data-testid="amend-form-redate-note">
      Reopening and closing the form again re-dates its publication, so the record will show today
      rather than the day it first opened.
    </p>

    <p v-if="wouldAskNothing" class="amend-error" data-testid="amend-form-asks-nothing">
      That would leave the form asking nothing at all, so this market could not reopen applications.
      Keep one question, or add a field.
    </p>

    <div v-if="blockers.length" class="amend-error" data-testid="amend-form-blockers">
      <p>{{ errorMessage }}</p>
      <ul>
        <li v-for="blocker in blockers" :key="blocker">{{ blocker }}</li>
      </ul>
    </div>
    <p v-else-if="errorMessage && !stalled" class="amend-error" data-testid="amend-form-error">
      {{ errorMessage }}
    </p>

    <div v-if="stalled" class="amend-stalled" data-testid="amend-form-stalled">
      <p>{{ stalled.message }}</p>
      <button
        v-if="stalled.canResume"
        type="button"
        class="btn btn--compact btn--primary"
        :disabled="saving"
        data-testid="amend-form-resume-button"
        @click="resume()"
      >
        Put the market back
      </button>
    </div>
  </AppDialog>
</template>

<style scoped>
.amend-lede {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.amend-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.amend-section h3 {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--mm-black);
}

.amend-help {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.amend-toggle {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.amend-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.amend-note {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.amend-error {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-red);
}

.amend-error ul {
  margin: var(--space-1) 0 0;
  padding-left: var(--space-4);
}

.amend-stalled {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--mm-red);
  border-radius: var(--radius-control);
  font-size: var(--text-xs);
  color: var(--mm-black);
}

.amend-stalled p {
  margin: 0;
}
</style>
