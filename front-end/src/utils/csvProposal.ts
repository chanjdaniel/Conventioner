/**
 * The proposal a Google Form's responses CSV makes for a draft market (E24/F02), as the server
 * sends it from `POST /markets/:id/csv-proposal`, and the organizer's corrections to it (E24/F03).
 *
 * A **proposal** is what the product suggests the file's columns become: written nowhere until the
 * organizer confirms (CONTEXT.md). The server decides every row. What lives here is the organizer's
 * working copy of it - which rows they changed, and to what - and how the ledger reads the two
 * together: a grid's columns are one question, so one row, and a corrected row is no longer one
 * to check.
 */
import { FIELD_TYPES } from '@/utils/applicationForm';

export type Fate = 'submitted_at' | 'applicant_email' | 'essential' | 'custom' | 'left_out';

export type FieldType = (typeof FIELD_TYPES)[number]['value'];

export interface ProposedOption {
  value: string;
  /** How many distinct applicants chose it. */
  count: number;
  /** Few chose it: shown unticked, for the organizer to keep or not. */
  rare: boolean;
  keep: boolean;
}

export interface ProposedChoices {
  options: ProposedOption[];
  /** Answers not listed, one applicant's each. */
  unlisted: number;
}

export interface ProposedField {
  key: string;
  label: string;
  helpText: string | null;
  type: FieldType;
  required: boolean;
  options: ProposedOption[];
  unlistedOptions: number;
  /** A file upload in the Google Form, proposed as a question asking for a link. */
  upload: boolean;
  /** The options each choice type reads from the answers: whole answers, or options inside them. */
  optionsByType: Partial<Record<'select' | 'multi_select', ProposedChoices>>;
}

export interface ProposedColumn {
  index: number;
  header: string;
  /** The grid question this column is one option of, or null. */
  group: string | null;
  answered: number;
  firstAnswers: string[];
  fate: Fate;
  essential: string | null;
  leftOut: 'organizer' | 'duplicate' | 'empty' | null;
  why: string;
  /** Why this row is worth a second look; empty when it is not. */
  check: string[];
  /** What the column would be as a question of the organizer's own; null for an empty column. */
  field: ProposedField | null;
}

export interface ProposedDate {
  text: string;
  month: number;
  day: number;
  /** Monday is 0, as the server counts; null when the file states no weekday. */
  weekday: number | null;
  from: 'header' | 'answers';
  /** The plan's own date this is, or null. */
  matches: string | null;
}

export type DisagreementKind = 'date' | 'tier';

export interface Proposal {
  rowCount: number;
  responses: number;
  columns: ProposedColumn[];
  plan: {
    dates: ProposedDate[];
    year: number | null;
    tiers: Array<{ name: string; matches: string | null }>;
    ceiling: { days: number; sentence: string; column: number; from: 'rules' | 'typesafe' } | null;
    disagreements: Array<{ kind: DisagreementKind; value: string }>;
    check: string[];
  };
  notAsked: Array<{ key: string; label: string; why: string }>;
  typesafe: { asked: boolean };
}

/* ── The working copy ─────────────────────────────────────────────────────────────────────── */

/** What the organizer has made of one ledger row. */
export interface RowChoice {
  fate: Fate;
  essential: string | null;
  type: FieldType;
  required: boolean;
  /** The options kept, by value. */
  kept: string[];
  /** Once the organizer touches a row it is theirs, and no longer one to check. */
  corrected: boolean;
}

export interface ProposalDraft {
  /** By the row's first column. */
  rows: Record<number, RowChoice>;
  /** A plan disagreement's value, per kind, to the plan's value it is, or IGNORE_VALUE. */
  settled: Partial<Record<DisagreementKind, Record<string, string>>>;
}

/** The working copy as the proposal made it: nothing corrected, nothing settled. */
export function draftFrom(proposal: Proposal): ProposalDraft {
  const rows: Record<number, RowChoice> = {};
  for (const row of ledgerRows(proposal)) {
    rows[row.indexes[0]] = {
      fate: row.fate,
      essential: row.essential,
      type: row.field?.type ?? 'text',
      required: row.field?.required ?? false,
      kept: (row.field?.options ?? []).filter((o) => o.keep).map((o) => o.value),
      corrected: false,
    };
  }
  return { rows, settled: {} };
}

