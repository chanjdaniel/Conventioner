<script setup lang="ts">
/**
 * Updating a vendor's info (E41/F01/S01): their answers, each in its question's own control, with
 * Save and Cancel.
 *
 * Each answer that differs from what the vendor wrote says what they wrote beside it before Save, so
 * Save is the confirmation of every change, and "Use their answer" puts one back. The update is kept
 * beside the vendor's own answer on the server, never over it, so a re-import does not undo it.
 *
 * The essential questions are asked as the form asks them (E41/F01/S02). The answers the assignment
 * reads are the row "Update info the assignment or price reads", Admin by default, and show
 * read-only to whoever it refuses; the names and the request are any other answer's.
 */
import { computed, ref, watch } from 'vue';
import type {
  Application,
  ApplicationForm,
  EssentialFormOptions,
  FormField,
} from '@/assets/types/datatypes';
import AppDialog from '@/components/AppDialog.vue';
import UpdateInfoTheirs from '@/components/UpdateInfoTheirs.vue';
import ApplicationFormFields from '@/components/application/ApplicationFormFields.vue';
import EssentialApplicationFields from '@/components/application/EssentialApplicationFields.vue';
import { getApiErrorMessage } from '@/utils/api';
import { sortedFormFields } from '@/utils/applicationForm';
import {
  ASSIGNMENT_READS,
  CHANGED_SINCE,
  asAsked,
  inPlanOrder,
  questionKeys,
  sameAnswer,
  theirAnswers,
  updateOf,
  updatedByLine,
  updateVendorInfo,
} from '@/utils/answerUpdates';
import {
  AVAILABLE_DATES_KEY,
  ESSENTIAL_KEY_PREFIX,
  FULL_NAME_KEY,
  MAX_DATES_KEY,
  PREFERRED_NAME_KEY,
  REQUEST_KEY,
  SECTION_RANKING_KEY,
  TABLE_CHOICE_KEY,
  TABLE_SHARE_EMAIL_KEY,
  TABLE_TYPE_RANKING_KEY,
  TIER_PREFERENCE_KEY,
  answerText,
  essentialAnswerText,
} from '@/utils/essentialFields';

const props = defineProps<{
  open: boolean;
  marketId: string;
  application: Application | null;
  form: ApplicationForm | null | undefined;
  /** What the essential questions offer on this market, as the form asks them. */
  options: EssentialFormOptions;
  /** Why this person may not update an answer the assignment reads, or null when they may. */
  assignmentRefusal: string | null;
}>();
const emit = defineEmits<{ close: []; saved: [application: Application] }>();

/** The essential questions, by the key each is answered under; the tier grid answers the dates too. */
const ESSENTIAL_QUESTIONS = [
  FULL_NAME_KEY,
  PREFERRED_NAME_KEY,
  MAX_DATES_KEY,
  TIER_PREFERENCE_KEY,
  TABLE_CHOICE_KEY,
  TABLE_SHARE_EMAIL_KEY,
  SECTION_RANKING_KEY,
  TABLE_TYPE_RANKING_KEY,
  REQUEST_KEY,
];

const draft = ref<Record<string, unknown>>({});
/** The essential questions changed here: a ranking the form fills in on opening is not a change. */
const touched = ref(new Set<string>());
const error = ref('');
const busy = ref(false);

/** The organizer's own questions, in the form's order. */
const fields = computed<FormField[]>(() =>
  sortedFormFields(props.form?.fields ?? []).filter(
    (field) => !field.key.startsWith(ESSENTIAL_KEY_PREFIX),
  ),
);

const locked = computed<readonly string[]>(() => (props.assignmentRefusal ? ASSIGNMENT_READS : []));

/** Every answer as it reads now, and as the vendor wrote it, as the form asks for them. */
const now = computed(() => inPlanOrder(asAsked(props.application?.formData ?? {}), props.options));
const theirs = computed(() =>
  props.application ? inPlanOrder(theirAnswers(props.application), props.options) : {},
);

const isEssential = (question: string) => ESSENTIAL_QUESTIONS.includes(question);

function sameOn(question: string, a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return questionKeys(question).every((key) => sameAnswer(a[key], b[key]));
}

watch(
  () => [props.open, props.application] as const,
  ([open, application]) => {
    if (!open || !application) return;
    draft.value = { ...now.value };
    touched.value = new Set();
    error.value = '';
  },
  { immediate: true },
);

