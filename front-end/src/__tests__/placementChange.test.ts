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
  emptySeatsOn,
  groupCandidates,
  placementWarnings,
  seatAMoveKeeps,
  seatIsWholeTable,
  seatLabel,
  seatWarnings,
  seatedOn,
  type PlaceableVendor,
  type PlacementContext,
} from '@/utils/placementChange';
import type { MarketTableRow } from '@/utils/resultFilters';

const DATE = '2026-08-01';
const OTHER_DATE = '2026-08-02';

function vendor(overrides: Partial<PlaceableVendor> = {}): PlaceableVendor {
  return {
    email: 'nadia@ember.test',
    tableChoice: 'full',
    availableDates: [DATE],
    acceptedTiersByDate: {},
    maxDates: null,
    notApproved: null,
    inTheRun: true,
    addedByHand: false,
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

describe('placing someone who is not approved (E36/F02/S02)', () => {
  const byAlex = vendor({
    email: 'dev@kiln.test',
    notApproved: {
      status: 'reviewer_rejected',
      verdictBy: { kind: 'person', userId: 'u-1', email: 'alex@market.test', rule: null },
      verdictAt: '2026-10-19T10:00:00',
      verdictReason: null,
    },
  });
  const byRule = vendor({
    email: 'ines@loom.test',
    notApproved: {
      status: 'reviewer_rejected',
      verdictBy: { kind: 'rule', userId: null, email: null, rule: 'Affiliation' },
      verdictAt: '2026-10-19T10:00:00',
      verdictReason: 'Not an Example College student, staff or alumnus',
    },
  });

  it('warns first that they are not approved, and who rejected them', () => {
    const [first] = placementWarnings(byAlex, at());

    expect(first).toMatch(/^Not approved: Rejected by alex@market\.test, /);
  });

  it("gives an automatic rejection's reason", () => {
    expect(placementWarnings(byRule, at())[0]).toBe(
      'Not approved: Rejected automatically: Not an Example College student, staff or alumnus.',
    );
  });

  it('says only the status when nobody is recorded as giving it', () => {
    const undated = vendor({
      notApproved: {
        status: 'reviewer_rejected',
        verdictBy: null,
        verdictAt: null,
        verdictReason: null,
      },
    });

    expect(placementWarnings(undated, at())[0]).toBe('Not approved: Rejected.');
  });

  it('keeps the usual warnings after it', () => {
    const halfOnly = vendor({ ...byAlex, tableChoice: 'half' });

    expect(placementWarnings(halfOnly, at())).toHaveLength(2);
  });

  it('lists them in their own group, whatever else they fit', () => {
    const approved = vendor({ email: 'fits@ember.test', tableChoice: 'either' });

    const groups = groupCandidates(
      [byAlex, approved, byRule],
      { date: DATE, tier: 'Gold', seat: FULL_TABLE, marketCeiling: null },
      () => [],
    );

    expect(groups.fits.map((v) => v.email)).toEqual(['fits@ember.test']);
    expect(groups.overrides).toEqual([]);
    expect(groups.notApproved.map((v) => v.email)).toEqual(['dev@kiln.test', 'ines@loom.test']);
  });
});

describe('placing a vendor added by hand (E36/F03/S01)', () => {
  const walkIn = vendor({
    email: 'walk.in@example.com',
    availableDates: [],
    tableChoice: '',
    inTheRun: false,
    addedByHand: true,
  });

  it('says nothing is known to check the seat against, not that they declined the date', () => {
    expect(placementWarnings(walkIn, at())).toEqual([
      'Added by hand: they gave no answers to check this seat against.',
    ]);
  });

  it("still says the market's ceiling, which is the organizer's rule for everyone", () => {
    const warnings = placementWarnings(walkIn, at({ datesHeld: [OTHER_DATE], marketCeiling: 1 }));

    expect(warnings).toContain('This gives them 2 dates; the market allows at most 1 per vendor.');
  });

  it('lists them in their own group', () => {
    const groups = groupCandidates(
      [walkIn],
      { date: DATE, tier: 'Gold', seat: FULL_TABLE, marketCeiling: null },
      () => [],
    );

    expect(groups.addedByHand.map((v) => v.email)).toEqual(['walk.in@example.com']);
    expect([...groups.fits, ...groups.overrides, ...groups.notApproved]).toEqual([]);
  });
});

describe("a day's seats, for a move (T208)", () => {
  /** A plan that ranks Gold before Silver, and Hall B before Hall A within neither. */
  const PLAN = {
    tiers: [{ name: 'Gold' }, { name: 'Silver' }],
    sections: [{ name: 'Hall B' }, { name: 'Hall A' }],
  };

  function table(
    tableCode: string,
    slots: (string | null)[],
    overrides: Partial<MarketTableRow> = {},
  ): MarketTableRow {
    return {
      date: DATE,
      assignment: slots.filter((slot): slot is string => !!slot),
      assignmentSlots: slots,
      location: 'Upper floor',
      section: 'Hall A',
      tableChoice: 'Half Table',
      tableCode,
      tier: 'Gold',
      ...overrides,
    };
  }

  describe('emptySeatsOn', () => {
    it('offers a wholly free table with no fixed seat, and a half-taken one by its free side', () => {
      const rows = [
        table('A 1', [null, null]),
        table('A 2', ['nadia@ember.test', null]),
        table('A 3', [null, 'lee@ember.test']),
      ];

      expect(emptySeatsOn(rows, DATE, PLAN, null)).toEqual([
        { tableCode: 'A 1', section: 'Hall A', location: 'Upper floor', tier: 'Gold', seat: null },
        {
          tableCode: 'A 2',
          section: 'Hall A',
          location: 'Upper floor',
          tier: 'Gold',
          seat: HALF_TABLE_RIGHT,
        },
        {
          tableCode: 'A 3',
          section: 'Hall A',
          location: 'Upper floor',
          tier: 'Gold',
          seat: HALF_TABLE_LEFT,
        },
      ]);
    });

    it('leaves out a table with both halves taken, and one held whole', () => {
      const rows = [
        table('A 1', ['nadia@ember.test', 'lee@ember.test']),
        table('A 2', ['sam@ember.test', 'sam@ember.test'], { tableChoice: 'Full Table' }),
        table('A 3', ['kim@ember.test', null], { tableChoice: 'Full Table' }),
      ];

      expect(emptySeatsOn(rows, DATE, PLAN, null)).toEqual([]);
    });

    it("leaves out the moving vendor's own table", () => {
      const rows = [table('A 1', ['nadia@ember.test', null]), table('A 2', [null, null])];

      expect(emptySeatsOn(rows, DATE, PLAN, 'A 1').map((seat) => seat.tableCode)).toEqual(['A 2']);
    });

    it('orders sections as the plan ranks them and tables by their number, as the grid does', () => {
      const rows = [
        table('S 1', [null, null], { section: 'Hall C', tier: 'Silver' }),
        table('A 10', [null, null]),
        table('A 2', [null, null]),
        table('B 1', [null, null], { section: 'Hall B' }),
      ];

      expect(emptySeatsOn(rows, DATE, PLAN, null).map((seat) => seat.tableCode)).toEqual([
        'B 1',
        'A 2',
        'A 10',
        'S 1',
      ]);
    });

    it('reads only the date asked about', () => {
      const rows = [table('A 1', [null, null], { date: OTHER_DATE }), table('A 2', [null, null])];

      expect(emptySeatsOn(rows, DATE, PLAN, null).map((seat) => seat.tableCode)).toEqual(['A 2']);
    });
  });

  describe('seatedOn', () => {
    it('names everyone seated that day once, with the seat they hold, in table order', () => {
      const rows = [
        table('A 2', ['nadia@ember.test', 'lee@ember.test']),
        table('A 1', ['sam@ember.test', 'sam@ember.test'], { tableChoice: 'Full Table' }),
        table('B 1', [null, 'kim@ember.test'], { section: 'Hall B' }),
        table('A 3', ['ola@ember.test', null], { date: OTHER_DATE }),
      ];

      expect(seatedOn(rows, DATE, PLAN)).toEqual([
        {
          email: 'kim@ember.test',
          tableCode: 'B 1',
          section: 'Hall B',
          tier: 'Gold',
          seat: HALF_TABLE_RIGHT,
        },
        {
          email: 'sam@ember.test',
          tableCode: 'A 1',
          section: 'Hall A',
          tier: 'Gold',
          seat: FULL_TABLE,
        },
        {
          email: 'nadia@ember.test',
          tableCode: 'A 2',
          section: 'Hall A',
          tier: 'Gold',
          seat: HALF_TABLE_LEFT,
        },
        {
          email: 'lee@ember.test',
          tableCode: 'A 2',
          section: 'Hall A',
          tier: 'Gold',
          seat: HALF_TABLE_RIGHT,
        },
      ]);
    });
  });

  describe('seatAMoveKeeps', () => {
    it('takes the free side when only one side is free', () => {
      expect(seatAMoveKeeps(FULL_TABLE, HALF_TABLE_RIGHT)).toBe(HALF_TABLE_RIGHT);
    });

    it('keeps a whole table whole when the whole table is free', () => {
      expect(seatAMoveKeeps(FULL_TABLE, null)).toBe(FULL_TABLE);
    });

    it('keeps a left half a half, on the left', () => {
      expect(seatAMoveKeeps(HALF_TABLE_LEFT, null)).toBe(HALF_TABLE_LEFT);
    });

    it('keeps a right half a half, starting on the left', () => {
      expect(seatAMoveKeeps(HALF_TABLE_RIGHT, null)).toBe(HALF_TABLE_LEFT);
    });
  });
});
