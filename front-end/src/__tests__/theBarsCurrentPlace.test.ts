import { afterEach, describe, expect, it } from 'vitest';
import router from '@/router';
import {
  currentPlace,
  isVendorFacing,
  standsApart,
  vendorPageAnswered,
} from '@/utils/currentPlace';

/**
 * Which of the bar's two places a route stands in, read off the router's own routes, so a market
 * screen added tomorrow is covered by its `marketId` and nobody has to list it here.
 */
describe('which place is current', () => {
  const place = (path: string) => currentPlace(router.resolve(path));

  it('is Markets on the list', () => {
    expect(place('/markets')).toBe('markets');
  });

  it.each([
    '/markets/m1',
    '/markets/m1/setup',
    '/markets/m1/form',
    '/markets/m1/applications',
    '/markets/m1/assignments',
    '/markets/m1/vendors',
    '/markets/m1/payments',
    '/markets/m1/attendance',
    '/markets/m1/tools',
    '/markets/m1/stats',
    '/markets/m1/import',
    '/markets/m1/start-from-csv',
    '/markets/m1/floorplan',
  ])('is Markets on the market screen %s', (path) => {
    expect(place(path)).toBe('markets');
  });

  it('is Organizations on Organizations', () => {
    expect(place('/organizations')).toBe('organizations');
  });

  it.each(['/login', '/reset-password-request', '/some-market', '/no/such/page'])(
    'is neither on %s',
    (path) => {
      expect(place(path)).toBeNull();
    },
  );
});

/** The vendor page stands apart from the organizer app (T260), and it alone: "Page not found" does not. */
describe("which page is a vendor's", () => {
  it('is the vendor page', () => {
    expect(isVendorFacing(router.resolve('/some-market'))).toBe(true);
  });

  it('is the vendor page and no other route', () => {
    const vendorFacing = router
      .getRoutes()
      .filter((record) => record.meta.vendorFacing === true)
      .map((record) => record.name);
    expect(vendorFacing).toEqual(['vendor-page']);
  });

  it.each([
    '/markets',
    '/organizations',
    '/markets/m1/setup',
    '/login',
    '/reset-password-request',
    '/no/such/page',
  ])('is not %s', (path) => {
    expect(isVendorFacing(router.resolve(path))).toBe(false);
  });
});

/**
 * The vendor page's route answers "Page not found" itself for a slug naming no market or a gated
 * market's, and that is no vendor's page: the bar stands apart only while the page has not said so.
 */
describe('when the bar stands apart', () => {
  afterEach(() => {
    vendorPageAnswered('some-market', false);
    vendorPageAnswered('other-market', false);
  });

  it('does on a vendor page until it answers', () => {
    expect(standsApart(router.resolve('/some-market'))).toBe(true);
  });

  it('does on a vendor page that found its market', () => {
    vendorPageAnswered('some-market', false);
    expect(standsApart(router.resolve('/some-market'))).toBe(true);
  });

  it('does not on a vendor page that answered "Page not found"', () => {
    vendorPageAnswered('some-market', true);
    expect(standsApart(router.resolve('/some-market'))).toBe(false);
  });

  it('does on another slug\'s page than the one that answered "Page not found"', () => {
    vendorPageAnswered('some-market', true);
    expect(standsApart(router.resolve('/other-market'))).toBe(true);
  });

  it('does again once the page that answered "Page not found" finds its market', () => {
    vendorPageAnswered('some-market', true);
    vendorPageAnswered('some-market', false);
    expect(standsApart(router.resolve('/some-market'))).toBe(true);
  });

  it("is untouched by another slug's answer", () => {
    vendorPageAnswered('some-market', true);
    vendorPageAnswered('other-market', false);
    expect(standsApart(router.resolve('/some-market'))).toBe(false);
  });

  it.each(['/markets', '/markets/m1/setup', '/login', '/no/such/page'])(
    'does not on %s',
    (path) => {
      expect(standsApart(router.resolve(path))).toBe(false);
    },
  );
});
