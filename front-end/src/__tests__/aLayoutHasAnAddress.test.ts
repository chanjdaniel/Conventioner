/**
 * A market's layout has an address, and the beta's old one lands on it (T257 ticket 02).
 */
import { describe, expect, it } from 'vitest';
import router from '@/router';
import { layoutPath } from '@/utils/market';

describe("a layout's address", () => {
  it("is the market's layout, or one location's", () => {
    expect(layoutPath('m 1')).toBe('/markets/m%201/layout');
    expect(layoutPath('m1', 'loc/1')).toBe('/markets/m1/layout/loc%2F1');
  });

  it('opens the layout page, under the Market Setup tab', () => {
    for (const path of ['/markets/m1/layout', '/markets/m1/layout/loc-1']) {
      expect(router.resolve(path).name).toBe('market-layout');
    }
    expect(router.resolve('/markets/m1/layout/loc-1').params.locationId).toBe('loc-1');
  });

  it("brings the beta's old address to the market's layout", () => {
    const old = router.getRoutes().find((r) => r.path === '/markets/:marketId/floorplan');
    const redirect = old?.redirect as (to: unknown) => unknown;
    expect(redirect(router.resolve('/markets/m1/floorplan'))).toBe('/markets/m1/layout');
  });
});
