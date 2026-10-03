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
import {
  AVAILABLE_DATES_KEY,
  ESSENTIAL_KEYS,
  MAX_DATES_KEY,
  TIER_PREFERENCE_KEY,
  essentialLabel,
} from '@/utils/essentialFields';

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
  /** Every option, one-offs included: an answer that is not listed cannot be kept (bug 4). */
  options: ProposedOption[];
  /** What each applicant answered, as indexes into `options`, one list per applicant. */
  answers: number[][];
}

export interface ProposedField {
  key: string;
  label: string;
  helpText: string | null;
  type: FieldType;
  required: boolean;
  options: ProposedOption[];
  /**
   * How many applicants answered only options that are not kept, so would have no answer here.
   * Worked out by the ledger from the answers, for whichever options are kept.
   */
  dropped?: number;
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

type ChoiceType = 'select' | 'multi_select';

/** What the organizer has made of one ledger row. */
export interface RowChoice {
  fate: Fate;
  essential: string | null;
  type: FieldType;
  required: boolean;
  /**
   * The options kept, by value, for each way of reading the answers as choices: whole answers for
   * one choice, the options inside them for several. Each keeps its own, so switching back and
   * forth never loses what the organizer ticked.
   */
  kept: Partial<Record<ChoiceType, string[]>>;
  /** Once the organizer touches a row it is theirs, and no longer one to check. */
  corrected: boolean;
}

export interface ProposalDraft {
  /** By the row's first column. */
  rows: Record<number, RowChoice>;
  /** A plan disagreement's value, per kind, to the plan's value it is, or IGNORE_VALUE. */
  settled: Partial<Record<DisagreementKind, Record<string, string>>>;
  /** The most days one vendor may get: null for no limit. `fromPlan` when the plan already had
   * one, which wins and leaves nothing to check. */
  ceiling: { days: number | null; corrected: boolean; fromPlan?: boolean };
}

/** The working copy as the proposal made it: nothing corrected, nothing settled. */
export function draftFrom(proposal: Proposal, planCeiling: number | null = null): ProposalDraft {
  const rows: Record<number, RowChoice> = {};
  for (const row of ledgerRows(proposal)) {
    const kept: RowChoice['kept'] = {};
    for (const type of ['select', 'multi_select'] as ChoiceType[]) {
      const read = row.field?.optionsByType[type]?.options;
      if (read) kept[type] = read.filter((o) => o.keep).map((o) => o.value);
    }
    rows[row.indexes[0]] = {
      fate: row.fate,
      essential: row.essential,
      type: row.field?.type ?? 'text',
      required: row.field?.required ?? false,
      kept,
      corrected: false,
    };
  }
  return {
    rows,
    settled: {},
    ceiling: planCeiling
      ? { days: planCeiling, corrected: false, fromPlan: true }
      : { days: proposal.plan.ceiling?.days ?? null, corrected: false },
  };
}

/** Change one row: its fate, which essential, its type or whether it is required. */
export function correct(draft: ProposalDraft, row: number, change: Partial<RowChoice>): void {
  const current = draft.rows[row];
  if (!current) return;
  const next = { ...current, ...change, corrected: true };
  if (change.fate && change.fate !== 'essential') next.essential = null;
  draft.rows[row] = next;
}

/** Keep an option, or stop keeping it, in the reading the row's type uses. */
export function toggleOption(draft: ProposalDraft, row: number, value: string): void {
  const current = draft.rows[row];
  if (!current || !isChoice(current.type)) return;
  const kept = current.kept[current.type] ?? [];
  const next = kept.includes(value) ? kept.filter((v) => v !== value) : [...kept, value];
  correct(draft, row, { kept: { ...current.kept, [current.type]: next } });
}

/** State the most days one vendor may get; null for no limit. */
export function setCeiling(draft: ProposalDraft, days: number | null): void {
  draft.ceiling = { days, corrected: true };
}

/** A choice question the organizer kept no option of, which confirm makes a question answered in
 * words (`csv_start._form`). */
export function keepsNoOption(field: ProposedField): boolean {
  return isChoice(field.type) && !field.options.some((o) => o.keep);
}

function isChoice(type: FieldType): type is ChoiceType {
  return type === 'select' || type === 'multi_select';
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

/** What confirm sends besides the file and the year: each row's final shape, the settled values
 * and the ceiling. The server reads the file again for everything else. */
export function confirmChoices(draft: ProposalDraft) {
  return {
    rows: Object.entries(draft.rows).map(([first, choice]) => ({
      column: Number(first),
      fate: choice.fate,
      essential: choice.essential,
      type: choice.type,
      required: choice.required,
      kept: isChoice(choice.type) ? (choice.kept[choice.type] ?? []) : [],
    })),
    settled: draft.settled,
    ceiling: draft.ceiling.days,
  };
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
    // The proposal's reason is for what it proposed; beneath another fate it says something untrue.
    const proposed = choice.fate === row.fate && choice.essential === row.essential;
    return {
      ...row,
      fate: choice.fate,
      essential: choice.essential,
      why: proposed ? row.why : '',
      check: choice.corrected ? [] : row.check,
      field,
    };
  });
}

function optionsFor(
  field: ProposedField,
  choice: RowChoice,
): Pick<ProposedField, 'options' | 'dropped'> {
  if (!isChoice(choice.type)) return { options: [], dropped: 0 };
  const read = field.optionsByType[choice.type];
  if (!read) return { options: [], dropped: 0 };
  const kept = new Set(choice.kept[choice.type] ?? []);
  return {
    options: read.options.map((o) => ({ ...o, keep: kept.has(o.value) })),
    dropped: droppedBy(read, kept),
  };
}

/**
 * How many applicants answered only options outside `kept`. A required question then has no
 * answer from them, and the import refuses their whole application (bug 4). Nothing kept at all is
 * not this case: confirm makes that a question answered in words, which keeps every answer.
 */
export function droppedBy(read: ProposedChoices, kept: Set<string>): number {
  if (kept.size === 0) return 0;
  return read.answers.filter(
    (answer) => answer.length > 0 && !answer.some((i) => kept.has(read.options[i]?.value ?? '')),
  ).length;
}

/** The essential questions no column answers now, with what becomes of each and why - the
 * proposal's reason where it gave one, and the organizer's own move where they took the column away.
 *
 * "Number of dates you want" is still asked online, but an imported row without it has no personal
 * limit (bug 24), so it is not "not asked". */
export function notAsked(
  proposal: Proposal,
  draft: ProposalDraft,
): Array<{ key: string; label: string; status: string; why: string }> {
  const answered = new Set(Object.values(draft.rows).map((r) => r.essential));
  // A tier GRID answers the dates too - each day's row is a day they can come - as the import reads
  // it (`tiers_answer_dates` in csv_import.py). One tiers column does not (bug 42).
  if (
    draftRows(proposal, draft).some(
      (row) => row.essential === TIER_PREFERENCE_KEY && row.indexes.length > 1,
    )
  ) {
    answered.add(AVAILABLE_DATES_KEY);
  }
  return ESSENTIAL_KEYS.filter((key) => !answered.has(key)).map((key) => ({
    key,
    label: essentialLabel(key),
    status: key === MAX_DATES_KEY ? 'No personal limit' : 'Not asked',
    why:
      proposal.notAsked.find((q) => q.key === key)?.why ??
      'You gave the column that answered it another use',
  }));
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
    ceiling: proposal.plan.check.length > 0 && !draft.ceiling.corrected && !draft.ceiling.fromPlan,
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
  const plan = planRowsToCheck(proposal, draft ?? draftFrom(proposal));
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
