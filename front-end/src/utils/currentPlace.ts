import type { RouteLocationNormalizedLoaded } from 'vue-router';

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
