import { describe, expect, it } from 'vitest';
import type { RouteLocationNormalizedLoaded, RouteRecordNormalized } from 'vue-router';
import router from '@/router';
import { fitsAPhone } from '@/utils/fitsAPhone';

/**
 * Which organizer places lay out on a phone (`meta.fitsAPhone`), read off the app's own routes: the
 * ones an organizer reaches from a phone at the market, and none of the setup screens, which are
 * built at a desk before it (`docs/design-system.md`, Layout).
 */

const fits = (path: string) => fitsAPhone(router.resolve(path));
const MARKET = '/markets/m1';

describe('the places that fit a phone', () => {
  it.each([
    ['the dashboard', '/dashboard'],
    ['the markets list', '/markets'],
    ['Organizations', '/organizations'],
    ['the door', `${MARKET}/attendance`],
    ['Tools', `${MARKET}/tools`],
    ['the Assignments page', `${MARKET}/assignments`],
    ['Vendors', `${MARKET}/vendors`],
    ['Payments', `${MARKET}/payments`],
    ['the Applications page', `${MARKET}/applications`],
    ['Stats', `${MARKET}/stats`],
    ['the Discord return page', '/discord/connected'],
  ])('%s fits a phone', (_, path) => {
    expect(fits(path)).toBe(true);
  });

  it.each([
    ["Market Setup's plan", `${MARKET}/setup`],
    ['the form builder', `${MARKET}/form`],
    ['Settings', `${MARKET}/settings`],
    ['the import', `${MARKET}/import`],
    ['start-from-CSV', `${MARKET}/start-from-csv`],
    ['the floorplan', `${MARKET}/floorplan`],
    ['the market chooser', '/init'],
  ])('%s keeps the desktop floor', (_, path) => {
    expect(fits(path)).toBe(false);
  });
});

/** A route as the reader sees it: one matched record with this `fitsAPhone`, at this `page`. */
function routeAt(
  fitsAPhoneMeta: RouteRecordNormalized['meta']['fitsAPhone'],
  page: string | string[] | undefined,
): RouteLocationNormalizedLoaded {
  return {
    params: page === undefined ? {} : { page },
    matched: [{ meta: { fitsAPhone: fitsAPhoneMeta } } as unknown as RouteRecordNormalized],
  } as unknown as RouteLocationNormalizedLoaded;
}

describe("a route's list of the pages that fit a phone", () => {
  it('lets through a page it names', () => {
    expect(fitsAPhone(routeAt(['applications'], 'applications'))).toBe(true);
  });

  it.each([
    ['another page', 'setup'],
    ['a page whose name holds the one named', 'applicationsx'],
    ['no page at all', undefined],
    ['a repeated page parameter', ['applications']],
  ])('never lets through %s', (_, page) => {
    expect(fitsAPhone(routeAt(['applications'], page))).toBe(false);
  });

  it('lets no page through when it names none', () => {
    expect(fitsAPhone(routeAt([], 'applications'))).toBe(false);
  });
});
