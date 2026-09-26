import type { LocationQuery } from 'vue-router';

/**
 * A copy of a route's query without one key: how a page drops a filter or closes a panel that lives
 * in its address (E22/F04), so a link to it, a refresh and Back all agree with what is on screen.
 */
export function withoutQueryKey(query: LocationQuery, key: string): LocationQuery {
  const next = { ...query };
  delete next[key];
  return next;
}