/** The answers changed here, from how they read now: what Save sends. */
const changed = computed<Record<string, unknown>>(() => {
  if (!props.application) return {};
  const questions = [
    ...fields.value.map((field) => field.key),
    ...ESSENTIAL_QUESTIONS.filter((question) => touched.value.has(question)),
  ];
  return Object.fromEntries(
    questions
      .filter((question) => !sameOn(question, draft.value, now.value))
      .flatMap(questionKeys)
      .map((key) => [key, draft.value[key]]),
  );
});

const isChanged = (question: string) => questionKeys(question).some((key) => key in changed.value);

/** Whether this answer, as it stands in the dialog, is not what the vendor wrote. */
function differsFromTheirs(question: string): boolean {
  if (
    isEssential(question) &&
    !touched.value.has(question) &&
    !updateOf(props.application, question)
  )
    return false;
  return !sameOn(question, draft.value, theirs.value);
}

function theyWroteText(question: string): string {
  const key =
    question === TIER_PREFERENCE_KEY && !props.options.tiers.length
      ? AVAILABLE_DATES_KEY
      : question;
  const text = isEssential(question)
    ? essentialAnswerText(key, theirs.value[key])
    : answerText(theirs.value[key]);
  return text.trim() || 'Nothing';
}

function useTheirs(question: string): void {
  const back = Object.fromEntries(
    questionKeys(question).map((key) => {
      const value = theirs.value[key];
      return [key, value && typeof value === 'object' ? structuredClone(value) : value];
    }),
  );
  draft.value = { ...draft.value, ...back };
  if (isEssential(question)) touched.value = new Set([...touched.value, question]);
}

/** The update standing on this question, if any: the tier grid's is the tiers' or the dates'. */
function updateOn(question: string) {
  return questionKeys(question)
    .map((key) => updateOf(props.application, key))
    .find(Boolean);
}

/**
 * Who updated it, while the dialog leaves that update as it is; what they wrote is beside it
 * already. Said with the change under it, when their answer moved since.
 */
function standingUpdate(question: string): string | null {
  const update = updateOn(question);
  if (!update || isChanged(question)) return null;
  return update.changedSince
    ? `${updatedByLine(update)}. ${CHANGED_SINCE}`
    : `${updatedByLine(update)}.`;
}

/** An update this dialog takes away by putting their answer back. */
function goesBack(question: string): boolean {
  return !!updateOn(question) && isChanged(question) && !differsFromTheirs(question);
}

/**
 * One question's change, into the draft. Only its own answer is taken from what the control sends:
 * two controls changed before the dialog renders again each hold the draft as it was.
 */
function answered(field: FormField, value: Record<string, unknown>): void {
  draft.value = { ...draft.value, [field.key]: value[field.key] };
}

/** The essential questions' answers, as the form sends them all at once; the dates in plan order. */
function answeredEssentials(value: Record<string, unknown>): void {
  const essentials = Object.fromEntries(
    ESSENTIAL_QUESTIONS.flatMap(questionKeys).map((key) => [key, value[key]]),
  );
  draft.value = inPlanOrder({ ...draft.value, ...essentials }, props.options);
}

function essentialChanged(key: string): void {
  const question = key === AVAILABLE_DATES_KEY ? TIER_PREFERENCE_KEY : key;
  touched.value = new Set([...touched.value, question]);
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
        <UpdateInfoTheirs
          :question="field.key"
          :differs="differsFromTheirs(field.key)"
          :theyWrote="theyWroteText(field.key)"
          :goesBack="goesBack(field.key)"
          :standing="standingUpdate(field.key)"
          @useTheirs="useTheirs(field.key)"
        />
      </div>
    </div>
    <p v-else class="update-info-note">This market asks no questions of its own.</p>

    <section class="update-info-essentials" data-testid="update-info-essentials">
      <h3 class="update-info-heading">Essential questions</h3>
      <p class="update-info-meta" data-testid="update-info-essentials-note">
        <template v-if="assignmentRefusal">{{ assignmentRefusal }}</template>
        <template v-else>
          The assignment reads their dates, tiers, table and preferences: the next run places them
          by what you save here.
        </template>
      </p>
      <EssentialApplicationFields
        :options="options"
        :modelValue="draft"
        :locked="locked"
        prefix="update-info"
        @update:modelValue="answeredEssentials"
        @field-change="essentialChanged"
      >
        <template #after="{ question }">
          <UpdateInfoTheirs
            :question="question"
            :differs="differsFromTheirs(question)"
            :theyWrote="theyWroteText(question)"
            :goesBack="goesBack(question)"
            :standing="standingUpdate(question)"
            @useTheirs="useTheirs(question)"
          />
        </template>
      </EssentialApplicationFields>
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
</style>
