/**
 * The Assignment group's words: a placement and the rules.
 *
 * Reads:
 * - `assign/<kind>` for each kind of `PLACEMENT_WORDS`, its sentence
 * - `assign/placed`, its rows
 * - `assign/rules`
 *
 * `assign/owed_taken_back` is Payments'.
 *
 * A placement that differs from what the solver produced is a fact someone will later ask about,
 * and a flag saying "hand-placed" cannot answer it (`E11/F04/S01`), so each change is said in full.
 */
import type { MarketHistoryEntry, MarketHistoryPart } from '@/utils/marketHistory';
import {
  asDetail,
  day,
  plural,
  sentence,
  str,
  type HistoryReaders,
  type ReaderContext,
} from './shared';

function table(value: unknown): string {
  const at = asDetail(value);
  const code = str(at.table_code);
  return at.table_choice ? `${code} (${str(at.table_choice)})` : code;
}

/**
 * What each placement kind says after who made it, read from the stored detail. A vendor is a part
 * of their own, so the entry draws their email beside their name: two vendors can share a name, and
 * the address is what tells them apart (E35/F03/S03).
 *
 * A new kind is one entry here: its reader and `isPlacementKind` follow from this table.
 */
const PLACEMENT_WORDS: Readonly<
  Record<string, (entry: MarketHistoryEntry, context: ReaderContext) => MarketHistoryPart[]>
> = {
  placed(entry, context) {
    const { before, detail, text, vendor } = sentence(entry, context);
    // A vendor who had a table that day was moved, and the table left says from where.
    return before.table_code
      ? [text('moved '), vendor, text(` from ${str(before.table_code)} to ${table(detail)}`)]
      : [text('assigned '), vendor, text(` at ${table(detail)}`)];
  },
  freed(entry, context) {
    const { detail, text, vendor } = sentence(entry, context);
    return [text(`freed ${str(detail.table_code)}, leaving `), vendor, text(' with no table')];
  },
  swapped(entry, context) {
    const { detail, text, who } = sentence(entry, context);
    const [first, second] = Array.isArray(detail.seats) ? detail.seats.map(asDetail) : [];
    if (!first || !second) {
      const [a, b] = entry.vendors;
      return b ? [text('swapped '), who(a), text(' and '), who(b)] : [text('swapped '), who(a)];
    }
    return [
      text('swapped '),
      who(first.email),
      text(' and '),
      who(second.email),
      text(` - now at ${str(first.table_code)} and ${str(second.table_code)}`),
    ];
  },
  // One sentence naming what a run touched rather than one per placement: one entry per placement
  // would drown the hand edits under machine rows, and the hand edits are what anyone reads.
  assigned(entry, context) {
    const { detail, text } = sentence(entry, context);
    const written = Number(detail.placements_written) || 0;
    const pins = Number(detail.pins_preserved) || 0;
    return [
      text(
        `allocated tables: ${plural(written, 'assignment', 'assignments')} written` +
          (pins ? `, ${plural(pins, 'pin', 'pins')} preserved` : ''),
      ),
    ];
  },
};

/** The kinds of `assign` that are a placement's, each with its own `assign/<kind>` reader. */
export const PLACEMENT_KINDS: readonly string[] = Object.keys(PLACEMENT_WORDS);

/** Whether a history entry's kind is a placement's, so it reads in this file's words. */
export function isPlacementKind(kind: string | null): boolean {
  return kind !== null && PLACEMENT_KINDS.includes(kind);
}

/** A placement's sentence: who made it, what its kind says, and the day it is for after them. */
function placement(entry: MarketHistoryEntry, context: ReaderContext): MarketHistoryPart[] {
  const { actor, detail, onDay, text } = sentence(entry, context);
  const on = onDay(detail.date);
  return [
    actor,
    ...PLACEMENT_WORDS[entry.kind as string](entry, context),
    ...(on ? [text(on)] : []),
  ];
}

export const readers: HistoryReaders = {
  ...Object.fromEntries(PLACEMENT_KINDS.map((kind) => [`assign/${kind}`, { parts: placement }])),
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
  'assign/rules': {
    parts(entry, context) {
      const { actor, text } = sentence(entry, context);
      return [actor, text('changed the assignment rules')];
    },
  },
};
