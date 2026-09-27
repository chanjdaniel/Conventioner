<script setup lang="ts">
/**
 * The proposal ledger (E24/F03, variant A of the form-started-from-a-CSV ticket 05).
 *
 * The import's own ledger, in the file's order, so the organizer learns one screen: a row per
 * column - a grid's columns are one - saying what it becomes, under a band of what the file says
 * about the plan, and over a band of the essential questions no column answers. A row worth a
 * second look carries a yellow edge and the reason. Beside it, a rail sticks under the market's
 * frame with the counts, the promise that nothing is written yet, and the way out.
 *
 * Every row can be corrected where it stands (S02): what the column becomes, and for a question of
 * the organizer's own its type, whether it is required and which options to keep; a value the plan
 * lacks gets the import's own fix. The corrections are the view's working copy, so this emits them
 * and never changes what it was handed.
 */
import { computed } from 'vue';
import ValueFixes from '@/components/ValueFixes.vue';
import {
  choiceOfTarget,
  draftRows,
  notAsked,
  planRowsToCheck,
  proposalCounts,
  takenBy,
  targetOf,
  type DisagreementKind,
  type FieldType,
  type LedgerRow,
  type Proposal,
  type ProposalDraft,
  type ProposedDate,
  type RowChoice,
} from '@/utils/csvProposal';
import { ESSENTIAL_KEYS, essentialLabel } from '@/utils/essentialFields';
import { FIELD_TYPES } from '@/utils/applicationForm';
import { getFormattedDate } from '@/utils/utils';

const props = defineProps<{
  proposal: Proposal;
  draft: ProposalDraft;
  year: number;
  /** The plan's own dates and tiers, which a value the file holds may be settled to. */
  planDates: string[];
  planTiers: string[];
  busy?: boolean;
}>();
const emit = defineEmits<{
  correct: [row: number, change: Partial<RowChoice>];
  toggle: [row: number, value: string];
  settle: [kind: DisagreementKind, value: string, choice: string];
  ceiling: [days: number | null];
  cancel: [];
  confirm: [];
}>();

const rows = computed(() => draftRows(props.proposal, props.draft));
const counts = computed(() => proposalCounts(props.proposal, props.draft));
const plan = computed(() => props.proposal.plan);
const planChecks = computed(() => planRowsToCheck(props.proposal, props.draft));
const unasked = computed(() => notAsked(props.proposal, props.draft));

/** A ceiling from 1 to 10 days, as the rule and TypeSafe read one. */
const CEILINGS = Array.from({ length: 10 }, (_, i) => i + 1);

function chooseCeiling(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  emit('ceiling', value === '' ? null : Number(value));
}

/**
 * A grid's columns are one question with a column per option, which only an essential question
 * reads that way; as one question of the organizer's own, or as who applied, it would be several.
 */
function onlyEssential(row: LedgerRow): boolean {
  return row.members.length > 1;
}

const WHO_APPLIED = [
  { target: 'submitted_at', label: 'When they applied' },
  { target: 'applicant_email', label: "The applicant's email" },
];

