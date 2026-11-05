/**
 * What the history's areas share: the shapes a reader takes and gives, the small words two areas
 * use, and the generic field rows the areas and the fallback draw (`fieldName`, `fieldValue`,
 * `changedFields`, `recordedFields`), whose per-key values each area keeps in its own file and
 * `index.ts` merges.
 *
 * Imported by the areas, and by `marketHistory.ts`, which re-exports what was public before the
 * split. It reads the merged tables of `index.ts` only inside its functions: the index imports the
 * areas, which import this file, so a read at module load would find them not yet merged.
 */
import { IntakeMode, type FormField, type RejectionQuestion } from '@/assets/types/datatypes';
import {
  ESSENTIAL_KEY_PREFIX,
  TABLE_SHARE_ALSO_KEY,
  TABLE_SHARE_ANSWER_KEY,
  TABLE_SHARE_EMAIL_KEY,
  answerLabel,
  essentialAnswerText,
  essentialLabel,
  inFormOrder,
} from '@/utils/essentialFields';
import { NAMED_VALUES, WORDED_VALUES } from './index';
import type {
  ChangedField,
  MarketHistoryEntry,
  MarketHistoryPart,
  RecordedField,
} from '@/utils/marketHistory';
import { pathPhaseLabel } from '@/utils/marketGuide';
import { getRoleDisplayName } from '@/utils/permissions';
import { getShortDate } from '@/utils/utils';
import { vendorName, type VendorNames } from '@/utils/vendorIdentity';

export type Detail = Record<string, unknown>;

/**
 * What the history's words are given besides the entry, which `entryParts` and `entryChanges`
 * take and each screen builds, one input a line. An input a screen leaves out reads as its default
 * in `CONTEXT_DEFAULTS`. A new input is one property here, its default there, and one line where
 * each screen that has it builds its context.
 */
export interface HistoryContext {
  /** The vendors' names, by address, so a vendor reads by name. */
  names?: VendorNames;
  /** Each of the table's actions by its label: for a change to a row, and for a change no reader
   * has words for yet. */
  labels?: Readonly<Record<string, string>>;
  /** How the market's vendors arrive, so a phase reads as that market's other screens name it
   * ("Review" on a Google Form market). */
  path?: IntakeMode;
  /** The vendor whose own history this is, if it is one: an entry about many vendors reads as that
   * vendor's line, and a deal as that vendor's reviewer alone. */
  own?: string;
  /** The market's choice questions (`rejectionQuestions`), which a price group's conditions name. */
  questions?: readonly RejectionQuestion[];
  /** The market's form, whose questions name a vendor's answers. */
  fields?: readonly FormField[];
  /** The market day stands on a line of its own above the sentence (`entryDay`), so the sentence
   * does not say it again. */
  dayLeads?: boolean;
}

/** The context as a reader gets it: every input there, its default where the screen gave none. */
export type ReaderContext = Required<HistoryContext>;

/** Each input's default. Absent, `path` is a Google Form market's, as `intakeModeOf` reads a
 * market with none. */
export const CONTEXT_DEFAULTS: Readonly<ReaderContext> = {
  names: {},
  labels: {},
  path: IntakeMode.Csv,
  own: '',
  questions: [],
  fields: [],
  dayLeads: false,
};

/** A screen's context with each input it left out, or gave as undefined, at its default. */
export function readerContext(context: HistoryContext): ReaderContext {
  const given = Object.entries(context).filter(([, value]) => value !== undefined);
  return { ...CONTEXT_DEFAULTS, ...Object.fromEntries(given) };
}

/** An entry's before-and-after rows, and whatever else it recorded. */
export interface EntryChanges {
  changed: ChangedField[];
  recorded: RecordedField[];
}

/** One area's words for its entries: the sentence, and the before-and-after rows. */
export interface HistoryReader {
  parts?(entry: MarketHistoryEntry, context: ReaderContext): MarketHistoryPart[];
  changes?(entry: MarketHistoryEntry, context: ReaderContext): EntryChanges | undefined;
}

