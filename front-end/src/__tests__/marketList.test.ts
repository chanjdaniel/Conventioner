import { describe, it, expect } from 'vitest';
import { type Market, MarketPhase } from '@/assets/types/datatypes';
import {
  DEFAULT_MARKET_LIST_QUERY,
  type MarketListQuery,
  marketListQueryFromRoute,
  marketListQueryToRoute,
  viewMarkets,
} from '@/utils/marketList';

const TODAY = '2026-09-30';

function market(overrides: Partial<Market> & { dates?: string[] }): Market {
  const { dates = [], ...rest } = overrides;
  return {
    id: rest.name ?? 'm',
    name: 'Market',
    creationDate: '2026-01-01T00:00:00.000Z',
    roles: {},
    isDraft: true,
    phase: MarketPhase.Draft,
    organizationId: 'org-a',
    setupObject: {
      marketDates: dates.map((date) => ({ date })),
    },
    ...rest,
  } as unknown as Market;
}

function query(overrides: Partial<MarketListQuery>): MarketListQuery {
  return { ...DEFAULT_MARKET_LIST_QUERY, ...overrides };
}

const names = (markets: Market[]) => markets.map((m) => m.name);

describe('search', () => {
  const markets = [
    market({ name: 'Test Market' }),
    market({ name: 'Latest Fair' }),
    market({ name: 'Café Market' }),
    market({ name: 'Winter Fair' }),
  ];

  it('keeps markets whose name contains the text, in any case', () => {
    expect(names(viewMarkets(markets, query({ search: 'tes', sort: 'name' }), TODAY))).toEqual([
      'Latest Fair',
      'Test Market',
    ]);
    expect(names(viewMarkets(markets, query({ search: 'TES', sort: 'name' }), TODAY))).toEqual([
      'Latest Fair',
      'Test Market',
    ]);
  });

  it('ignores accents on either side', () => {
    expect(names(viewMarkets(markets, query({ search: 'cafe' }), TODAY))).toEqual(['Café Market']);
    expect(names(viewMarkets(markets, query({ search: 'CAFÉ' }), TODAY))).toEqual(['Café Market']);
  });

  it('ignores surrounding whitespace, and a blank search keeps everything', () => {
    expect(names(viewMarkets(markets, query({ search: '  winter ' }), TODAY))).toEqual([
      'Winter Fair',
    ]);
    expect(viewMarkets(markets, query({ search: '   ' }), TODAY)).toHaveLength(4);
  });

  it('searches the name only, not the organization', () => {
    const inOrg = [market({ name: 'Spring', organizationName: 'Test Collective' })];
    expect(viewMarkets(inOrg, query({ search: 'test' }), TODAY)).toEqual([]);
  });
});

describe('filters', () => {
  const markets = [
    market({ name: 'A', organizationId: 'org-a', phase: MarketPhase.Review }),
    market({ name: 'B', organizationId: 'org-b', phase: MarketPhase.Assignment }),
    market({ name: 'C', organizationId: 'org-a', phase: MarketPhase.Archived }),
    market({ name: 'D', organizationId: 'org-a', phase: undefined }),
  ];

  it('narrows to one organization', () => {
    expect(
      names(viewMarkets(markets, query({ organizationId: 'org-a', sort: 'name' }), TODAY)),
    ).toEqual(['A', 'C', 'D']);
  });

  it('keeps markets in any of several phases', () => {
    const phases = [MarketPhase.Review, MarketPhase.Assignment];
    expect(names(viewMarkets(markets, query({ phases, sort: 'name' }), TODAY))).toEqual(['A', 'B']);
  });

  it('reads a market with no phase as a draft, as its badge does', () => {
    expect(names(viewMarkets(markets, query({ phases: [MarketPhase.Draft] }), TODAY))).toEqual([
      'D',
    ]);
  });

  it('composes search, both filters and the sort', () => {
    const many = [
      market({ name: 'Fair Two', organizationId: 'org-a', phase: MarketPhase.Review }),
      market({ name: 'Fair One', organizationId: 'org-a', phase: MarketPhase.Assignment }),
      market({ name: 'Fair Three', organizationId: 'org-b', phase: MarketPhase.Review }),
      market({ name: 'Fair Four', organizationId: 'org-a', phase: MarketPhase.Draft }),
      market({ name: 'Bazaar', organizationId: 'org-a', phase: MarketPhase.Review }),
    ];
    const q = query({
      search: 'fair',
      organizationId: 'org-a',
      phases: [MarketPhase.Review, MarketPhase.Assignment],
      sort: 'name',
    });
    expect(names(viewMarkets(many, q, TODAY))).toEqual(['Fair One', 'Fair Two']);
  });

  it('does not reorder or change the list it was given', () => {
    const given = [market({ name: 'b' }), market({ name: 'a' })];
    viewMarkets(given, query({ sort: 'name' }), TODAY);
    expect(names(given)).toEqual(['b', 'a']);
  });
});

