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
}

export function seatIsWholeTable(seat: string): boolean {
  return !seat.toLowerCase().includes('half');
}

export function seatLabel(seat: Seat): string {
  if (seat === FULL_TABLE) return 'The whole table';
  return seat === HALF_TABLE_LEFT ? 'The left half' : 'The right half';
}

/**
 * Every way this placement would differ from what the vendor asked for, in words.
 *
 * "Either is fine" is satisfied by both shapes, so it is never a change. An unknown vendor - one
 * with no application to contradict - warns about nothing, because there is no answer to override.
 */
export function placementWarnings(
  vendor: PlaceableVendor | undefined,
  date: string,
  seat: Seat,
): string[] {
  if (!vendor) return [];
  const warnings: string[] = [];

  if (!vendor.availableDates.includes(date)) {
    warnings.push('They did not say they were available on this date.');
  }

  const whole = seatIsWholeTable(seat);
  if (vendor.tableChoice === 'full' && !whole) {
    warnings.push('They asked for a whole table. This gives them half of one.');
  } else if (vendor.tableChoice === 'half' && whole) {
    warnings.push('They asked to share a table. This gives them a whole one.');
  }

  return warnings;
}