// Keyed `action/kind` (`kind` empty when the entry has none), `*/kind` for a kind worded alike
// under any action (`dealt`), or `action/*` for every kind of an action.
export type HistoryReaders = Readonly<Record<string, HistoryReader>>;

/** What an area file exports: its readers, and the stored values it names for `fieldValue`. */
export interface HistoryArea {
  readers: HistoryReaders;
  namedValues?: Readonly<Partial<Record<string, (value: string) => string>>>;
  wordedValues?: Readonly<Partial<Record<string, (value: unknown) => string>>>;
}

export function asDetail(value: unknown): Detail {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Detail) : {};
}

export function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function day(value: unknown): string {
  return value ? getShortDate(String(value)) : '';
}

export function listed(words: string[]): string {
  const unique = [...new Set(words)];
  if (unique.length <= 1) return unique.join('');
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

/**
 * What a sentence is made of: words, a vendor as a part of their own, so the screen draws them as
 * a link to their drawer, who made the change, the entry's first vendor, its detail and the detail's
 * two sides, and a day as " on <day>", or as nothing where the day leads the entry.
 */
export function sentence(entry: MarketHistoryEntry, context: ReaderContext) {
  const text = (words: string): MarketHistoryPart => ({ kind: 'text', text: words });
  const who = (email: unknown): MarketHistoryPart => ({
    kind: 'vendor',
    name: vendorName(str(email), context.names),
    email: str(email).trim(),
  });
  const detail = asDetail(entry.detail);
  const before = asDetail(detail.before);
  const after = asDetail(detail.after);
  const vendor = who(entry.vendors[0]);
  const actor = text(`${entry.actor || 'Someone'} `);
  const onDay = (value: unknown) => (value && !context.dayLeads ? ` on ${day(value)}` : '');
  return { text, who, detail, before, after, vendor, actor, onDay };
}

/** The row of the permission table a change to it is about, by its label, else by its id. */
export function rowLabel(
  entry: MarketHistoryEntry,
  labels: Readonly<Record<string, string>>,
): string {
  const id = str(entry.subject.action);
  return labels[id] ?? id;
}

/** A role given, a market's or an organization's. */
export function roleGiven(entry: MarketHistoryEntry, context: ReaderContext): MarketHistoryPart[] {
  const { actor, text, after } = sentence(entry, context);
  return [
    actor,
    text(`gave ${str(entry.subject.email)} the ${getRoleDisplayName(str(after.role))} role`),
  ];
}

/** A role changed, a market's or an organization's. */
export function roleChanged(
  entry: MarketHistoryEntry,
  context: ReaderContext,
): MarketHistoryPart[] {
  const { actor, text, before, after } = sentence(entry, context);
  return [
    actor,
    text(
      `changed ${str(entry.subject.email)} from ${getRoleDisplayName(str(before.role))} to ` +
        getRoleDisplayName(str(after.role)),
    ),
  ];
}

/** A role taken, a market's or an organization's. */
export function roleTaken(entry: MarketHistoryEntry, context: ReaderContext): MarketHistoryPart[] {
  const { actor, text, before } = sentence(entry, context);
  return [
    actor,
    text(`took the ${getRoleDisplayName(str(before.role))} role from ${str(entry.subject.email)}`),
  ];
}

/** A row of the permission table as it stood: its role and where that came from, in words. */
function permissionState(value: unknown): string {
  const state = asDetail(value);
  return `${fieldValue('role', state.role)}, ${fieldValue('source', state.source)}`;
}

/** A whole table reset, a market's or an organization's default, or a market's replaced by its
 * organization's default: each row it changed, by its label. */
export function permissionRows(entry: MarketHistoryEntry, context: ReaderContext): EntryChanges {
  const { labels } = context;
  const detail = asDetail(entry.detail);
  const before = asDetail(detail.before);
  const after = asDetail(detail.after);
  return {
    changed: Object.keys(after).map((id) => ({
      field: labels[id] ?? id,
      before: permissionState(before[id]),
      after: permissionState(after[id]),
    })),
    recorded: [],
  };
}

/**
 * A field's name in words: `review_highlights` reads "Review highlights", a follow-up's owner
 * "Follow-up owner", the one spelling the screens use (E38/F07/S02); an essential question's
 * answer reads as the form asks it, "Tier preference" (E41/F01/S02).
 */
export function fieldName(key: string): string {
  if (key === 'follow_up_owner') return 'Follow-up owner';
  const label = essentialLabel(key);
  if (label !== key) return label;
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The longest a value is drawn before it is cut: a whole plan is a page of JSON. */
const LONGEST_VALUE = 240;

/** A stored value as a line of text: "none" for nothing, JSON for a list or an object. */
export function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'none';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  const words = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return words.length > LONGEST_VALUE ? `${words.slice(0, LONGEST_VALUE)}…` : words;
}

/** A field's value as the screens name it, a phase as the market's `path` does, an essential
 * answer as the review card does, a value an area words or names (`WORDED_VALUES`,
 * `NAMED_VALUES`) as it does, else as `valueText` draws it. */
export function fieldValue(key: string, value: unknown, path: IntakeMode = IntakeMode.Csv): string {
  if (key.startsWith(ESSENTIAL_KEY_PREFIX) && essentialLabel(key) !== key) {
    return essentialAnswerText(key, value).trim() || 'none';
  }
  const worded = WORDED_VALUES[key];
  if (worded) return worded(value);
  const name = key === 'phase' ? (phase: string) => pathPhaseLabel(phase, path) : NAMED_VALUES[key];
  return name && typeof value === 'string' && value ? name(value) : valueText(value);
}

/** The table-share question is one answer stored as three keys: the words, the address read out of
 * them, and any further addresses named. The history reads it as one row under the question's
 * label, never as its storage keys. */
const TABLE_SHARE_KEYS = [TABLE_SHARE_EMAIL_KEY, TABLE_SHARE_ALSO_KEY, TABLE_SHARE_ANSWER_KEY];

/** The table-share answer as a person reads it: the vendor's own words where they were kept, else
 * the address the server read out of them. */
function tableShareAnswer(snapshot: Detail): unknown {
  const words = snapshot[TABLE_SHARE_ANSWER_KEY];
  return typeof words === 'string' && words.trim() ? words : snapshot[TABLE_SHARE_EMAIL_KEY];
}

/** Each update an organizer kept over what the vendor wrote since, under its question, the
 * table-share question's storage keys as one answer in the vendor's words. */
function keptFields(kept: Detail, path: IntakeMode, said: string): RecordedField[] {
  return changedFields(kept, kept, path, true).map((row) => ({
    field: `${said}: ${row.field}`,
    value: row.after,
  }));
}

/** The fields a before/after detail set, each as it was and as it is, the table-share question's
 * three storage keys collapsed into one row in the vendor's words; `listing` keeps a row that reads
 * the same on both sides, for a list of answers kept as they stood. */
export function changedFields(
  before: Detail,
  after: Detail,
  path: IntakeMode,
  listing = false,
): ChangedField[] {
  const rows: ChangedField[] = [];
  let wroteTableShare = false;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (TABLE_SHARE_KEYS.includes(key)) {
      if (wroteTableShare) continue;
      wroteTableShare = true;
      const row = {
        field: fieldName(TABLE_SHARE_EMAIL_KEY),
        before: fieldValue(TABLE_SHARE_EMAIL_KEY, tableShareAnswer(before), path),
        after: fieldValue(TABLE_SHARE_EMAIL_KEY, tableShareAnswer(after), path),
      };
      // The further addresses are read out of the words, so they never change alone; a row that
      // reads the same before and after says nothing, unless it is a list of answers kept as they
      // stood.
      if (listing || row.before !== row.after) rows.push(row);
      continue;
    }
    rows.push({
      field: fieldName(key),
      before: fieldValue(key, before[key], path),
      after: fieldValue(key, after[key], path),
    });
  }
  return rows;
}

