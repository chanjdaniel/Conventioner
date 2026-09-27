<script setup lang="ts">
/**
 * Start a draft's plan and form from a Google Form's responses (E24/F03, from the
 * form-started-from-a-CSV ticket 05).
 *
 * Four steps at one address: Upload the CSV, answer the Year its dates are in, Review the proposal
 * in the ledger and correct it, Confirm. The file is read in the browser, sent for a proposal, and
 * never kept: a reload lands back on Upload. Nothing about the market changes until Confirm - Back,
 * Cancel and leaving write nothing - which is why the proposal and the organizer's corrections live
 * here, as a working copy, and not in the market store.
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppDialog from '@/components/AppDialog.vue';
import MarketArrival from '@/components/MarketArrival.vue';
import MarketFrame from '@/components/MarketFrame.vue';
import ProposalLedger from '@/components/csvProposal/ProposalLedger.vue';
import { api, getApiErrorMessage } from '@/utils/api';
import {
  confirmChoices,
  correct,
  draftFrom,
  initialYear,
  setCeiling,
  settle,
  toggleOption,
  weekdayNote,
  weekdaysFit,
  type DisagreementKind,
  type Proposal,
  type ProposalDraft,
  type RowChoice,
} from '@/utils/csvProposal';
import { marketPath } from '@/utils/market';
import { useOpenMarket } from '@/utils/openMarket';

type Step = 'upload' | 'reading' | 'review' | 'confirming';

const route = useRoute();
const router = useRouter();
const marketId = computed(() => String(route.params.marketId ?? ''));
const { market, status, refresh } = useOpenMarket(marketId);

const step = ref<Step>('upload');
const error = ref('');
const fileName = ref('');
/** The file's text, held only while the flow is open: confirm reads it once more, then it is gone. */
const csvContent = ref('');
const proposal = ref<Proposal | null>(null);
/** The organizer's corrections: the proposal's working copy, and nothing else holds it. */
const draft = reactive<ProposalDraft>({
  rows: {},
  settled: {},
  ceiling: { days: null, corrected: false },
});
const year = ref(new Date().getFullYear());
const yearOpen = ref(false);
const yearDraft = ref('');
const dragging = ref(false);
/** Whether a proposal may consult hosted TypeSafe, so Upload can say so before anything is sent. */
const typesafe = ref(false);

onMounted(async () => {
  try {
    const { data } = await api.get('/csv-proposal/typesafe');
    typesafe.value = Boolean(data?.configured);
  } catch {
    typesafe.value = false;
  }
});

/** Why this market cannot be started from a file: the proposal's own refusal, served on the market. */
const refusal = computed(() => market.value?.csvStartRefusal ?? '');

const planDates = computed(() =>
  (market.value?.setupObject?.marketDates ?? []).map((d) => d.date).filter(Boolean),
);
const planTiers = computed(() =>
  (market.value?.setupObject?.tiers ?? []).map((t) => t.name).filter(Boolean),
);

const planCeiling = computed(
  () => market.value?.setupObject?.assignmentOptions?.maxAssignmentsPerVendor ?? null,
);

const columnCount = computed(() => proposal.value?.columns.length ?? 0);

async function onFileChosen(event: Event) {
  await acceptFile((event.target as HTMLInputElement).files?.[0]);
}

async function onFileDropped(event: DragEvent) {
  dragging.value = false;
  await acceptFile(event.dataTransfer?.files?.[0]);
}

async function acceptFile(file: File | undefined) {
  if (!file) return;
  if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
    error.value = `${file.name} is not a CSV file.`;
    return;
  }
  error.value = '';
  fileName.value = file.name;
  step.value = 'reading';
  try {
    csvContent.value = await file.text();
    const { data } = await api.post<Proposal>(`/markets/${marketId.value}/csv-proposal`, {
      csvContent: csvContent.value,
    });
    proposal.value = data;
    Object.assign(draft, draftFrom(data));
    // The plan's own ceiling wins, so there is nothing to check about the file's.
    if (planCeiling.value) setCeiling(draft, planCeiling.value);
    year.value = initialYear(data.plan);
    step.value = 'review';
    if (data.plan.dates.length) openYear();
  } catch (e) {
    error.value = getApiErrorMessage(e, 'That file could not be read.');
    step.value = 'upload';
  }
}