function typeLabel(type: FieldType): string {
  return FIELD_TYPES.find((t) => t.value === type)?.label ?? type;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function first(row: LedgerRow): number {
  return row.indexes[0];
}

/** Why a target is not on offer for this row: another column already is it. */
function takenNote(target: string, row: LedgerRow): string {
  const other = takenBy(props.draft, target, first(row));
  return other === null ? '' : ` (column ${other + 1})`;
}

function chooseFate(row: LedgerRow, event: Event) {
  emit('correct', first(row), choiceOfTarget((event.target as HTMLSelectElement).value));
}

function chooseType(row: LedgerRow, event: Event) {
  emit('correct', first(row), { type: (event.target as HTMLSelectElement).value as FieldType });
}

function sources(dates: ProposedDate[]): string {
  const from = new Set(dates.map((d) => d.from));
  const names = [...from].map((f) =>
    f === 'header' ? 'the grid of days' : 'answers that are dates',
  );
  return names.join(' and ');
}

const datesNote = computed(() => {
  const dates = plan.value.dates;
  if (!props.planDates.length) return `Become your plan's dates in ${props.year}`;
  return `${dates.filter((d) => d.matches).length} of ${dates.length} are your plan's dates`;
});

const tiersNote = computed(() => {
  const tiers = plan.value.tiers;
  if (!props.planTiers.length) return "Become your plan's tiers";
  return `${tiers.filter((t) => t.matches).length} of ${tiers.length} are your plan's tiers`;
});

function disagreements(kind: DisagreementKind) {
  return plan.value.disagreements
    .filter((d) => d.kind === kind)
    .map((d) => ({
      target: kind,
      value: d.value,
      offered: kind === 'date' ? props.planDates : props.planTiers,
    }));
}

function settledAs(kind: string, value: string): string {
  return props.draft.settled[kind as DisagreementKind]?.[value] ?? '';
}

function offeredLabel(kind: string, choice: string): string {
  return kind === 'date' ? (getFormattedDate(choice) ?? choice) : choice;
}

function onSettle(kind: string, value: string, choice: string) {
  emit('settle', kind as DisagreementKind, value, choice);
}
</script>

<template>
  <div class="proposal" data-testid="proposal-ledger">
    <table class="ledger">
      <thead>
        <tr>
          <th scope="col">CSV column</th>
          <th scope="col">First answers</th>
          <th scope="col">Becomes</th>
        </tr>
      </thead>

      <tbody>
        <tr class="band">
          <th colspan="3" scope="rowgroup">What the file says about your plan</th>
        </tr>
        <tr
          v-if="plan.dates.length"
          data-testid="proposal-plan-dates"
          :class="{ checking: planChecks.dates }"
        >
          <td>
            <strong>Market dates</strong>
            <div class="muted">from {{ sources(plan.dates) }}</div>
          </td>
          <td>{{ plan.dates.map((d) => d.text).join(' · ') }}</td>
          <td>
            <div class="becomes">
              <div>{{ datesNote }}</div>
              <ValueFixes
                v-if="disagreements('date').length"
                testid="proposal"
                :entries="disagreements('date')"
                :resolution-for="settledAs"
                :label-for="offeredLabel"
                against="your plan"
                @resolve="onSettle"
              />
            </div>
          </td>
        </tr>
        <tr
          v-if="plan.tiers.length"
          data-testid="proposal-plan-tiers"
          :class="{ checking: planChecks.tiers }"
        >
          <td>
            <strong>Tiers, best first</strong>
            <div class="muted">from the grid's answers</div>
          </td>
          <td>{{ plan.tiers.map((t) => t.name).join(' · ') }}</td>
          <td>
            <div class="becomes">
              <div>{{ tiersNote }}</div>
              <ValueFixes
                v-if="disagreements('tier').length"
                testid="proposal"
                :entries="disagreements('tier')"
                :resolution-for="settledAs"
                against="your plan"
                @resolve="onSettle"
              />
            </div>
          </td>
        </tr>
        <tr data-testid="proposal-plan-ceiling" :class="{ checking: planChecks.ceiling }">
          <td>
            <strong>Most days one vendor may get</strong>
            <div class="muted">an assignment rule</div>
          </td>
          <td>
            <template v-if="plan.ceiling">
              {{ plan.ceiling.days }} day{{ plan.ceiling.days === 1 ? '' : 's' }}
              <div class="muted quote">"{{ plan.ceiling.sentence }}"</div>
            </template>
            <span v-else class="muted">No limit stated</span>
          </td>
          <td>
            <div class="becomes">
              <select
                class="field field--select fate"
                :value="draft.ceiling.days ?? ''"
                aria-label="Most days one vendor may get"
                data-testid="proposal-plan-ceiling-days"
                @change="chooseCeiling"
              >
                <option value="">No limit</option>
                <option v-for="days in CEILINGS" :key="days" :value="days">
                  At most {{ days }} day{{ days === 1 ? '' : 's' }}
                </option>
              </select>
              <template v-if="planChecks.ceiling">
                <span
                  v-for="reason in plan.check"
                  :key="reason"
                  class="chip chip--attention"
                  data-testid="proposal-check"
                  >{{ reason }}</span
                >
              </template>
            </div>
          </td>
        </tr>

        <tr class="band">
          <th colspan="3" scope="rowgroup">Every column, in your file's order</th>
        </tr>
        <tr
          v-for="row in rows"
          :key="row.indexes.join('-')"
          data-testid="proposal-row"
          :data-fate="row.fate"
          :class="{ checking: row.check.length, out: row.fate === 'left_out' }"
        >
          <td>
            <div class="header-text" :title="oneLine(row.header)" data-testid="proposal-row-header">
              {{ oneLine(row.header) }}
            </div>
            <div v-if="row.members.length > 1" class="muted" data-testid="proposal-row-members">
              {{ row.members.length }} columns: {{ row.members.join(' · ') }}
            </div>
            <div class="muted">answered by {{ row.answered }} of {{ proposal.responses }}</div>
          </td>
          <td class="answers">
            <span v-for="(answer, i) in row.firstAnswers" :key="i">{{ answer }}</span>
            <span v-if="!row.firstAnswers.length" class="muted">no answers</span>
          </td>
          <td>
            <div class="becomes">
              <select
                class="field field--select fate"
                :value="targetOf(row)"
                :aria-label="`What ${oneLine(row.header)} becomes`"
                data-testid="proposal-row-fate"
                @change="chooseFate(row, $event)"
              >
                <optgroup label="Who applied">
                  <option
                    v-for="who in WHO_APPLIED"
                    :key="who.target"
                    :value="who.target"
                    :disabled="
                      onlyEssential(row) || takenBy(draft, who.target, first(row)) !== null
                    "
                  >
                    {{ who.label }}{{ takenNote(who.target, row) }}
                  </option>
                </optgroup>
                <optgroup label="An essential question">
                  <option
                    v-for="key in ESSENTIAL_KEYS"
                    :key="key"
                    :value="`essential:${key}`"
                    :disabled="takenBy(draft, `essential:${key}`, first(row)) !== null"
                  >
                    Essential: {{ essentialLabel(key) }}{{ takenNote(`essential:${key}`, row) }}
                  </option>
                </optgroup>
                <option value="custom" :disabled="!row.field || onlyEssential(row)">
                  Your question
                </option>
                <option value="left_out">Left out</option>
              </select>

              <div v-if="row.fate === 'custom' && row.field" class="field-line">
                <select
                  class="field field--select type"
                  :value="row.field.type"
                  aria-label="Question type"
                  data-testid="proposal-row-type"
                  @change="chooseType(row, $event)"
                >
                  <option v-for="type in FIELD_TYPES" :key="type.value" :value="type.value">
                    {{ typeLabel(type.value) }}
                  </option>
                </select>
                <label class="required">
                  <input
                    type="checkbox"
                    :checked="row.field.required"
                    data-testid="proposal-row-required"
                    @change="
                      emit('correct', first(row), {
                        required: ($event.target as HTMLInputElement).checked,
                      })
                    "
                  />
                  Required
                </label>
              </div>

              <div
                v-if="row.fate === 'custom' && row.field?.options.length"
                class="options"
                data-testid="proposal-row-options"
              >
                <label
                  v-for="option in row.field.options"
                  :key="option.value"
                  class="option"
                  :class="{ rare: option.rare }"
                  data-testid="proposal-option"
                >
                  <input
                    type="checkbox"
                    :checked="option.keep"
                    @change="emit('toggle', first(row), option.value)"
                  />
                  {{ option.value }}
                  <span class="muted">{{
                    option.rare ? `chosen by ${option.count} - keep?` : option.count
                  }}</span>
                </label>
                <span v-if="row.field.unlistedOptions" class="muted"
                  >and {{ row.field.unlistedOptions }} one-off answers, which the form builder can
                  add</span
                >
              </div>

              <div class="muted">{{ row.why }}</div>
              <span
                v-for="reason in row.check"
                :key="reason"
                class="chip chip--attention"
                data-testid="proposal-check"
                >{{ reason }}</span
              >
            </div>
          </td>
        </tr>

        <template v-if="unasked.length">
          <tr class="band">
            <th colspan="3" scope="rowgroup">Essential questions no column answers</th>
          </tr>
          <tr v-for="question in unasked" :key="question.key" data-testid="proposal-not-asked">
            <td>
              <strong>{{ question.label }}</strong>
            </td>
            <td class="muted">-</td>
            <td>
              Not asked <span class="muted">· {{ question.why }}</span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <aside class="rail" data-testid="proposal-rail">
      <h2>Your proposal</h2>
      <p class="to-check">
        <strong data-testid="proposal-to-check">{{ counts.toCheck }}</strong> to check
      </p>
      <ul>
        <li>
          <span data-testid="proposal-count-essential">{{ counts.essential }}</span> answer
          essential questions
        </li>
        <li>
          <span data-testid="proposal-count-custom">{{ counts.custom }}</span> become your questions
        </li>
        <li>
          <span data-testid="proposal-count-left-out">{{ counts.leftOut }}</span> left out
        </li>
      </ul>
      <p class="muted">Nothing is written until you confirm.</p>
      <button
        type="button"
        class="btn btn--primary"
        :disabled="busy"
        data-testid="proposal-confirm"
        @click="emit('confirm')"
      >
        Create the form and plan
      </button>
      <button
        type="button"
        class="btn btn--secondary"
        :disabled="busy"
        data-testid="proposal-cancel"
        @click="emit('cancel')"
      >
        Cancel
      </button>
    </aside>
  </div>
</template>

<style scoped>
.proposal {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: var(--space-6);
  align-items: start;
}

.ledger {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
  table-layout: fixed;
}

.ledger thead th {
  text-align: left;
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--mm-text-muted);
  padding: var(--space-2);
  border-bottom: 1px solid var(--mm-border);
}

