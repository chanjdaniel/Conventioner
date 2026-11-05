/**
 * Every change on a market, as a person reads it (E40/F01/S03), and an organization's own changes
 * (E40/F02/S01), which the same history keeps and Manage organization reads.
 *
 * The back end stores each entry structured - the table's action, a finer kind, the vendors, a
 * subject and a detail of the fields before and after (`back-end/history.py`,
 * `docs/implementation/data/history.md`) - and the wording is in the front end, so a sentence can
 * change without a migration or a back-end release. Each area's words are its own file under
 * `historyReaders/`, keyed by the entry's action and kind; this file composes them, and words what
 * no reader has words for. A placement is worded by `placementHistory.ts`, the assignment history's
 * own words, so the two screens say it alike. The organizer's words: assign and allocate tables,
 * never place, seat or run.
 * The detail and the subject are served as stored, snake_case, since their keys are data.
 */
import { readersOf } from '@/utils/historyReaders';
import {
  asDetail,
  changedFields,
  day,
  fieldName,
  fieldValue,
  readerContext,
  recordedFields,
  sentence,
  valueText,
  type Detail,
  type EntryChanges,
  type HistoryContext,
} from '@/utils/historyReaders/shared';
import { getFormattedTimestamp } from '@/utils/utils';

/** One entry of the market's history, as `GET /markets/:id/history` serves it. */
export interface MarketHistoryEntry {
  id: string;
  /** Who made the change: an organizer's address, an applicant's for their own, or null. */
  actor: string | null;
  at: string;
  /** The id of the table's row the change asked, or `apply` for an applicant's own. */
  action: string;
  kind: string | null;
  vendors: string[];
  subject: Detail;
  detail: Detail | null;
}

/** The group of the table Assignment history is narrowed to, as the server names it. */
export const ASSIGNMENT_GROUP = 'Assignment';

/** A group of the table, the kinds of change the history is narrowed by. */
export interface MarketHistoryGroup {
  group: string;
  actions: Array<{ id: string; label: string }>;
}

/** One piece of an entry's sentence: words, or a vendor, who links to their drawer. */
export type MarketHistoryPart =
  { kind: 'text'; text: string } | { kind: 'vendor'; name: string; email: string };

export type { HistoryContext };

/**
 * What happened, in one sentence, as parts: who did it, and a vendor as a part of their own, so
 * the screen draws them as a link to their drawer. The context names the vendors, the table's
 * rows, the market's path and the vendor whose own history this is.
 */
export function entryParts(
  entry: MarketHistoryEntry,
  given: HistoryContext = {},
): MarketHistoryPart[] {
  const context = readerContext(given);
  for (const reader of readersOf(entry)) {
    if (reader.parts) return reader.parts(entry, context);
  }
  const { labels } = context;
  const { actor, text, vendor } = sentence(entry, context);
  const parts: MarketHistoryPart[] = [
    actor,
    // A row this market's table no longer names reads as a change, never as its raw id.
    text(labels[entry.action] ? `made a change: ${labels[entry.action]}` : 'made a change'),
  ];
  if (entry.vendors.length) parts.push(text(', about '), vendor);
  return parts;
}

/** When it happened, as a moment, in the reader's own timezone. */
export function entryWhen(entry: MarketHistoryEntry): string {
  return getFormattedTimestamp(entry.at) || entry.at;
}

/**
 * The market day an entry is about, for a list the day leads (`dayLeads`). A run and the rules are
 * about no one day.
 */
export function entryDay(entry: MarketHistoryEntry): string {
  return day(entry.subject.date) || 'Every market day';
}

export { fieldName, fieldValue, valueText };

/** A field the change set, as it was and as it is. */
export interface ChangedField {
  field: string;
  before: string;
  after: string;
  /** Its lines hang: each one's wrap is indented under it (a price group's conditions). */
  hanging?: boolean;
}

/** Something else the entry recorded about the change: a count, a date, where it was made. */
export interface RecordedField {
  field: string;
  value: string;
}

/**
 * What an entry opens to: the fields the change set, before and after, and whatever else it
 * recorded. An assignment's table is its before and after: the table left, when the entry knows
 * it, and the table taken. A reset of a whole table, a market's or an organization's default, and a
 * market's copy of its organization's default are each row they changed, by its label in the
 * context's `labels`, and a phase reads as the market's `path` names it. A deal is each vendor's
 * reviewer, or the `own` vendor's alone in their own history.
 */
export function entryChanges(entry: MarketHistoryEntry, given: HistoryContext = {}): EntryChanges {
  const context = readerContext(given);
  for (const reader of readersOf(entry)) {
    const changes = reader.changes?.(entry, context);
    if (changes) return changes;
  }
  const { path } = context;
  const detail = asDetail(entry.detail);
  const changes =
    detail.before && detail.after && typeof detail.after === 'object'
      ? { before: asDetail(detail.before), after: asDetail(detail.after) }
      : null;
  const changed = changes ? changedFields(changes.before, changes.after, path) : [];
  return { changed, recorded: recordedFields(entry, detail, path, !!changes) };
}

/**
 * The one value column an entry's before and after needs, when every Before is "none" - an
 * application arriving, a vendor added - so the value reads across the width a second column of
 * "none" took: "Answer" for an applicant's own answers (their submission or edit), "After" for
 * anything else, an arrival's deal under the applicant's action included. Null when any
 * Before carries a value, or nothing changed.
 */
export function soleColumn(
  entry: MarketHistoryEntry,
  changed: readonly ChangedField[],
): string | null {
  if (!changed.length || changed.some((row) => row.before !== 'none')) return null;
  return entry.action === 'apply' && (entry.kind === 'submitted' || entry.kind === 'edited')
    ? 'Answer'
    : 'After';
}

/** The instant a day starts in the reader's timezone, as the history's `since` reads it. */
export function dayStarts(isoDay: string): string {
  return new Date(`${isoDay}T00:00:00`).toISOString();
}

/** The instant the day after `isoDay` starts, so a range "to" a day keeps all of it. */
export function dayEnds(isoDay: string): string {
  const next = new Date(`${isoDay}T00:00:00`);
  next.setDate(next.getDate() + 1);
  return next.toISOString();
}
