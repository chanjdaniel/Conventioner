import type { RouteLocationNormalizedLoaded } from 'vue-router';
import type { SetupViewPage } from '@/utils/marketPage';

declare module 'vue-router' {
  interface RouteMeta {
    /**
     * Whether the route lays out on a phone: `true` for every page of it, or the `page` values that
     * do, on a route that is several pages (Market Setup's view, whose Applications page alone fits
     * a phone).
     */
    fitsAPhone?: true | readonly SetupViewPage[];
  }
}

/**
 * Whether an organizer route must also work on a phone, by its `meta.fitsAPhone` (E29/F01): the door
 * on market day, and the few other places an organizer reaches from a phone (the router names them).
 * A route that is several pages names the pages that fit, and only those do.
 * Every other organizer route keeps the app's 1000px desktop floor, so a phone-sized window shows it
 * as a desk's layout, scrolled sideways.
 */
export function fitsAPhone(route: RouteLocationNormalizedLoaded): boolean {
  const page = route.params.page;
  return route.matched.some((r) => {
    const fits = r.meta.fitsAPhone;
    return (
      fits === true ||
      (Array.isArray(fits) && typeof page === 'string' && fits.includes(page as SetupViewPage))
    );
  });
}