.ledger thead th:first-child {
  width: 34%;
}

.ledger thead th:nth-child(2) {
  width: 22%;
}

.ledger td {
  padding: var(--space-3) var(--space-2);
  border-bottom: 1px solid var(--mm-border);
  vertical-align: top;
  overflow-wrap: anywhere;
}

.band th {
  text-align: left;
  background: var(--mm-beige);
  font-size: var(--text-xs);
  font-weight: 600;
  padding: var(--space-2);
}

.header-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.answers span {
  display: block;
  color: var(--mm-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.becomes {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}

/* A field primitive is full width by default; in a ledger cell it is as wide as its words. */
.becomes .fate {
  width: auto;
  max-width: 100%;
}

.field-line {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.field-line .type {
  width: auto;
  min-width: 160px;
}

.required {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  white-space: nowrap;
}

/* The box, the option and its count on one baseline; a long option wraps, its count never splits. */
.option {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-1);
}

.option .muted {
  white-space: nowrap;
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
}

.option.rare {
  color: var(--mm-text-muted);
}

.quote {
  margin-top: var(--space-1);
}

/* Every first cell carries the edge, transparent unless the row is worth a check, so marking one
   never shifts its text. */
.ledger tbody td:first-child {
  border-left: 3px solid transparent;
}

.checking td:first-child {
  border-left-color: var(--mm-yellow);
}

.out .header-text {
  color: var(--mm-text-muted);
}

.muted {
  color: var(--mm-text-muted);
  font-size: var(--text-xs);
}

.rail {
  position: sticky;
  /* Under the market's frame, whose height it publishes (MarketFrame). */
  top: calc(var(--banner-h) + var(--market-frame-h) + var(--space-4));
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--mm-border);
  border-radius: var(--radius-card);
  background: white;
}

.rail h2 {
  margin: 0;
  font-size: var(--text-md);
}

.rail p,
.rail ul {
  margin: 0;
}

.rail ul {
  padding-left: var(--space-4);
  font-size: var(--text-sm);
}

.to-check strong {
  font-size: var(--text-lg);
}
</style>
