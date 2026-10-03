/**
 * What a placement about to be made would change about the vendor's own answer.
 *
 * Said before the change, not after it. A table holds two seats, so moving a half-table vendor
 * into a whole table - or a whole-table vendor into half of one - changes the answer they gave,
 * and the product does not quietly rewrite an applicant's answer to match what an organizer did.
 * The marking on the vendor's card (`E11/F02/S02`) reports it afterwards; this is the sentence
 * that appears at the moment it happens.
 */

/** The three seats a table holds. Mirrors `api/placements.py`. */
export const FULL_TABLE = 'Full Table';
export const HALF_TABLE_LEFT = 'Half Table (Left)';
export const HALF_TABLE_RIGHT = 'Half Table (Right)';

export type Seat = typeof FULL_TABLE | typeof HALF_TABLE_LEFT | typeof HALF_TABLE_RIGHT;

/** One vendor who could be placed, as `GET /markets/{id}/tables` reports them. */
export interface PlaceableVendor {
  email: string;
  /** Their own answer: `full`, `half` or `either`. */
  tableChoice: string;
  availableDates: string[];
  /**
   * The tiers they accept on each date. Empty when the market never asked, which accepts every
   * tier - the same reading as `SolverVendor.accepts_tier_on` on the server.
   */
  acceptedTiersByDate: Record<string, string[]>;
  /** How many dates they want at most; null for no personal limit. */
  maxDates: number | null;
}

/** Where a placement would put a vendor, and what they hold already. */
export interface PlacementContext {
  date: string;
  /** The table's tier; empty when the market has no tiers. */
  tier: string;
  seat: Seat;
  /** The dates the vendor holds a seat on before this change. */
  datesHeld: readonly string[];
  /** The organizer's ceiling on dates per vendor; null when they set none. */
  marketCeiling: number | null;
}

export function seatIsWholeTable(seat: string): boolean {
  return !seat.toLowerCase().includes('half');
}

export function seatLabel(seat: Seat): string {
  if (seat === FULL_TABLE) return 'The whole table';
  return seat === HALF_TABLE_LEFT ? 'The left half' : 'The right half';
}

/**
 * Does this vendor accept that tier on that date? Mirrors `SolverVendor.accepts_tier_on`.
 *
 * A table with no tier constrains nothing, and a vendor never asked accepts every tier.
 */
export function acceptsTierOn(vendor: PlaceableVendor, date: string, tier: string): boolean {
  if (!tier || Object.keys(vendor.acceptedTiersByDate).length === 0) return true;
  return (vendor.acceptedTiersByDate[date] ?? []).includes(tier);
}

/**
 * What the seat itself would override: the tier it is priced at, and its size.
 *
 * This is everything a swap can cross. A swap trades two tables on one date, so it never changes
 * whether a vendor is there that day or how many dates they hold - only which table they stand at.
 *
 * Tier is answered per date, so a date they never offered carries no tier answer to contradict;
 * the thing to say about that placement is the date. Mirrors `placement_reasons._overrides_of`.
 */
export function seatWarnings(
  vendor: PlaceableVendor | undefined,
  date: string,
  tier: string,
  seat: Seat,
): string[] {
  if (!vendor) return [];
  const warnings: string[] = [];

  if (vendor.availableDates.includes(date) && !acceptsTierOn(vendor, date, tier)) {
    warnings.push(`They did not accept the ${tier} tier on this date, which sets their price.`);
  }

  const whole = seatIsWholeTable(seat);
  if (vendor.tableChoice === 'full' && !whole) {
    warnings.push('They asked for a whole table. This gives them half of one.');
  } else if (vendor.tableChoice === 'half' && whole) {
    warnings.push('They asked to share a table. This gives them a whole one.');
  }

  return warnings;
}

/**
 * Every way placing this vendor here would differ from what they asked for, in words.
 *
 * "Either is fine" is satisfied by both shapes, so it is never a change. An unknown vendor - one
 * with no application to contradict - warns about nothing, because there is no answer to override.
 *
 * The two ceilings are separate sentences because they are separate promises: the vendor's own
 * answer, and the organizer's rule for everyone. The solver honours both; a hand placement may
 * cross either (admins edit without restriction), but never without a word.
 */
export function placementWarnings(
  vendor: PlaceableVendor | undefined,
  placement: PlacementContext,
): string[] {
  if (!vendor) return [];
  const { date, tier, seat, datesHeld, marketCeiling } = placement;
  const warnings: string[] = [];

  if (!vendor.availableDates.includes(date)) {
    warnings.push('They did not say they were available on this date.');
  }

  warnings.push(...seatWarnings(vendor, date, tier, seat));

  const dates = new Set([...datesHeld, date]).size;
  const gives = `This gives them ${dates} ${dates === 1 ? 'date' : 'dates'}`;
  if (vendor.maxDates !== null && dates > vendor.maxDates) {
    warnings.push(`${gives}; they asked for at most ${vendor.maxDates}.`);
  }
  if (marketCeiling !== null && dates > marketCeiling) {
    warnings.push(`${gives}; the market allows at most ${marketCeiling} per vendor.`);
  }

  return warnings;
}

/** The place dialog's candidates, split by whether this seat overrides anything they answered. */
export interface CandidateGroups {
  fits: PlaceableVendor[];
  overrides: PlaceableVendor[];
}

/**
 * Who this seat fits as they answered, and who it would override (claims-and-room 05).
 *
 * Grouped, never filtered: an override is a decision the organizer is allowed to make, so the
 * vendor it would override stays one pick away - just not mixed in with the ones it would not.
 * `seat` is null when the whole table is free and the seat is still a choice; a vendor then fits
 * if the seat they asked for would, because the organizer can give a sharing vendor half of it.
 */
export function groupCandidates(
  vendors: readonly PlaceableVendor[],
  place: Omit<PlacementContext, 'seat' | 'datesHeld'> & { seat: Seat | null },
  datesHeldBy: (email: string) => readonly string[],
): CandidateGroups {
  const groups: CandidateGroups = { fits: [], overrides: [] };
  for (const vendor of vendors) {
    const warnings = placementWarnings(vendor, {
      ...place,
      seat: place.seat ?? (vendor.tableChoice === 'half' ? HALF_TABLE_LEFT : FULL_TABLE),
      datesHeld: datesHeldBy(vendor.email),
    });
    (warnings.length ? groups.overrides : groups.fits).push(vendor);
  }
  return groups;
}
