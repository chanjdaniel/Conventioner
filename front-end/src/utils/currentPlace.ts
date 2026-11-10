import { shallowRef } from 'vue';
import type { RouteLocationNormalizedLoaded } from 'vue-router';

declare module 'vue-router' {
  interface RouteMeta {
    /**
     * The page is a vendor's, not the organizer app's (T260): the app bar shows it the logo alone,
     * whoever is signed in, as a vendor reads it.
     */
    vendorFacing?: true;
  }
}

/** The organizer's places, the links the app bar holds. */
export type AppPlace = 'markets' | 'organizations';

/**
 * Which place a route stands in: a market's screens stand in Markets, by their `marketId`, so a new
 * market screen needs nothing here. Any other route, sign-in or "Page not found", stands in none.
 */
export function currentPlace(
  route: Pick<RouteLocationNormalizedLoaded, 'name' | 'params'>,
): AppPlace | null {
  if (route.name === 'markets' || route.params.marketId) return 'markets';
  if (route.name === 'organizations') return 'organizations';
  return null;
}

/** Whether a route is a vendor's page, which stands apart from the organizer app (T260). */
export function isVendorFacing(route: Pick<RouteLocationNormalizedLoaded, 'matched'>): boolean {
  return route.matched.some((record) => record.meta.vendorFacing === true);
}

/**
 * The slug whose vendor page answered "Page not found", while that answer stands. The vendor page's
 * route answers so itself, for a slug naming no market and for a gated market's (a draft's, even to
 * its own organizer), and that is no vendor's page.
 */
const absentVendorPage = shallowRef<string | null>(null);

/** The vendor page says what its read of `slug` answered: absent, or not (found, loading or gone). */
export function vendorPageAnswered(slug: string, absent: boolean): void {
  if (absent) absentVendorPage.value = slug;
  else if (absentVendorPage.value === slug) absentVendorPage.value = null;
}

/**
 * Whether the app bar stands apart from the organizer app here, showing the logo alone to everyone:
 * on a vendor's page, unless that page answered "Page not found", which keeps the organizer's bar
 * as any other "Page not found" does.
 */
export function standsApart(
  route: Pick<RouteLocationNormalizedLoaded, 'matched' | 'params'>,
): boolean {
  return isVendorFacing(route) && route.params.marketSlug !== absentVendorPage.value;
}