/** One thing an entry recorded beside its before and after, as rows: an update kept over what the
 * vendor wrote since, or now matching it, as each answer under its question; a selection's
 * `dealt_to` as each vendor's reviewer; a date as a day; anything else as `valueText` draws it. */
function recordedField(
  entry: MarketHistoryEntry,
  key: string,
  value: unknown,
  path: IntakeMode,
): RecordedField[] {
  if ((key === 'kept' || key === 'matched') && value && typeof value === 'object')
    return keptFields(value as Detail, path, key === 'kept' ? 'Kept' : 'Their answer now matches');
  if (key === 'dealt_to' && value && typeof value === 'object')
    return [{ field: fieldName(key), value: eachDealtTo(entry, asDetail(value)) }];
  return [{ field: fieldName(key), value: key === 'date' ? day(value) : valueText(value) }];
}

/** What an entry recorded beside its before and after (`recordedField`); `beside` leaves those two
 * out, as an entry that has them draws them as its table. */
export function recordedFields(
  entry: MarketHistoryEntry,
  detail: Detail,
  path: IntakeMode,
  beside: boolean,
): RecordedField[] {
  return Object.entries(detail)
    .filter(([key]) => !beside || (key !== 'before' && key !== 'after'))
    .flatMap(([key, value]) => recordedField(entry, key, value, path));
}

