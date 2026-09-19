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
import { vendorHeadline, type VendorNames } from '@/utils/vendorIdentity';

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

/**
 * What happened, in one line.
 *
 * A solver run is one line naming what it touched rather than one line per placement: one entry
 * per placement would drown the hand edits under machine rows, and the hand edits are the
 * entries anyone actually reads.
 */
export function historySummary(entry: PlacementHistoryEntry, names: VendorNames): string {
  const who = (email: string) => vendorHeadline(email, names);
  const detail = entry.detail ?? {};

  switch (entry.kind) {
    case 'placed':
      return `Placed ${who(entry.vendors[0])} at ${detail.tableCode} (${detail.tableChoice})`;
    case 'freed':
      return `Freed ${detail.tableCode}, leaving ${who(entry.vendors[0])} with no table`;
    case 'swapped': {
      const [first, second] = detail.seats ?? [];
      if (!first || !second) return `Swapped ${entry.vendors.map(who).join(' and ')}`;
      return `Swapped ${who(first.email)} and ${who(second.email)} - now at ${first.tableCode} and ${second.tableCode}`;
    }
    case 'assigned':
      return (
        `Ran the assignment: ${plural(detail.placementsWritten ?? 0, 'placement', 'placements')} written` +
        (detail.pinsPreserved ? `, ${plural(detail.pinsPreserved, 'pin', 'pins')} preserved` : '')
      );
    default:
      return 'Changed a placement';
  }
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
