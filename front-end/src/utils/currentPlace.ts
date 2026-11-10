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
