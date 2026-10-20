import type { APIRequestContext } from '@playwright/test';
import { savePlan } from './savePlan';

/**
 * A Google Form's responses never say where the market is or how many tables it has, so a market
 * started from them has tiers and dates and nothing else - as the organizer has, until they add the
 * rest on Market Setup. Leaving draft asks for it (E31/F01/S01), so this adds what they would: a
 * location, and a section of tables at each tier. In draft, where the setup still changes.
 */
export async function finishStartedPlan(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  marketId: string,
): Promise<void> {
  const res = await request.get(`${baseURL}/markets/${marketId}`, {
    headers: { 'X-Owner-Email': email },
  });
  const { market } = (await res.json()) as {
    market: {
      setupObject: { tiers: Array<{ id: number; name: string }> } & Record<string, unknown>;
    };
  };
  const setup = market.setupObject;
  const location = { name: 'Main Hall' };
  await savePlan(request, baseURL, email, marketId, {
    ...setup,
    locations: [location],
    // A section of tables at each tier, or one section when the form named no tiers at all.
    sections: setup.tiers.length
      ? setup.tiers.map((tier) => ({ name: `${tier.name} Hall`, location, tier, count: 200 }))
      : [{ name: 'Hall', location, tier: null, count: 200 }],
  });
}

/**
 * A year still to come in which each anonymised export's dates fall on the same weekdays, so the
 * year asked after upload matches the file and the market may leave draft (E31/F01/S01). The
 * exports are past years' only because that is what exists; an organizer's own is this year's.
 */
export const UPCOMING_YEAR: Record<string, number> = {
  'fall-2023': 2034,
  'spring-2024': 2052,
  'spring-2025': 2031,
  'fall-2025': 2031,
};
