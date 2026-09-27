/**
 * The proposal a Google Form's responses CSV makes for a draft market (E24/F02), as the server
 * sends it from `POST /markets/:id/csv-proposal`, and what the review screen reads off it.
 *
 * A **proposal** is what the product suggests the file's columns become: written nowhere until the
 * organizer confirms (CONTEXT.md). The server decides every row; this file only arranges them for
 * the ledger - a grid's columns are one question, so one row - and counts them for the rail.
 */

export type Fate = 'submitted_at' | 'applicant_email' | 'essential' | 'custom' | 'left_out';

export type FieldType =
  'text' | 'number' | 'select' | 'multi_select' | 'checkbox' | 'date' | 'email';

export interface ProposedOption {
  value: string;
  /** How many distinct applicants chose it. */
  count: number;
  /** Few chose it: shown unticked, for the organizer to keep or not. */
  rare: boolean;
  keep: boolean;
}

export interface ProposedField {
  key: string;
  label: string;
  helpText: string | null;
  type: FieldType;
  required: boolean;
  options: ProposedOption[];
  /** Answers not listed as options, one applicant's each. */
  unlistedOptions: number;
  /** A file upload in the Google Form, proposed as a question asking for a link. */
  upload: boolean;
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
  /** 0 is Monday, as Python counts; null when the file states no weekday. */
  weekday: number | null;
  from: 'header' | 'answers';
  /** The plan's own date this is, or null. */
  matches: string | null;
}

export interface Proposal {
  rowCount: number;
  responses: number;
  columns: ProposedColumn[];
  plan: {
    dates: ProposedDate[];
    year: number | null;
    tiers: Array<{ name: string; matches: string | null }>;
    ceiling: { days: number; sentence: string; column: number; from: string } | null;
    disagreements: Array<{ kind: 'date' | 'tier'; value: string }>;
    check: string[];
  };
  notAsked: Array<{ key: string; label: string; why: string }>;
  typesafe: { asked: boolean };
}

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

/** The ledger's rows, in the file's order: a grid's consecutive columns are one row. */
export function ledgerRows(proposal: Proposal): LedgerRow[] {
  const rows: LedgerRow[] = [];
  for (const column of proposal.columns) {
    const last = rows[rows.length - 1];
    const member = column.header.match(GRID_OPTION)?.[1]?.trim() ?? column.header;
    if (column.group && last && last.header === column.group) {
      last.indexes.push(column.index);
      last.members.push(member);
      last.answered = Math.max(last.answered, column.answered);
      for (const reason of column.check) if (!last.check.includes(reason)) last.check.push(reason);
      continue;
    }
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

export interface ProposalCounts {
  toCheck: number;
  essential: number;
  custom: number;
  leftOut: number;
}

/** The rail's numbers: rows to check (the plan's facts count as one), and what columns become. */
export function proposalCounts(proposal: Proposal): ProposalCounts {
  const rows = ledgerRows(proposal);
  return {
    toCheck: rows.filter((r) => r.check.length).length + (proposal.plan.check.length ? 1 : 0),
    essential: rows.filter((r) => r.fate === 'essential').length,
    custom: rows.filter((r) => r.fate === 'custom').length,
    leftOut: rows.filter((r) => r.fate === 'left_out').length,
  };
}

/**
 * The year the dialog opens on: the one the stated weekdays fit, or this year with a warning when
 * none does.
 */
export function initialYear(
  plan: Proposal['plan'],
  today: Date = new Date(),
): { year: number; fits: boolean } {
  return plan.year !== null
    ? { year: plan.year, fits: true }
    : { year: today.getFullYear(), fits: false };
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "Monday, November 17 is a Monday in 2025", from the first date that states a weekday. */
export function weekdayNote(dates: ProposedDate[], year: number): string {
  const stated = dates.find((d) => d.weekday !== null);
  return stated ? `${stated.text} is a ${WEEKDAYS[stated.weekday as number]} in ${year}` : '';
}

/** The market date a file's month and day make in a year, as the plan stores it. */
export function dateInYear(date: Pick<ProposedDate, 'month' | 'day'>, year: number): string {
  return `${year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}
