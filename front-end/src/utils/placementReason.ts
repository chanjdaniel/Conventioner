/**
 * Why a vendor has no table on a market date, as a person reads it.
 *
 * The back end computes the reason and names it with an enum; the wording is here, because a
 * sentence should be changeable without a migration or a back-end release
 * (`back-end/placement_reasons.py`).
 *
 * The finding: a walk produced five approved applications, three placed, nineteen of twenty-four
 * table-slots free and two vendors unplaced, with no explanation of the contradiction anywhere on
 * screen - both had asked for a tier the market has no sections at.
 */

/** Mirrors `PlacementReason` in `back-end/placement_reasons.py`. */
export type PlacementReason = 'not_available' | 'no_table_at_their_tier' | 'taken' | 'free';

/** One date a vendor holds no table on, as the statistics report it. */
export interface UnplacedDate {
  email: string;
  date: string;
  reason: PlacementReason;
}

const WORDING: Record<PlacementReason, string> = {
  not_available: 'Not available on this date',
  no_table_at_their_tier: 'No table at a tier they accept',
  taken: 'Every table they accept is taken',
  free: 'A table is free - they could be placed',
};

/** The reason in words. An unrecognized one reads as the plain fact, never as punctuation. */
export function placementReasonText(reason: PlacementReason | undefined): string {
  if (!reason) return 'Not placed';
  return WORDING[reason] ?? 'Not placed';
}

/**
 * Is this reason something the organizer can act on right now?
 *
 * Only `free` is: a table they would accept is open, so the Tables view can place them. The other
 * three are reports - the answer is elsewhere, in the plan or in the vendor's own answers.
 */
export function reasonIsActionable(reason: PlacementReason | undefined): boolean {
  return reason === 'free';
}

/** Email and date to the reason there is no table, for a quick lookup per card. */
export function reasonIndex(unplaced: readonly UnplacedDate[]): Map<string, PlacementReason> {
  const index = new Map<string, PlacementReason>();
  for (const entry of unplaced) {
    index.set(`${entry.email.trim().toLowerCase()}|${entry.date}`, entry.reason);
  }
  return index;
}
