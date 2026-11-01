/**
 * The Assignment group's words: a placement, in the placement trail's own words, and the rules.
 *
 * Reads:
 * - `assign/placed`, its sentence and its rows
 * - `assign/freed`
 * - `assign/swapped`
 * - `assign/assigned`
 * - `assign/rules`
 *
 * `assign/owed_taken_back` is Payments'.
 */
import type { MarketHistoryEntry, MarketHistoryPart } from '@/utils/marketHistory';
import {
  historyDate,
  historyParts,
  type PlacementHistoryEntry,
  type PlacementHistoryKind,
} from '@/utils/placementHistory';
import type { VendorNames } from '@/utils/vendorIdentity';
import { asDetail, day, sentence, str, type HistoryContext, type HistoryReaders } from './shared';

function table(value: unknown): string {
  const at = asDetail(value);
  const code = str(at.table_code);
  return at.table_choice ? `${code} (${str(at.table_choice)})` : code;
}

/**
 * A placement in the placement trail's own words (`historyParts`), its first letter lowered to
 * follow who made it, and the day it is for after it, where the trail shows that day beside the
 * line. One wording for every screen, so they cannot drift; a move names the table left and the
 * table taken.
 */
function placementParts(
  entry: MarketHistoryEntry,
  kind: PlacementHistoryKind,
  names: VendorNames,
): MarketHistoryPart[] {
  const detail = asDetail(entry.detail);
  const trail: PlacementHistoryEntry = {
    id: entry.id,
    actor: str(entry.actor),
    at: entry.at,
    kind,
    vendors: entry.vendors,
    // The trail's detail as the placement history serves it, recased.
    detail: {
      date: detail.date ? str(detail.date) : undefined,
      tableCode: detail.table_code as string | undefined,
      tableChoice: detail.table_choice as string | undefined,
      before:
        detail.before && typeof detail.before === 'object'
          ? {
              tableCode: str(asDetail(detail.before).table_code),
              tableChoice: asDetail(detail.before).table_choice as string | null | undefined,
            }
          : null,
      seats: Array.isArray(detail.seats)
        ? detail.seats.map(asDetail).map((seat) => ({
            email: str(seat.email),
            tableCode: str(seat.table_code),
          }))
        : undefined,
      placementsWritten: detail.placements_written as number | undefined,
      pinsPreserved: detail.pins_preserved as number | undefined,
    },
  };
  const [first, ...rest] = historyParts(trail, names);
  const opening =
    first?.kind === 'text'
      ? { kind: 'text' as const, text: first.text.charAt(0).toLowerCase() + first.text.slice(1) }
      : first;
  const date = historyDate(trail);
  return [
    ...(opening ? [opening] : []),
    ...rest,
    ...(date ? [{ kind: 'text' as const, text: ` on ${date}` }] : []),
  ];
}

/** A placement's sentence: who made it, then the trail's words. Its key names a placement kind. */
function placement(entry: MarketHistoryEntry, context: HistoryContext): MarketHistoryPart[] {
  const { actor } = sentence(entry, context);
  return [actor, ...placementParts(entry, entry.kind as PlacementHistoryKind, context.names)];
}

export const readers: HistoryReaders = {
  'assign/placed': {
    parts: placement,
    changes(entry) {
      const detail = asDetail(entry.detail);
      const left = 'before' in detail ? (detail.before ? table(detail.before) : 'none') : 'unknown';
      return {
        changed: [{ field: 'Table', before: left, after: table(detail) }],
        recorded: detail.date ? [{ field: 'Date', value: day(detail.date) }] : [],
      };
    },
  },
  'assign/freed': { parts: placement },
  'assign/swapped': { parts: placement },
  'assign/assigned': { parts: placement },
  'assign/rules': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [actor, text('changed the assignment rules')];
    },
  },
};
