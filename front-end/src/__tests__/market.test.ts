import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { Router } from 'vue-router';
import { isHere, marketPath, openMarket, parseMarketFromApi } from '@/utils/market';
import { MarketPhase, type Market } from '@/assets/types/datatypes';

const apiMarket = {
  id: 'market-123',
  name: 'Test Market',
  creationDate: '2026-01-01T00:00:00Z',
  roles: { 'user-1': 'owner' },
  isDraft: false,
  modificationList: [],
  assignmentObject: { vendorAssignments: [] },
};

describe('parseMarketFromApi', () => {
  it('carries what the server judged of each move and of the setup (E31/F01, F02)', () => {
    const blockers = { applications: [{ id: 'x', passed: false, message: 'No dates.' }] };
    const market = parseMarketFromApi({
      ...apiMarket,
      transitionBlockers: blockers,
      setupLockReason: 'The setup is settled.',
    });

    expect(market.transitionBlockers).toEqual(blockers);
    expect(market.setupLockReason).toBe('The setup is settled.');
  });

  it('carries whether applications are stopped, and why that cannot change (E38/F04/S02)', () => {
    const market = parseMarketFromApi({
      ...apiMarket,
      applicationsStopped: true,
      applicationsStopReason: null,
    });

    expect(market.applicationsStopped).toBe(true);
    expect(market.applicationsStopReason).toBeNull();
  });

  it("carries the review setup's two decisions, each undecided when the read has none (T206)", () => {
    const decided = parseMarketFromApi({
      ...apiMarket,
      nothingLeadsTheCard: true,
      noAutomaticRejections: true,
    });
    const undecided = parseMarketFromApi(apiMarket);

    expect([decided.nothingLeadsTheCard, decided.noAutomaticRejections]).toEqual([true, true]);
    expect([undecided.nothingLeadsTheCard, undecided.noAutomaticRejections]).toEqual([
      false,
      false,
    ]);
  });

  it('round-trips the market lifecycle phase', () => {
    const market = parseMarketFromApi({ ...apiMarket, phase: 'archived' });

    expect(market.phase).toBe(MarketPhase.Archived);
  });

  it('round-trips the application form and the reviewers', () => {
    const market = parseMarketFromApi({
      ...apiMarket,
      applicationForm: {
        fields: [
          {
            key: 'shop_name',
            label: 'Shop name',
            type: 'text',
            required: true,
            options: [],
            order: 0,
          },
        ],
      },
      reviewTeam: { reviewers: [{ email: 'a@example.com', able: true }] },
    });

    expect(market.applicationForm?.fields[0].label).toBe('Shop name');
    expect(market.reviewTeam).toEqual({ reviewers: [{ email: 'a@example.com', able: true }] });
  });

  /**
   * Every screen reads the PARSED market now (E21/F02). They used to read the raw copy out of
   * `localStorage`, which is how a parser that silently dropped fields went unnoticed - and the
   * plan's autosave sends a working copy built from this, so a dropped `floorplans` would be a
   * floorplan erased by the next keystroke on the plan.
   */
  it('keeps everything the server says about the market', () => {
    const floorplans = [{ id: 'fp-1', tableTypes: [{ name: 'Full' }] }];
    const market = parseMarketFromApi({
      ...apiMarket,
      phase: 'applications',
      intakeMode: 'form',
      resultsPublished: true,
      applicationFormLockReason: 'Application form can only be edited while in draft.',
      setupObject: { marketDates: [{ date: '2026-08-01' }], floorplans },
    });

    expect(market.intakeMode).toBe('form');
    expect(market.resultsPublished).toBe(true);
    expect(market.applicationFormLockReason).toBe(
      'Application form can only be edited while in draft.',
    );
    expect(market.setupObject?.floorplans).toEqual(floorplans);
    expect(market.setupObject?.marketDates).toEqual([{ date: '2026-08-01' }]);
  });

  it("keeps each row's id, the market's table types and its layouts (T257)", () => {
    const upper = { id: 'loc-upper', name: 'Upper Hall' };
    const tableTypes = [{ id: 'tt-six', name: 'Standard 6 ft', widthMm: 1830, depthMm: 760 }];
    const floorplans = [
      {
        id: 'fp-upper',
        locationId: 'loc-upper',
        revision: 3,
        tables: [
          {
            id: 't-1',
            sectionId: 'sec-gold',
            number: 1,
            tableTypeId: 'tt-six',
            xMm: 1000,
            yMm: 2000,
            rotation: 90,
          },
        ],
        zones: [],
        sectionStyles: [{ sectionId: 'sec-gold', color: 2, labelAt: null }],
        startingCounts: [{ sectionId: 'sec-gold', count: 9 }],
      },
    ];
    const sections = [{ id: 'sec-gold', name: 'Gold row', location: upper, tier: null, count: 1 }];

    const { setupObject } = parseMarketFromApi({
      ...apiMarket,
      setupObject: { locations: [upper], sections, tableTypes, floorplans },
    });

    expect(setupObject?.locations).toEqual([upper]);
    expect(setupObject?.sections).toEqual(sections);
    expect(setupObject?.tableTypes).toEqual(tableTypes);
    expect(setupObject?.floorplans).toEqual(floorplans);
  });

  it('reads a plan stored before table types as having none', () => {
    expect(parseMarketFromApi({ ...apiMarket, setupObject: {} }).setupObject?.tableTypes).toEqual(
      [],
    );
  });

  it('keeps why the assignment rules are settled, and reads open rules as no lock', () => {
    const settled = 'The table allocation for this market is settled.';
    expect(
      parseMarketFromApi({ ...apiMarket, assignmentRulesLockReason: settled })
        .assignmentRulesLockReason,
    ).toBe(settled);
    expect(
      parseMarketFromApi({ ...apiMarket, assignmentRulesLockReason: null })
        .assignmentRulesLockReason,
    ).toBeNull();
  });

  it('keeps which groups changed since the assignment ran', () => {
    expect(
      parseMarketFromApi({ ...apiMarket, assignmentOutOfDate: ['rules', 'plan'] })
        .assignmentOutOfDate,
    ).toEqual(['rules', 'plan']);
  });

  it('reads an editable form as no lock at all', () => {
    expect(
      parseMarketFromApi({ ...apiMarket, applicationFormLockReason: null })
        .applicationFormLockReason,
    ).toBeNull();
  });

  it('leaves the new fields undefined when the API omits them', () => {
    const market = parseMarketFromApi(apiMarket);

    expect(market.phase).toBeUndefined();
    expect(market.applicationForm).toBeUndefined();
    expect(market.reviewTeam).toEqual({ reviewers: [] });
  });
});