function openYear() {
  yearDraft.value = String(year.value);
  yearOpen.value = true;
}

const yearValid = computed(() => /^\d{4}$/.test(yearDraft.value.trim()));

function confirmYear() {
  if (!yearValid.value) return;
  year.value = Number(yearDraft.value.trim());
  yearOpen.value = false;
}

/** The year typed, judged against the weekdays the form states - never a fact that is not so. */
const typedYear = computed(() => Number(yearDraft.value.trim()) || year.value);
const typedYearFits = computed(() =>
  proposal.value ? weekdaysFit(proposal.value.plan.dates, typedYear.value) : null,
);
const yearNote = computed(() =>
  proposal.value ? weekdayNote(proposal.value.plan.dates, typedYear.value) : '',
);

function onCorrect(row: number, change: Partial<RowChoice>) {
  correct(draft, row, change);
}

function onToggle(row: number, value: string) {
  toggleOption(draft, row, value);
}

function onSettle(kind: DisagreementKind, value: string, choice: string) {
  settle(draft, kind, value, choice);
}

/**
 * Write it all: the server reads the file once more with the organizer's choices, writes the plan
 * facts, the form, the ceiling and the mapping in one update, or nothing. Then the market is
 * re-read, as after every write, and the organizer lands on the form they now have.
 */
async function confirm() {
  step.value = 'confirming';
  error.value = '';
  try {
    await api.post(`/markets/${marketId.value}/csv-proposal/confirm`, {
      csvContent: csvContent.value,
      year: proposal.value?.plan.dates.length ? year.value : null,
      ...confirmChoices(draft),
    });
    csvContent.value = '';
    await refresh();
    void router.push(marketPath(marketId.value, 'form'));
  } catch (e) {
    error.value = getApiErrorMessage(e, 'The form and plan could not be created.');
    step.value = 'review';
  }
}

function leave() {
  void router.push(marketPath(marketId.value, 'setup'));
}
</script>

