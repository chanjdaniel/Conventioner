import { describe, it, expect } from 'vitest';
import { parseMarketFromApi } from '@/utils/market';
import { MarketPhase } from '@/assets/types/datatypes';

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

    it('round-trips the application form, review config and Discord guild', () => {
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
            discordGuildId: 'guild-1',
        });

        expect(market.applicationForm?.fields[0].label).toBe('Shop name');
        expect(market.reviewConfig).toEqual({ reviewers: ['a@example.com'] });
        expect(market.discordGuildId).toBe('guild-1');
    });

    it('leaves the new fields undefined when the API omits them', () => {
        const market = parseMarketFromApi(apiMarket);

        expect(market.phase).toBeUndefined();
        expect(market.applicationForm).toBeUndefined();
        expect(market.reviewConfig).toBeUndefined();
        expect(market.discordGuildId).toBeUndefined();
    });
});
