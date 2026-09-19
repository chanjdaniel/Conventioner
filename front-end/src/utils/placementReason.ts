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

/** Mirrors `PlacementOverride` in `back-end/placement_reasons.py`. */
export type PlacementOverride = 'tier' | 'date' | 'table_choice';

/** One hand placement that contradicts the vendor's answer, as the statistics report it. */
export interface OverriddenPlacement {
  email: string;
  date: string;
  tableCode: string;
  overrides: PlacementOverride[];
}

const OVERRIDE_WORDING: Record<PlacementOverride, string> = {
  // Named first and worded hardest: tier sets the price, so this one costs the vendor money.
  tier: 'a tier they did not accept, which sets their price',
  date: 'a date they did not offer',
  table_choice: 'a table size they did not ask for',
};

const OVERRIDE_ORDER: PlacementOverride[] = ['tier', 'date', 'table_choice'];

/**
 * What this placement overrides, in words.
 *
 * A pin that breaks a filter is legitimate - a sponsor, a late deal, an accessibility need - and
 * admins edit without restriction. It must never be silent, though, which is what this says.
 */
export function overrideText(overrides: readonly PlacementOverride[] | undefined): string {
  const named = OVERRIDE_ORDER.filter((o) => overrides?.includes(o)).map(
    (o) => OVERRIDE_WORDING[o],
  );
  if (named.length === 0) return '';
  return `Placed by hand against their answer: ${named.join('; ')}`;
}

/** Email and date to what that placement overrides, for a quick lookup per card. */
export function overrideIndex(
  overridden: readonly OverriddenPlacement[],
): Map<string, PlacementOverride[]> {
  const index = new Map<string, PlacementOverride[]>();
  for (const entry of overridden) {
    index.set(`${entry.email.trim().toLowerCase()}|${entry.date}`, entry.overrides ?? []);
  }
  return index;
}
