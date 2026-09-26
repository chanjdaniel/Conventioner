import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { Router } from 'vue-router';
import { marketPath, openMarket, parseMarketFromApi } from '@/utils/market';
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
  it('round-trips the market lifecycle phase', () => {
    const market = parseMarketFromApi({ ...apiMarket, phase: 'archived' });

    expect(market.phase).toBe(MarketPhase.Archived);
  });

  it('round-trips the application form and review config', () => {
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
      reviewConfig: { reviewers: ['a@example.com'] },
    });

    expect(market.applicationForm?.fields[0].label).toBe('Shop name');
    expect(market.reviewConfig).toEqual({ reviewers: ['a@example.com'] });
  });

  it('leaves the new fields undefined when the API omits them', () => {
    const market = parseMarketFromApi(apiMarket);

    expect(market.phase).toBeUndefined();
    expect(market.applicationForm).toBeUndefined();
    expect(market.reviewConfig).toBeUndefined();
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
    MarketPhase.ApplicationsOpen,
    MarketPhase.ApplicationsClosed,
    MarketPhase.Review,
    MarketPhase.Assignment,
    MarketPhase.Offers,
    MarketPhase.MarketDays,
    MarketPhase.Archived,
  ])('opens a market in %s on its own screens', (phase) => {
    expect(opened(market({ phase })).push).toHaveBeenCalledWith('/markets/market-123/setup');
  });

  it('opens a stored market that predates the phase field the same way', () => {
    expect(opened(market({ isDraft: false })).push).toHaveBeenCalledWith(
      '/markets/market-123/setup',
    );
    expect(opened(market({ isDraft: true })).push).toHaveBeenCalledWith(
      '/markets/market-123/setup',
    );
  });

  it('makes the chosen market the open one', () => {
    expect(opened(market({ phase: MarketPhase.Draft })).stored.id).toBe('market-123');
  });

  it('never sends anyone to a public slug, which a CSV market does not serve', () => {
    expect(opened(market({ phase: MarketPhase.MarketDays })).push).not.toHaveBeenCalledWith(
      '/test-market',
    );
  });
});

describe('marketPath', () => {
  it('addresses every market screen by id, so a link opens that market', () => {
    expect(marketPath('m1')).toBe('/markets/m1/setup');
    expect(marketPath('m1', 'setup', 'assignment')).toBe('/markets/m1/setup?tab=assignment');
    expect(marketPath('m1', 'tables')).toBe('/markets/m1/tables');
  });

  it('escapes an id rather than letting it name another path', () => {
    expect(marketPath('a/b')).toBe('/markets/a%2Fb/setup');
  });
});