<template>
  <div v-if="!market" class="start-view"><MarketArrival :status="status" @retry="refresh()" /></div>
  <MarketFrame v-else :market="market">
    <div class="start-view" data-testid="start-from-csv">
      <header class="start-header">
        <div>
          <h1>Start from your Google Form</h1>
          <p v-if="proposal" class="subtitle" data-testid="start-from-csv-summary">
            {{ fileName }} · {{ proposal.responses }} responses · {{ columnCount }} columns
            <template v-if="proposal.plan.dates.length">
              · dates in <strong data-testid="start-from-csv-year">{{ year }}</strong>
              <button
                type="button"
                class="link"
                data-testid="start-from-csv-change-year"
                @click="openYear"
              >
                change
              </button>
            </template>
          </p>
        </div>
        <ol v-if="!refusal" class="steps">
          <li :class="{ current: step === 'upload' || step === 'reading' }">1 Upload</li>
          <li :class="{ current: yearOpen }">2 Year</li>
          <li :class="{ current: step === 'review' && !yearOpen }">3 Review</li>
          <li :class="{ current: step === 'confirming' }">4 Confirm</li>
        </ol>
      </header>

      <p v-if="error" class="error" role="alert" data-testid="start-from-csv-error">{{ error }}</p>

      <section v-if="refusal" class="panel" data-testid="start-from-csv-refused">
        <h2>This market can't start from a CSV</h2>
        <p class="help">{{ refusal }}</p>
        <button type="button" class="btn btn--secondary" @click="leave">
          Back to Market Setup
        </button>
      </section>

      <section v-else-if="step === 'upload'" class="panel" data-testid="start-from-csv-upload">
        <h2>Upload your Google Form's responses</h2>
        <p class="help">
          In Google Sheets, open the form's responses and choose File, Download, Comma-separated
          values. Each column becomes part of <strong>{{ market.name }}</strong
          >'s plan or form. Nothing is written until you confirm, and the file is not kept.
        </p>
        <p v-if="typesafe" class="help" data-testid="start-from-csv-typesafe">
          Column headings, and a description of the shape of their answers, are sent to TypeSafe to
          help sort the columns; individual vendors' answers never leave Conventioner.
        </p>
        <label
          class="drop-zone"
          :class="{ dragging }"
          data-testid="start-from-csv-drop-zone"
          @dragover.prevent="dragging = true"
          @dragenter.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onFileDropped"
        >
          <input
            type="file"
            accept=".csv,text/csv"
            data-testid="start-from-csv-file-input"
            @change="onFileChosen"
          />
          <span class="drop-zone-main">Drop your CSV here, or choose a file</span>
        </label>
        <button type="button" class="btn btn--secondary back" @click="leave">Cancel</button>
      </section>

      <section v-else-if="step === 'reading'" class="panel" data-testid="start-from-csv-reading">
        <h2>Reading your columns…</h2>
        <p class="help">{{ fileName }}</p>
      </section>

      <template v-else-if="proposal && (step === 'review' || step === 'confirming')">
        <p class="help">
          Here is what each column of your form's responses would become. Rows with a yellow edge
          are the ones worth a second look.
        </p>
        <ProposalLedger
          :proposal="proposal"
          :draft="draft"
          :year="year"
          :plan-dates="planDates"
          :plan-tiers="planTiers"
          :plan-ceiling="planCeiling"
          :busy="step === 'confirming'"
          @correct="onCorrect"
          @toggle="onToggle"
          @settle="onSettle"
          @ceiling="(days: number | null) => setCeiling(draft, days)"
          @cancel="leave"
          @confirm="confirm"
        />
      </template>
    </div>
  </MarketFrame>

  <AppDialog
    :open="yearOpen"
    title="Which year are these dates in?"
    testid="start-from-csv-year-dialog"
    confirm-label="Use this year"
    :confirm-disabled="!yearValid"
    @close="yearOpen = false"
    @submit="confirmYear"
  >
    <p class="help">
      Your form's dates name a month and a day but no year:
      {{ proposal?.plan.dates.map((d) => d.text).join(', ') }}.
    </p>
    <label class="field-label" for="start-from-csv-year-input">Year</label>
    <input
      id="start-from-csv-year-input"
      v-model="yearDraft"
      class="field"
      inputmode="numeric"
      data-testid="start-from-csv-year-input"
    />
    <p v-if="typedYearFits === true" class="help" data-testid="start-from-csv-year-note">
      {{ yearNote }}.
    </p>
    <p
      v-else-if="typedYearFits === false"
      class="warning"
      data-testid="start-from-csv-year-warning"
    >
      {{ yearNote }}, so check the year.
    </p>
    <p v-else class="help" data-testid="start-from-csv-year-note">
      Your form's dates name no weekday, so there is nothing to check the year against.
    </p>
  </AppDialog>
</template>

<style scoped>
.start-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-8) var(--space-12);
  color: var(--mm-black);
}

.start-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
  border-bottom: 1px solid var(--mm-border);
  padding-bottom: var(--space-4);
}

h1 {
  margin: 0;
  font-size: var(--text-xl);
}

h2 {
  margin: 0;
  font-size: var(--text-lg);
}

.subtitle,
.help {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-muted);
}

.subtitle {
  margin-top: var(--space-1);
}

.warning {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--mm-text-yellow);
}

.steps {
  display: flex;
  gap: var(--space-4);
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: var(--text-xs);
  color: var(--mm-text-muted);
}

.steps .current {
  color: var(--mm-black);
  font-weight: 600;
}

.panel {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  max-width: 720px;
}

.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  align-self: stretch;
  gap: var(--space-2);
  padding: var(--space-8) var(--space-6);
  border: var(--space-hairline) dashed var(--mm-border);
  border-radius: var(--radius-card);
  background: var(--mm-beige);
  cursor: pointer;
}

.drop-zone:hover,
.drop-zone.dragging {
  border-color: var(--mm-green);
}

.drop-zone input[type='file'] {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.drop-zone-main {
  font-size: var(--text-md);
}

.error {
  margin: 0;
  color: var(--mm-red);
  font-size: var(--text-sm);
}

.link {
  margin-left: var(--space-1);
  border: none;
  background: none;
  padding: 0;
  color: var(--mm-text-link);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
}
</style>
