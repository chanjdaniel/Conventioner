<script setup lang="ts">
/**
 * The proposal ledger (E24/F03/S01, variant A of the form-started-from-a-CSV ticket 05).
 *
 * The import's own ledger, in the file's order, so the organizer learns one screen: a row per
 * column - a grid's columns are one - saying what it becomes, under a band of what the file says
 * about the plan, and over a band of the essential questions no column answers. A row worth a
 * second look carries a yellow edge and the reason. Beside it, a rail sticks under the market's
 * frame with the counts, the promise that nothing is written yet, and the way out.
 */
import { computed } from 'vue';
import {
  ledgerRows,
  proposalCounts,
  type LedgerRow,
  type Proposal,
  type ProposedDate,
} from '@/utils/csvProposal';
import { essentialLabel } from '@/utils/essentialFields';
import { FIELD_TYPES } from '@/utils/applicationForm';

const props = defineProps<{
  proposal: Proposal;
  year: number;
  /** Confirm is S03's; until it is wired the rail says so rather than offering a dead button. */
  canConfirm?: boolean;
}>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();

const rows = computed(() => ledgerRows(props.proposal));
const counts = computed(() => proposalCounts(props.proposal));
const plan = computed(() => props.proposal.plan);

const FATE_LABELS: Record<LedgerRow['fate'], string> = {
  submitted_at: 'When they applied',
  applicant_email: "The applicant's email",
  essential: 'An essential question',
  custom: 'Your question',
  left_out: 'Left out',
};

function typeLabel(type: string): string {
  return FIELD_TYPES.find((t) => t.value === type)?.label ?? type;
}

function dateLabel(date: ProposedDate): string {
  return date.text;
}

const datesNote = computed(() => {
  const dates = plan.value.dates;
  if (!dates.length) return '';
  const matched = dates.filter((d) => d.matches).length;
  if (
    dates.some((d) => d.matches !== null) ||
    plan.value.disagreements.some((d) => d.kind === 'date')
  )
    return `${matched} of ${dates.length} are your plan's dates`;
  return `Become your plan's dates in ${props.year}`;
});

const tiersNote = computed(() => {
  const tiers = plan.value.tiers;
  if (!tiers.length) return '';
  if (plan.value.disagreements.some((d) => d.kind === 'tier') || tiers.some((t) => t.matches))
    return `${tiers.filter((t) => t.matches).length} of ${tiers.length} are your plan's tiers`;
  return "Become your plan's tiers";
});

function source(from: string): string {
  return from === 'header' ? 'the grid of days' : 'answers that are dates';
}

function headerOf(row: LedgerRow): string {
  return row.header.replace(/\s+/g, ' ').trim();
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
          :class="{ checking: plan.disagreements.some((d) => d.kind === 'date') }"
        >
          <td>
            <strong>Market dates</strong>
            <div class="muted">from {{ source(plan.dates[0].from) }}</div>
          </td>
          <td>{{ plan.dates.map(dateLabel).join(' · ') }}</td>
          <td>{{ datesNote }}</td>
        </tr>
        <tr v-if="plan.tiers.length" data-testid="proposal-plan-tiers">
          <td>
            <strong>Tiers, best first</strong>
            <div class="muted">from the grid's answers</div>
          </td>
          <td>{{ plan.tiers.map((t) => t.name).join(' · ') }}</td>
          <td>{{ tiersNote }}</td>
        </tr>
        <tr data-testid="proposal-plan-ceiling" :class="{ checking: plan.check.length }">
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
            <div v-if="plan.ceiling">Becomes the most days per vendor</div>
            <div v-else class="muted">Nothing to write</div>
            <span
              v-for="reason in plan.check"
              :key="reason"
              class="chip chip--attention"
              data-testid="proposal-check"
              >{{ reason }}</span
            >
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
          <td class="column">
            <div class="header-text" :title="headerOf(row)" data-testid="proposal-row-header">
              {{ headerOf(row) }}
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
              <div>
                <strong data-testid="proposal-row-fate">{{ FATE_LABELS[row.fate] }}</strong>
                <span v-if="row.essential">: {{ essentialLabel(row.essential) }}</span>
              </div>
              <div v-if="row.fate === 'custom' && row.field" class="field-line">
                {{ typeLabel(row.field.type) }}
                <span class="muted">·</span>
                {{ row.field.required ? 'Required' : 'Optional' }}
              </div>
              <div
                v-if="row.fate === 'custom' && row.field?.options.length"
                class="options"
                data-testid="proposal-row-options"
              >
                <span
                  v-for="option in row.field.options"
                  :key="option.value"
                  class="option"
                  :class="{ off: !option.keep }"
                  >{{ option.value }} <span class="muted">{{ option.count }}</span></span
                >
                <span v-if="row.field.unlistedOptions" class="muted"
                  >and {{ row.field.unlistedOptions }} one-off answers</span
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

        <template v-if="proposal.notAsked.length">
          <tr class="band">
            <th colspan="3" scope="rowgroup">Essential questions no column answers</th>
          </tr>
          <tr
            v-for="question in proposal.notAsked"
            :key="question.key"
            data-testid="proposal-not-asked"
          >
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
        :disabled="!canConfirm"
        data-testid="proposal-confirm"
        @click="emit('confirm')"
      >
        Create the form and plan
      </button>
      <button
        type="button"
        class="btn btn--secondary"
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
  width: 36%;
}

.ledger thead th:nth-child(2) {
  width: 24%;
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

.options {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
}

/* Not kept yet: a rare option waits for the organizer, so it is quieter, not crossed out. */
.option.off {
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