/** Change one row: its fate, which essential, its type or whether it is required. */
export function correct(draft: ProposalDraft, row: number, change: Partial<RowChoice>): void {
  const current = draft.rows[row];
  if (!current) return;
  const next = { ...current, ...change, corrected: true };
  if (change.fate && change.fate !== 'essential') next.essential = null;
  draft.rows[row] = next;
}

/** Keep an option, or stop keeping it. */
export function toggleOption(draft: ProposalDraft, row: number, value: string): void {
  const current = draft.rows[row];
  if (!current) return;
  const kept = current.kept.includes(value)
    ? current.kept.filter((v) => v !== value)
    : [...current.kept, value];
  correct(draft, row, { kept });
}

/** Settle a value the plan does not have: one of the plan's values, or ignored. */
export function settle(
  draft: ProposalDraft,
  kind: DisagreementKind,
  value: string,
  choice: string,
): void {
  draft.settled = { ...draft.settled, [kind]: { ...(draft.settled[kind] ?? {}), [value]: choice } };
}

/**
 * What a row becomes, as one key a menu can offer: `submitted_at`, `applicant_email`,
 * `essential:<key>`, `custom` or `left_out`.
 */
export function targetOf(choice: Pick<RowChoice, 'fate' | 'essential'>): string {
  return choice.fate === 'essential' ? `essential:${choice.essential}` : choice.fate;
}

/** The inverse of `targetOf`. */
export function choiceOfTarget(target: string): Pick<RowChoice, 'fate' | 'essential'> {
  if (target.startsWith('essential:'))
    return { fate: 'essential', essential: target.slice('essential:'.length) };
  return { fate: target as Fate, essential: null };
}

/** Targets only one column may be: who applied, and each essential question, as in the import. */
const SINGLE_TARGET = (target: string) =>
  target === 'submitted_at' || target === 'applicant_email' || target.startsWith('essential:');

/** The row that already is `target`, other than `row`, or null. */
export function takenBy(draft: ProposalDraft, target: string, row: number): number | null {
  if (!SINGLE_TARGET(target)) return null;
  const found = Object.entries(draft.rows).find(
    ([first, choice]) => Number(first) !== row && targetOf(choice) === target,
  );
  return found ? Number(found[0]) : null;
}

/* ── The ledger ───────────────────────────────────────────────────────────────────────────── */

/** One row of the ledger: a column, or a grid's columns together. */
export interface LedgerRow {
  indexes: number[];
  header: string;
  /** A grid's options, one per column, beneath its stem. */
  members: string[];
  answered: number;
  firstAnswers: string[];
  fate: Fate;
  essential: string | null;
  why: string;
  check: string[];
  field: ProposedField | null;
}

const GRID_OPTION = /\[([^\]]+)\]\s*$/;

/** The ledger's rows as proposed, in the file's order: a grid's consecutive columns are one row. */
export function ledgerRows(proposal: Proposal): LedgerRow[] {
  const rows: LedgerRow[] = [];
  let grid: string | null = null;
  for (const column of proposal.columns) {
    const last = rows[rows.length - 1];
    const member = column.header.match(GRID_OPTION)?.[1]?.trim() ?? column.header;
    // Only a column of the grid the last row is joins it: a column merely named like its stem
    // does not.
    if (column.group && last && grid === column.group) {
      last.indexes.push(column.index);
      last.members.push(member);
      last.answered = Math.max(last.answered, column.answered);
      for (const reason of column.check) if (!last.check.includes(reason)) last.check.push(reason);
      continue;
    }
    grid = column.group;
    rows.push({
      indexes: [column.index],
      header: column.group ?? column.header,
      members: column.group ? [member] : [],
      answered: column.answered,
      firstAnswers: column.firstAnswers,
      fate: column.fate,
      essential: column.essential,
      why: column.why,
      check: [...column.check],
      field: column.field,
    });
  }
  return rows;
}

/** The ledger's rows with the organizer's corrections applied. */
export function draftRows(proposal: Proposal, draft: ProposalDraft): LedgerRow[] {
  return ledgerRows(proposal).map((row) => {
    const choice = draft.rows[row.indexes[0]];
    if (!choice) return row;
    const field = row.field && {
      ...row.field,
      type: choice.type,
      required: choice.required,
      ...optionsFor(row.field, choice),
    };
    return {
      ...row,
      fate: choice.fate,
      essential: choice.essential,
      check: choice.corrected ? [] : row.check,
      field,
    };
  });
}

