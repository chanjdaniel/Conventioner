<script setup lang="ts">
/**
 * Updating a vendor's info (E41/F01/S01): their answers, each in its question's own control, with
 * Save and Cancel.
 *
 * Each answer that differs from what the vendor wrote says what they wrote beside it before Save, so
 * Save is the confirmation of every change, and "Use their answer" puts one back. The update is kept
 * beside the vendor's own answer on the server, never over it, so a re-import does not undo it.
 *
 * The answers the assignment reads show read-only: updating those is E41/F01/S02's.
 */
import { computed, ref, watch } from 'vue';
import type { Application, ApplicationForm, FormField } from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import AnswerValue from '@/components/AnswerValue.vue';
import ApplicationFormFields from '@/components/application/ApplicationFormFields.vue';
import { getApiErrorMessage } from '@/utils/api';
import { sortedFormFields } from '@/utils/applicationForm';
import {
  CHANGED_SINCE,
  sameAnswer,
  theirAnswer,
  updateOf,
  updatedByLine,
  updateVendorInfo,
} from '@/utils/answerUpdates';
import { ESSENTIAL_KEY_PREFIX, answerText, applicationAnswerRows } from '@/utils/essentialFields';

const props = defineProps<{
  open: boolean;
  marketId: string;
  application: Application | null;
  form: ApplicationForm | null | undefined;
}>();
const emit = defineEmits<{ close: []; saved: [application: Application] }>();

const draft = ref<Record<string, unknown>>({});
const error = ref('');
const busy = ref(false);

/** The organizer's own questions, in the form's order: the answers this dialog updates. */
const fields = computed<FormField[]>(() =>
  sortedFormFields(props.form?.fields ?? []).filter(
    (field) => !field.key.startsWith(ESSENTIAL_KEY_PREFIX),
  ),
);

/** The answers the assignment reads, as the review shows them: read-only here for now. */
const essentials = computed(
  () => applicationAnswerRows(props.application?.formData ?? {}, []).essential,
);

watch(
  () => [props.open, props.application] as const,
  ([open, application]) => {
    if (!open || !application) return;
    draft.value = Object.fromEntries(
      fields.value.map((field) => [field.key, application.formData?.[field.key]]),
    );
    error.value = '';
  },
  { immediate: true },
);

/** The answers changed here, from how they read now: what Save sends. */
const changed = computed<Record<string, unknown>>(() => {
  const application = props.application;
  if (!application) return {};
  return Object.fromEntries(
    fields.value
      .filter((field) => !sameAnswer(draft.value[field.key], application.formData?.[field.key]))
      .map((field) => [field.key, draft.value[field.key]]),
  );
});

function theirs(field: FormField): unknown {
  return props.application ? theirAnswer(props.application, field.key) : undefined;
}

/** Whether this answer, as it stands in the dialog, is not what the vendor wrote. */
function differsFromTheirs(field: FormField): boolean {
  return !sameAnswer(draft.value[field.key], theirs(field));
}

function theyWroteText(field: FormField): string {
  return answerText(theirs(field)).trim() || 'Nothing';
}

function useTheirs(field: FormField): void {
  const value = theirs(field);
  draft.value = { ...draft.value, [field.key]: Array.isArray(value) ? [...value] : value };
}

/**
 * Who updated it, while the dialog leaves that update as it is; what they wrote is beside it
 * already. Said with the change under it, when their answer moved since.
 */
function standingUpdate(field: FormField): string | null {
  const update = updateOf(props.application, field.key);
  if (!update || field.key in changed.value) return null;
  return update.changedSince
    ? `${updatedByLine(update)}. ${CHANGED_SINCE}`
    : `${updatedByLine(update)}.`;
}

/**
 * One question's change, into the draft. Only its own answer is taken from what the control sends:
 * two controls changed before the dialog renders again each hold the draft as it was.
 */