describe('openMarket', () => {
  const market = (fields: Partial<Market>): Market =>
    ({ id: 'market-123', name: 'Test Market', ...fields }) as Market;

  function opened(m: Market) {
    const push = vi.fn();
    openMarket({ push } as unknown as Router, m);
    return { push, stored: JSON.parse(localStorage.getItem('market') ?? 'null') };
  }

  beforeEach(() => localStorage.clear());

  /**
   * Every phase lands on the market's own screens. This used to branch: `market_days` and
   * `archived` were sent to `/<slug>`, the market's public page - which the intake-mode gate
   * serves only to form-intake markets, and every MVP market is CSV. So Open on a published
   * market landed on "Page not found".
   */
  it.each([
    MarketPhase.Draft,
    MarketPhase.Applications,
    MarketPhase.Assignment,
    MarketPhase.Offers,
    MarketPhase.MarketDays,
    MarketPhase.Archived,
  ])('opens a market in %s at its own address, which lands on the page for its phase', (phase) => {
    expect(opened(market({ phase })).push).toHaveBeenCalledWith('/markets/market-123');
  });

  it('opens a stored market that predates the phase field the same way', () => {
    expect(opened(market({ isDraft: false })).push).toHaveBeenCalledWith('/markets/market-123');
    expect(opened(market({ isDraft: true })).push).toHaveBeenCalledWith('/markets/market-123');
  });

  it('keeps nothing about the market in the browser; arriving is what opens it', () => {
    expect(opened(market({ phase: MarketPhase.Draft })).stored).toBeNull();
  });

  it('never sends anyone to a public slug, which a CSV market does not serve', () => {
    expect(opened(market({ phase: MarketPhase.MarketDays })).push).not.toHaveBeenCalledWith(
      '/test-market',
    );
  });
});

describe('marketPath', () => {
  it('gives every market page its own address, so a link opens that page of that market', () => {
    expect(marketPath('m1', 'setup')).toBe('/markets/m1/setup');
    expect(marketPath('m1', 'settings')).toBe('/markets/m1/settings');
    expect(marketPath('m1', 'assignments')).toBe('/markets/m1/assignments');
    expect(marketPath('m1', 'import')).toBe('/markets/m1/import');
  });

  it("is the market's own address with no page, which lands on the page for its phase", () => {
    expect(marketPath('m1')).toBe('/markets/m1');
  });

  it('escapes an id rather than letting it name another path', () => {
    expect(marketPath('a/b', 'setup')).toBe('/markets/a%2Fb/setup');
  });
});

describe('isHere (T206)', () => {
  const form = '/markets/m1/form';

  it('is the same path, with every query value the address names', () => {
    expect(isHere(`${form}?step=review`, { path: form, query: { step: 'review' } })).toBe(true);
    expect(isHere(`${form}?step=review`, { path: form, query: { step: 'questions' } })).toBe(false);
    expect(isHere(`${form}?step=review`, { path: form, query: {} })).toBe(false);
    expect(isHere(`${form}?step=review`, { path: '/markets/m1/setup', query: {} })).toBe(false);
  });

  it('leaves an address that names no query here whatever the page keeps in its own', () => {
    const applications = '/markets/m1/applications';
    expect(isHere(applications, { path: applications, query: { view: 'one' } })).toBe(true);
    expect(isHere(applications, { path: applications })).toBe(true);
  });

  it('is nowhere without a route to compare with', () => {
    expect(isHere(form, undefined)).toBe(false);
  });
});
