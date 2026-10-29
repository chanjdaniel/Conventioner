/**
 * What the applicants answered, as the Stats tab charts it (E45/F01/S02): a ledger card per choice
 * question of the form, narrowed to every applicant, the approved or the assigned.
 *
 * Counted on the server, with who applied, in the Stats tab's one answer (`utils/marketStats.ts`):
 * each option the question offers, "Other" for every answer it does not (written in on a Google
 * Form, or an option since taken off), and "No answer". A row leads nowhere: the Applications
 * tab's All view filters by status only, not by an answer.
 */
import { ledgerRows, type LedgerRow } from '@/utils/barLedger';

export type AnswerGroup = 'all' | 'approved' | 'assigned';

/** The groups a chart narrows to, in the switch's order; `whole` is what a share is of. */
export const ANSWER_GROUPS: { id: AnswerGroup; label: string; whole: string }[] = [
  { id: 'all', label: 'All', whole: 'applicants' },
  { id: 'approved', label: 'Approved', whole: 'approved applicants' },
  { id: 'assigned', label: 'Assigned', whole: 'assigned applicants' },
];

/** The group an address names, or every applicant for one it does not know. */
export function answerGroup(asked: unknown): AnswerGroup {
  return ANSWER_GROUPS.find((group) => group.id === asked)?.id ?? 'all';
}

/** One row as the server counts it: an option the question offers, "Other", or "No answer". */
export interface CountedAnswer {
  kind: 'option' | 'other' | 'none';
  /** The option, for an `option` row. */
  answer?: string;
  count: number;
}

export interface QuestionCounts {
  key: string;
  label: string;
  type: 'select' | 'multi_select' | 'checkbox';
  answers: Record<AnswerGroup, CountedAnswer[]>;
}

export interface AnswerCounts {
  /** How many applications are in each group. */
  groups: Record<AnswerGroup, number>;
  /** The form's choice questions, in its order. */
  questions: QuestionCounts[];
}

export interface QuestionLedger {
  key: string;
  title: string;
  rows: LedgerRow[];
}

const OTHER_LABEL = 'Other';
const NONE_LABEL = 'No answer';

/** Each question's card in one group; a share is of everyone in the group. */
export function questionLedgers(counts: AnswerCounts, group: AnswerGroup): QuestionLedger[] {
  return counts.questions.map((question) => ({
    key: question.key,
    title: question.label,
    rows: ledgerRows(
      question.answers[group].map((row) => ({
        label:
          row.kind === 'option'
            ? (row.answer ?? '')
            : row.kind === 'other'
              ? OTHER_LABEL
              : NONE_LABEL,
        // Kept apart from any option, which the organizer may well have named "Other".
        value: row.kind === 'option' ? `option:${row.answer}` : row.kind,
        count: row.count,
      })),
      counts.groups[group],
    ),
  }));
}