function answered(field: FormField, value: Record<string, unknown>): void {
  draft.value = { ...draft.value, [field.key]: value[field.key] };
}

/** An update this dialog takes away by putting their answer back. */
function goesBack(field: FormField): boolean {
  return (
    !!updateOf(props.application, field.key) &&
    field.key in changed.value &&
    !differsFromTheirs(field)
  );
}

async function save(): Promise<void> {
  const application = props.application;
  if (busy.value || !application || !Object.keys(changed.value).length) return;
  busy.value = true;
  error.value = '';
  try {
    emit('saved', await updateVendorInfo(props.marketId, application.id, changed.value));
  } catch (err: unknown) {
    error.value = getApiErrorMessage(err, 'The update could not be saved.');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog
    :open="open && !!application"
    title="Update info"
    testid="update-info"
    wide
    :confirm-label="busy ? 'Saving…' : 'Save'"
    :confirm-disabled="busy || !Object.keys(changed).length"
    :error="error"
    @close="emit('close')"
    @submit="save"
  >
    <p class="update-info-note">
      What the vendor wrote is kept. Your update reads in its place wherever their answers show, and
      outlasts a re-import.
    </p>

    <div v-if="fields.length" class="update-info-fields">
      <div
        v-for="field in fields"
        :key="field.key"
        class="update-info-answer"
        :data-testid="`update-info-answer-${field.key}`"
      >
        <ApplicationFormFields
          :modelValue="draft"
          :fields="[field]"
          prefix="update-info"
          @update:modelValue="answered(field, $event)"
        />
        <div
          v-if="differsFromTheirs(field)"
          class="update-info-theirs"
          :data-testid="`update-info-theirs-${field.key}`"
        >
          <span>They wrote: {{ theyWroteText(field) }}</span>
          <button
            type="button"
            class="btn btn--secondary btn--compact"
            :data-testid="`update-info-use-theirs-${field.key}`"
            @click="useTheirs(field)"
          >
            Use their answer
          </button>
        </div>
        <p
          v-else-if="goesBack(field)"
          class="update-info-meta"
          :data-testid="`update-info-goes-back-${field.key}`"
        >
          Back to their answer: Save takes the update away.
        </p>
        <p
          v-if="standingUpdate(field)"
          class="update-info-meta"
          :data-testid="`update-info-updated-${field.key}`"
        >
          {{ standingUpdate(field) }}
        </p>
      </div>
    </div>
    <p v-else class="update-info-note">This market asks no questions of its own.</p>

    <section v-if="essentials.length" class="update-info-essentials">
      <h3 class="update-info-heading">Answers the assignment reads</h3>
      <p class="update-info-meta">These are not updated here, and read as the vendor gave them.</p>
      <dl class="update-info-grid" data-testid="update-info-essentials">
        <template v-for="row in essentials" :key="row.key">
          <dt>{{ row.label }}</dt>
          <dd><AnswerValue :value="row.value" /></dd>
        </template>
      </dl>
    </section>
  </AppDialog>
</template>

<style scoped>
.update-info-note {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-black);
}

.update-info-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.update-info-answer {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* What the vendor wrote, beside the new value: the confirmation Save stands for. */
.update-info-theirs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control);
  background: var(--mm-beige);
  font-size: var(--text-sm);
  color: var(--mm-black);
  overflow-wrap: anywhere;
}

.update-info-meta {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.update-info-essentials {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-top: var(--space-4);
  border-top: 1px solid var(--mm-border);
}

.update-info-heading {
  margin: 0;
  font-family: 'Merge One', sans-serif;
  font-size: var(--text-md);
  color: var(--mm-black);
}

.update-info-grid {
  margin: 0;
  display: grid;
  grid-template-columns: minmax(0, 0.6fr) minmax(0, 1fr);
  gap: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
}

.update-info-grid dt {
  color: var(--mm-text-muted);
}

.update-info-grid dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
