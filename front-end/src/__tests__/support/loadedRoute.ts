import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';

/**
 * The route a path resolves to, as `useRoute()` hands it to a screen once loaded: a resolved
 * location may have no name, where a loaded one always has one, so a path naming no route throws.
 */
export function loadedRoute(router: Router, path: string): RouteLocationNormalizedLoaded {
  const { name, ...route } = router.resolve(path);
  if (name === null) throw new Error(`No route is named for ${path}`);
  return { ...route, name };
}
