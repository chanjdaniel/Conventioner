/**
 * What a placement would change about the vendor's own answer, said before it is made.
 *
 * A table holds two seats, so moving a half-table vendor into a whole table changes the answer
 * they gave. The product does not quietly rewrite an applicant's answer to match what an
 * organizer did (`E11/F03/S01`).
 */
import { describe, expect, it } from 'vitest';
import {
  FULL_TABLE,
  HALF_TABLE_LEFT,
  HALF_TABLE_RIGHT,
  placementWarnings,
  seatIsWholeTable,
  seatLabel,
  type PlaceableVendor,
} from '@/utils/placementChange';

const DATE = '2026-08-01';

function vendor(overrides: Partial<PlaceableVendor> = {}): PlaceableVendor {
  return {
    email: 'nadia@ember.test',
    tableChoice: 'full',
    availableDates: [DATE],
    ...overrides,
  };
}

describe('a placement that alters what the vendor asked for', () => {
  it('says so when a whole-table vendor is given half of one', () => {
    const warnings = placementWarnings(vendor({ tableChoice: 'full' }), DATE, HALF_TABLE_LEFT);

    expect(warnings).toEqual(['They asked for a whole table. This gives them half of one.']);
  });

  it('says so when a sharing vendor is given a whole table', () => {
    const warnings = placementWarnings(vendor({ tableChoice: 'half' }), DATE, FULL_TABLE);

    expect(warnings).toEqual(['They asked to share a table. This gives them a whole one.']);
  });

  it('says nothing when the vendor said either is fine', () => {
    expect(placementWarnings(vendor({ tableChoice: 'either' }), DATE, FULL_TABLE)).toEqual([]);
    expect(placementWarnings(vendor({ tableChoice: 'either' }), DATE, HALF_TABLE_RIGHT)).toEqual(
      [],
    );
  });

  it('says nothing when the placement matches the answer', () => {
    expect(placementWarnings(vendor({ tableChoice: 'full' }), DATE, FULL_TABLE)).toEqual([]);
  });

  it('warns about a date they did not offer', () => {
    const warnings = placementWarnings(vendor({ availableDates: [] }), DATE, FULL_TABLE);

    expect(warnings).toContain('They did not say they were available on this date.');
  });

  it('reports every contradiction, not just the first', () => {
    const warnings = placementWarnings(
      vendor({ tableChoice: 'half', availableDates: [] }),
      DATE,
      FULL_TABLE,
    );

    expect(warnings).toHaveLength(2);
  });

  it('warns about nothing for a vendor with no application to contradict', () => {
    expect(placementWarnings(undefined, DATE, FULL_TABLE)).toEqual([]);
  });
});

describe('a seat names a side', () => {
  it('knows which seats are a whole table', () => {
    expect(seatIsWholeTable(FULL_TABLE)).toBe(true);
    expect(seatIsWholeTable(HALF_TABLE_LEFT)).toBe(false);
    expect(seatIsWholeTable(HALF_TABLE_RIGHT)).toBe(false);
  });

  it('reads as a place at a table rather than a stored spelling', () => {
    expect(seatLabel(FULL_TABLE)).toBe('The whole table');
    expect(seatLabel(HALF_TABLE_LEFT)).toBe('The left half');
    expect(seatLabel(HALF_TABLE_RIGHT)).toBe('The right half');
  });
});
