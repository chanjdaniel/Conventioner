import { describe, expect, it } from 'vitest';
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
    ['the Discord return page', '/discord/connected'],
  ])('%s fits a phone', (_, path) => {
    expect(fits(path)).toBe(true);
  });

  it.each([
    ['Stats', `${MARKET}/stats`],
    ["Market Setup's plan", `${MARKET}/setup`],
    ['the form builder', `${MARKET}/form`],
    ['the Applications page', `${MARKET}/applications`],
    ['Settings', `${MARKET}/settings`],
    ['the import', `${MARKET}/import`],
    ['start-from-CSV', `${MARKET}/start-from-csv`],
    ['the floorplan', `${MARKET}/floorplan`],
    ['the market chooser', '/init'],
  ])('%s keeps the desktop floor', (_, path) => {
    expect(fits(path)).toBe(false);
  });
});
