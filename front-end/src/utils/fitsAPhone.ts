import type { RouteLocationNormalizedLoaded } from 'vue-router';

/**
 * Whether an organizer route must also work on a phone, by its `meta.fitsAPhone` (E29/F01): the door
 * on market day, and the few other places an organizer reaches from a phone (the router names them).
 * Every other organizer route keeps the app's 1000px desktop floor, so a phone-sized window shows it
 * as a desk's layout, scrolled sideways.
 */
export function fitsAPhone(route: RouteLocationNormalizedLoaded): boolean {
  return route.matched.some((r) => r.meta.fitsAPhone === true);
}
