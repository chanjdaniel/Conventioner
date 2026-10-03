/**
 * What a placement would change about the vendor's own answer, said before it is made.
 *
 * A table holds two seats, so moving a half-table vendor into a whole table changes the answer
 * they gave. The product does not quietly rewrite an applicant's answer to match what an
 * organizer did (`E11/F03/S01`). Tier sets the price, and a vendor's own limit and the market's
 * ceiling are promises too, so each is said as well (bugs 18 and 32, E26/F05/S03).
 */
import { describe, expect, it } from 'vitest';
import {
  FULL_TABLE,
  HALF_TABLE_LEFT,
  HALF_TABLE_RIGHT,
  groupCandidates,
  placementWarnings,
  seatIsWholeTable,
  seatLabel,
  seatWarnings,
  type PlaceableVendor,
  type PlacementContext,
} from '@/utils/placementChange';

const DATE = '2026-08-01';
const OTHER_DATE = '2026-08-02';

function vendor(overrides: Partial<PlaceableVendor> = {}): PlaceableVendor {
  return {
    email: 'nadia@ember.test',
    tableChoice: 'full',
    availableDates: [DATE],
    acceptedTiersByDate: {},
    maxDates: null,
    ...overrides,
  };
}

function at(overrides: Partial<PlacementContext> = {}): PlacementContext {
  return {
    date: DATE,
    tier: 'Gold',
    seat: FULL_TABLE,
    datesHeld: [],
    marketCeiling: null,
    ...overrides,
  };
}

describe('a placement that alters what the vendor asked for', () => {
  it('says so when a whole-table vendor is given half of one', () => {
    const warnings = placementWarnings(
      vendor({ tableChoice: 'full' }),
      at({ seat: HALF_TABLE_LEFT }),
    );

    expect(warnings).toEqual(['They asked for a whole table. This gives them half of one.']);
  });

  it('says so when a sharing vendor is given a whole table', () => {
    const warnings = placementWarnings(vendor({ tableChoice: 'half' }), at({ seat: FULL_TABLE }));

    expect(warnings).toEqual(['They asked to share a table. This gives them a whole one.']);
  });

  it('says nothing when the vendor said either is fine', () => {
    expect(placementWarnings(vendor({ tableChoice: 'either' }), at())).toEqual([]);
    expect(
      placementWarnings(vendor({ tableChoice: 'either' }), at({ seat: HALF_TABLE_RIGHT })),
    ).toEqual([]);
  });

  it('says nothing when the placement matches the answer', () => {
    expect(placementWarnings(vendor({ tableChoice: 'full' }), at())).toEqual([]);
  });

  it('warns about a date they did not offer', () => {
    const warnings = placementWarnings(vendor({ availableDates: [] }), at());

    expect(warnings).toContain('They did not say they were available on this date.');
  });

  it('reports every contradiction, not just the first', () => {
    const warnings = placementWarnings(vendor({ tableChoice: 'half', availableDates: [] }), at());

    expect(warnings).toHaveLength(2);
  });

  it('warns about nothing for a vendor with no application to contradict', () => {
    expect(placementWarnings(undefined, at())).toEqual([]);
  });
});

describe('a placement in a tier they did not accept', () => {
  const goldOnly = vendor({ acceptedTiersByDate: { [DATE]: ['Gold'] } });

  it('says so, because the tier sets their price', () => {
    expect(placementWarnings(goldOnly, at({ tier: 'Silver' }))).toEqual([
      'They did not accept the Silver tier on this date, which sets their price.',
    ]);
  });

  it('says nothing in a tier they accepted', () => {
    expect(placementWarnings(goldOnly, at({ tier: 'Gold' }))).toEqual([]);
  });

  it('reads the tiers of the date being placed, not another date', () => {
    const silverOnTheSecondDay = vendor({
      availableDates: [DATE, OTHER_DATE],
      acceptedTiersByDate: { [DATE]: ['Gold'], [OTHER_DATE]: ['Silver'] },
    });

    expect(
      placementWarnings(silverOnTheSecondDay, at({ date: OTHER_DATE, tier: 'Silver' })),
    ).toEqual([]);
    expect(placementWarnings(silverOnTheSecondDay, at({ tier: 'Silver' }))).toHaveLength(1);
  });

  it('says nothing when the market never asked about tiers', () => {
    expect(placementWarnings(vendor({ acceptedTiersByDate: {} }), at({ tier: 'Silver' }))).toEqual(
      [],
    );
  });

  it('says nothing at a table with no tier', () => {
    expect(placementWarnings(goldOnly, at({ tier: '' }))).toEqual([]);
  });

  it('says only the date on a date they never offered, which carries no tier answer', () => {
    const warnings = placementWarnings(goldOnly, at({ date: OTHER_DATE, tier: 'Silver' }));

    expect(warnings).toEqual(['They did not say they were available on this date.']);
  });
});