function optionsFor(
  field: ProposedField,
  choice: RowChoice,
): Pick<ProposedField, 'options' | 'unlistedOptions'> {
  if (choice.type !== 'select' && choice.type !== 'multi_select')
    return { options: [], unlistedOptions: 0 };
  const read = field.optionsByType[choice.type];
  if (!read) return { options: field.options, unlistedOptions: field.unlistedOptions };
  // A type the organizer switched to keeps what that reading keeps by default, and whatever
  // they ticked themselves since.
  const switched = choice.type !== field.type;
  return {
    options: read.options.map((o) => ({
      ...o,
      keep: switched && !choice.kept.includes(o.value) ? o.keep : choice.kept.includes(o.value),
    })),
    unlistedOptions: read.unlisted,
  };
}

/** Which of the plan's rows still need the organizer: a value the plan lacks, or a doubt. */
export function planRowsToCheck(
  proposal: Proposal,
  draft: ProposalDraft,
): Record<'dates' | 'tiers' | 'ceiling', boolean> {
  const unsettled = (kind: DisagreementKind) =>
    proposal.plan.disagreements.some((d) => d.kind === kind && !draft.settled[kind]?.[d.value]);
  return {
    dates: unsettled('date'),
    tiers: unsettled('tier'),
    ceiling: proposal.plan.check.length > 0,
  };
}

export interface ProposalCounts {
  toCheck: number;
  essential: number;
  custom: number;
  leftOut: number;
}

/** The rail's numbers: the rows still to check, and what the columns become. */
export function proposalCounts(proposal: Proposal, draft?: ProposalDraft): ProposalCounts {
  const rows = draft ? draftRows(proposal, draft) : ledgerRows(proposal);
  const plan = planRowsToCheck(proposal, draft ?? { rows: {}, settled: {} });
  return {
    toCheck: rows.filter((r) => r.check.length).length + Object.values(plan).filter(Boolean).length,
    essential: rows.filter((r) => r.fate === 'essential').length,
    custom: rows.filter((r) => r.fate === 'custom').length,
    leftOut: rows.filter((r) => r.fate === 'left_out').length,
  };
}

/* ── The year ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The year the dialog opens on: the one the stated weekdays fit, or this year when none does.
 */
export function initialYear(plan: Proposal['plan'], today: Date = new Date()): number {
  return plan.year ?? today.getFullYear();
}

/** Monday first, as the server counts weekdays. */
const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

function weekdayIn(date: Pick<ProposedDate, 'month' | 'day'>, year: number): number {
  // JavaScript counts from Sunday; the server from Monday.
  return (new Date(Date.UTC(year, date.month - 1, date.day)).getUTCDay() + 6) % 7;
}

type Weekdayed = Pick<ProposedDate, 'text' | 'month' | 'day' | 'weekday'>;

/**
 * Whether every weekday the dates state falls on its date in `year`; null when none states one,
 * since then there is nothing to check a year against.
 */
export function weekdaysFit(dates: Weekdayed[], year: number): boolean | null {
  const stated = dates.filter((d) => d.weekday !== null);
  if (!stated.length) return null;
  return stated.every((d) => weekdayIn(d, year) === d.weekday);
}

/**
 * "Monday, November 17 is a Monday in 2025", or, when the year does not fit, which weekday it
 * would be instead; empty when no date states a weekday.
 */
export function weekdayNote(dates: Weekdayed[], year: number): string {
  const stated = dates.find((d) => d.weekday !== null);
  if (!stated) return '';
  const actual = weekdayIn(stated, year);
  return actual === stated.weekday
    ? `${stated.text} is a ${WEEKDAY_NAMES[actual]} in ${year}`
    : `${stated.text} is a ${WEEKDAY_NAMES[actual]} in ${year}, not a ${WEEKDAY_NAMES[stated.weekday ?? actual]}`;
}

/** The market date a file's month and day make in a year, as the plan stores it. */
export function dateInYear(date: Pick<ProposedDate, 'month' | 'day'>, year: number): string {
  return `${year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}
