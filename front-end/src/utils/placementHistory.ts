/**
 * Who changed a placement, to what, and when - as a person reads it.
 *
 * The back end stores entries structured and names each kind with an enum
 * (`back-end/placement_history.py`); the wording is here, because a sentence should be
 * changeable without a migration or a back-end release. The same rule `placementReason.ts`
 * follows.
 *
 * A placement that differs from what the solver produced is a fact someone will later ask about,
 * and a flag saying "hand-placed" cannot answer it (`E11/F04/S01`).
 */
import { getFormattedTimestamp, getShortDate } from '@/utils/utils';
import { vendorName, type VendorNames } from '@/utils/vendorIdentity';

/** Mirrors the kinds in `back-end/placement_history.py`. */
export type PlacementHistoryKind = 'placed' | 'freed' | 'swapped' | 'assigned';

export interface PlacementHistoryEntry {
  id: string;
  actor: string;
  at: string;
  kind: PlacementHistoryKind;
  vendors: string[];
  detail: {
    date?: string;
    tableCode?: string;
    tableChoice?: string;
    seats?: Array<{ email: string; tableCode: string }>;
    placementsWritten?: number;
    pinsPreserved?: number;
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** One piece of an entry's line: words, or a vendor, drawn as their name with their email beside. */
export type HistoryPart =
  { kind: 'text'; text: string } | { kind: 'vendor'; name: string; email: string };

/**
 * What happened, in one line, as parts (E35/F03/S03): a vendor is a part of its own, so the trail
 * draws their email beside their name - two vendors can share a name, and the address is what tells
 * them apart. A vendor with no name is their email alone, never the email twice.
 *
 * A solver run is one line naming what it touched rather than one line per placement: one entry
 * per placement would drown the hand edits under machine rows, and the hand edits are the
 * entries anyone actually reads.
 */
export function historyParts(entry: PlacementHistoryEntry, names: VendorNames): HistoryPart[] {
  const text = (words: string): HistoryPart => ({ kind: 'text', text: words });
  const who = (email: string): HistoryPart => ({
    kind: 'vendor',
    name: vendorName(email, names),
    email: String(email ?? '').trim(),
  });
  const detail = entry.detail ?? {};

  switch (entry.kind) {
    case 'placed':
      return [
        text('Assigned '),
        who(entry.vendors[0]),
        text(` at ${detail.tableCode} (${detail.tableChoice})`),
      ];
    case 'freed':
      return [
        text(`Freed ${detail.tableCode}, leaving `),
        who(entry.vendors[0]),
        text(' with no table'),
      ];
    case 'swapped': {
      const [first, second] = detail.seats ?? [];
      if (!first || !second) {
        const [a, b] = entry.vendors;
        return b ? [text('Swapped '), who(a), text(' and '), who(b)] : [text('Swapped '), who(a)];
      }
      return [
        text('Swapped '),
        who(first.email),
        text(' and '),
        who(second.email),
        text(` - now at ${first.tableCode} and ${second.tableCode}`),
      ];
    }
    case 'assigned':
      return [
        text(
          `Allocated tables: ${plural(detail.placementsWritten ?? 0, 'assignment', 'assignments')} written` +
            (detail.pinsPreserved
              ? `, ${plural(detail.pinsPreserved, 'pin', 'pins')} preserved`
              : ''),
        ),
      ];
    default:
      return [text('Changed an assignment')];
  }
}

/** The same line as plain text: a vendor reads "Name (email)", or their email alone. */
export function historySummary(entry: PlacementHistoryEntry, names: VendorNames): string {
  return historyParts(entry, names)
    .map((part) => {
      if (part.kind === 'text') return part.text;
      return part.name ? `${part.name} (${part.email})` : part.email;
    })
    .join('');
}

/**
 * The market date an entry is about, when it is about one. A solver run is about all of them.
 *
 * Formatted as a calendar day, like every other market date in the product: a stored
 * `YYYY-MM-DD` on screen is a second date format, and there is one (`E09/F04/S02`).
 */
export function historyDate(entry: PlacementHistoryEntry): string | null {
  const date = entry.detail?.date;
  return date ? getShortDate(date) : null;
}

/** When it happened, as a moment - an instant, so it reads in the viewer's own timezone. */
export function historyWhen(entry: PlacementHistoryEntry): string {
  return getFormattedTimestamp(entry.at) || entry.at;
}