describe('sort', () => {
  it('by name, A-Z, ignoring case', () => {
    const markets = [
      market({ name: 'banana' }),
      market({ name: 'Cherry' }),
      market({ name: 'Apple' }),
    ];
    expect(names(viewMarkets(markets, query({ sort: 'name' }), TODAY))).toEqual([
      'Apple',
      'banana',
      'Cherry',
    ]);
  });

  it('by created, newest first', () => {
    const markets = [
      market({ name: 'old', creationDate: '2025-01-01T00:00:00.000Z' }),
      market({ name: 'new', creationDate: '2026-06-01T00:00:00.000Z' }),
      market({ name: 'mid', creationDate: '2025-12-01T00:00:00.000Z' }),
    ];
    expect(names(viewMarkets(markets, query({ sort: 'created' }), TODAY))).toEqual([
      'new',
      'mid',
      'old',
    ]);
  });

  it('by market date: soonest upcoming first, then past most recent first, then no dates', () => {
    const markets = [
      market({ name: 'no dates' }),
      market({ name: 'long past', dates: ['2025-05-01'] }),
      market({ name: 'far', dates: ['2027-03-01'] }),
      market({ name: 'recent past', dates: ['2026-08-01', '2026-09-01'] }),
      // Ran yesterday and runs again next week: its next date is what an organizer is waiting on.
      market({ name: 'spans today', dates: ['2026-09-29', '2026-10-07'] }),
      market({ name: 'today', dates: ['2026-09-30'] }),
    ];
    expect(names(viewMarkets(markets, query({ sort: 'date' }), TODAY))).toEqual([
      'today',
      'spans today',
      'far',
      'recent past',
      'long past',
      'no dates',
    ]);
  });

  it('is the default', () => {
    expect(DEFAULT_MARKET_LIST_QUERY.sort).toBe('date');
  });

  it('breaks ties by name, so the order never depends on what the server sent first', () => {
    const markets = [
      market({ name: 'Zed', dates: ['2026-10-10'] }),
      market({ name: 'Abe', dates: ['2026-10-10'] }),
    ];
    expect(names(viewMarkets(markets, query({ sort: 'date' }), TODAY))).toEqual(['Abe', 'Zed']);
  });
});

describe('the address', () => {
  const orgIds = ['org-a', 'org-b'];

  it('writes nothing for the defaults', () => {
    expect(marketListQueryToRoute(DEFAULT_MARKET_LIST_QUERY)).toEqual({});
  });

  it('round-trips every control', () => {
    const q = query({
      search: 'tes',
      organizationId: 'org-b',
      phases: [MarketPhase.Review, MarketPhase.Assignment],
      sort: 'name',
    });
    expect(marketListQueryFromRoute(marketListQueryToRoute(q), orgIds)).toEqual(q);
  });

  it('writes phases in lifecycle order, whatever order they were chosen in', () => {
    const q = query({ phases: [MarketPhase.Archived, MarketPhase.Draft] });
    expect(marketListQueryToRoute(q)).toEqual({ phase: 'draft,archived' });
  });

  it('ignores an organization the organizer does not belong to', () => {
    expect(marketListQueryFromRoute({ org: 'org-gone' }, orgIds).organizationId).toBeNull();
  });

  it('ignores a phase this build does not know, keeping the ones it does', () => {
    expect(marketListQueryFromRoute({ phase: 'review,bogus' }, orgIds).phases).toEqual([
      MarketPhase.Review,
    ]);
  });

  it("keeps the organization while the organizer's organizations are not known", () => {
    expect(marketListQueryFromRoute({ org: 'org-a' }, null).organizationId).toBe('org-a');
    expect(marketListQueryFromRoute({}, null).organizationId).toBeNull();
  });

  it('ignores an unknown sort', () => {
    expect(marketListQueryFromRoute({ sort: 'bogus' }, orgIds).sort).toBe('date');
  });

  it('reads a repeated parameter as its first value', () => {
    expect(marketListQueryFromRoute({ q: ['one', 'two'] }, orgIds).search).toBe('one');
  });
});