/** A selection's `dealt_to`, by application id, as each vendor's address and whose share it was. */
function eachDealtTo(entry: MarketHistoryEntry, dealt: Detail): string {
  const ids = Array.isArray(entry.subject.application_ids) ? entry.subject.application_ids : [];
  return ids
    .map((id, index) => [str(entry.vendors[index]), str(dealt[str(id)])])
    .filter(([, reviewer]) => reviewer)
    .map(([vendor, reviewer]) => `${vendor}: ${reviewer}`)
    .join(', ');
}

/**
 * A vendor's answers, as they applied or as an organizer updated them: each question as the form
 * asks it, in the form's order, each answer as the review card reads it, the table-share
 * question's three storage keys as one answer in the vendor's words, and never a stored key or
 * JSON (E38/F07/S02, E41/F01/S02). An answer that reads the same on both sides is no change.
 */
export function vendorAnswers(entry: MarketHistoryEntry, context: ReaderContext): EntryChanges {
  const { path, fields } = context;
  const detail = asDetail(entry.detail);
  const before = asDetail(detail.before);
  const after = asDetail(detail.after);
  const reading = (key: string, value: unknown) => essentialAnswerText(key, value).trim() || 'none';
  const changed: ChangedField[] = [];
  let wroteTableShare = false;
  for (const key of inFormOrder(
    [...new Set([...Object.keys(before), ...Object.keys(after)])],
    fields,
  )) {
    const share = TABLE_SHARE_KEYS.includes(key);
    if (share && wroteTableShare) continue;
    wroteTableShare ||= share;
    const row = share
      ? {
          field: answerLabel(TABLE_SHARE_EMAIL_KEY, fields),
          before: reading(TABLE_SHARE_EMAIL_KEY, tableShareAnswer(before)),
          after: reading(TABLE_SHARE_EMAIL_KEY, tableShareAnswer(after)),
        }
      : {
          field: answerLabel(key, fields),
          before: reading(key, before[key]),
          after: reading(key, after[key]),
        };
    if (row.before !== row.after) changed.push(row);
  }
  return { changed, recorded: recordedFields(entry, detail, path, true) };
}