describe('a placement past a ceiling on dates', () => {
  it('says so when it passes their own limit', () => {
    const warnings = placementWarnings(vendor({ maxDates: 1 }), at({ datesHeld: [OTHER_DATE] }));

    expect(warnings).toEqual(['This gives them 2 dates; they asked for at most 1.']);
  });

  it("says so when it passes the market's ceiling", () => {
    const warnings = placementWarnings(vendor(), at({ datesHeld: [OTHER_DATE], marketCeiling: 1 }));

    expect(warnings).toEqual(['This gives them 2 dates; the market allows at most 1 per vendor.']);
  });

  it('says each ceiling it passes, because they are separate promises', () => {
    const warnings = placementWarnings(
      vendor({ maxDates: 1 }),
      at({ datesHeld: [OTHER_DATE], marketCeiling: 1 }),
    );

    expect(warnings).toHaveLength(2);
  });

  it('says nothing up to the limit', () => {
    expect(
      placementWarnings(vendor({ maxDates: 2 }), at({ datesHeld: [OTHER_DATE], marketCeiling: 2 })),
    ).toEqual([]);
  });

  it('says nothing when neither the vendor nor the market set a limit', () => {
    expect(placementWarnings(vendor(), at({ datesHeld: ['a', 'b', 'c'] }))).toEqual([]);
  });
});

describe('what a seat itself overrides, which is all a swap can cross', () => {
  it('names the tier and the size, and never the date or the count', () => {
    const warnings = seatWarnings(
      vendor({ availableDates: [], maxDates: 0, acceptedTiersByDate: { [DATE]: ['Gold'] } }),
      DATE,
      'Silver',
      HALF_TABLE_LEFT,
    );

    expect(warnings).toEqual(['They asked for a whole table. This gives them half of one.']);
  });

  it('warns about the tier on a date they offered', () => {
    const warnings = seatWarnings(
      vendor({ acceptedTiersByDate: { [DATE]: ['Gold'] } }),
      DATE,
      'Silver',
      FULL_TABLE,
    );

    expect(warnings).toEqual([
      'They did not accept the Silver tier on this date, which sets their price.',
    ]);
  });
});

describe('who the place dialog offers', () => {
  const fits = vendor({ email: 'fits@ember.test', tableChoice: 'either' });
  const refusedTier = vendor({
    email: 'gold@ember.test',
    acceptedTiersByDate: { [DATE]: ['Gold'] },
  });
  const away = vendor({ email: 'away@ember.test', availableDates: [] });
  const atLimit = vendor({ email: 'limit@ember.test', maxDates: 1 });
  const held: Record<string, string[]> = { 'limit@ember.test': [OTHER_DATE] };

  it('puts first who this seat fits, and keeps everyone else one pick away', () => {
    const groups = groupCandidates(
      [away, fits, refusedTier, atLimit],
      { date: DATE, tier: 'Silver', seat: FULL_TABLE, marketCeiling: null },
      (email) => held[email] ?? [],
    );

    expect(groups.fits.map((v) => v.email)).toEqual(['fits@ember.test']);
    expect(groups.overrides.map((v) => v.email)).toEqual([
      'away@ember.test',
      'gold@ember.test',
      'limit@ember.test',
    ]);
  });

  it('counts a sharing vendor as fitting a free table, since they can be given half', () => {
    const sharing = vendor({ email: 'share@ember.test', tableChoice: 'half' });

    const free = groupCandidates(
      [sharing],
      { date: DATE, tier: 'Gold', seat: null, marketCeiling: null },
      () => [],
    );
    const wholeOnly = groupCandidates(
      [sharing],
      { date: DATE, tier: 'Gold', seat: FULL_TABLE, marketCeiling: null },
      () => [],
    );

    expect(free.fits).toHaveLength(1);
    expect(wholeOnly.overrides).toHaveLength(1);
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
