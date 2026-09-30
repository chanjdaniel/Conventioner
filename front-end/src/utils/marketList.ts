import type { LocationQuery, LocationQueryRaw } from 'vue-router';
import { type Market, MarketPhase } from '@/assets/types/datatypes';

/**
 * Finding a market on the Markets page (E25/F01/S01): a search, an organization, phases and an
 * order, applied together to the markets the organizer can reach.
 *
 * Pure, and kept out of the view, so the Dashboard and the Load Market dialog can adopt it without
 * copying it. The list endpoint already answers every market in one response, so this is a view
 * over that list rather than a query to the server.
 */

export type MarketSort = 'date' | 'name' | 'created';

export const MARKET_SORTS: ReadonlyArray<{ value: MarketSort; label: string }> = [
  { value: 'date', label: 'Market date' },
  { value: 'name', label: 'Name' },
  { value: 'created', label: 'Created' },
];

export interface MarketListQuery {
  search: string;
  /** Null is every organization. */
  organizationId: string | null;
  /** Empty is every phase. */
  phases: MarketPhase[];
  sort: MarketSort;
}

export const DEFAULT_MARKET_LIST_QUERY: Readonly<MarketListQuery> = Object.freeze({
  search: '',
  organizationId: null,
  phases: [],
  sort: 'date',
});

/** Every phase, in lifecycle order: the enum is declared in that order. */
export const PHASES_IN_ORDER: readonly MarketPhase[] = Object.values(MarketPhase);

/** Case, accents and surrounding whitespace do not count: "cafe" finds "Café Market". */
function folded(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** A market with no phase is read as a draft, as its badge reads it. */
function phaseOf(market: Market): string {
  return market.phase ?? MarketPhase.Draft;
}

function byName(a: Market, b: Market): number {
  return folded(a.name ?? '').localeCompare(folded(b.name ?? ''));
}

/**
 * Where a market falls in the date order, as [group, key]. Group 0 is upcoming (its next date,
 * soonest first), 1 is past (its last date, most recent first), 2 is no dates at all. Market dates
 * are calendar days, so they compare as strings and never pass through a timezone.
 */
function datePlace(market: Market, today: string): [number, string] {
  const dates = (market.setupObject?.marketDates ?? [])
    .map((d) => d.date)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')))
    .sort();
  if (dates.length === 0) return [2, ''];
  const next = dates.find((date) => date >= today);
  return next ? [0, next] : [1, dates[dates.length - 1]];
}

function byDate(today: string) {
  return (a: Market, b: Market): number => {
    const [groupA, keyA] = datePlace(a, today);
    const [groupB, keyB] = datePlace(b, today);
    if (groupA !== groupB) return groupA - groupB;
    const order = groupA === 1 ? keyB.localeCompare(keyA) : keyA.localeCompare(keyB);
    return order || byName(a, b);
  };
}

function createdTime(market: Market): number {
  const time = Date.parse(market.creationDate ?? '');
  return Number.isNaN(time) ? -Infinity : time;
}

function byCreated(a: Market, b: Market): number {
  return createdTime(b) - createdTime(a) || byName(a, b);
}

/**
 * The markets that match every active control, in the chosen order. `today` is the viewer's
 * calendar day ("YYYY-MM-DD"), which divides upcoming markets from past ones.
 */
export function viewMarkets(markets: Market[], query: MarketListQuery, today: string): Market[] {
  const search = folded(query.search);
  const matching = markets.filter(
    (market) =>
      (!search || folded(market.name ?? '').includes(search)) &&
      (!query.organizationId || market.organizationId === query.organizationId) &&
      (query.phases.length === 0 || (query.phases as string[]).includes(phaseOf(market))),
  );
  const compare =
    query.sort === 'name' ? byName : query.sort === 'created' ? byCreated : byDate(today);
  return matching.sort(compare);
}

/** The viewer's own calendar day. Which markets are still to come is a question about their today. */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function first(value: LocationQuery[string] | undefined): string {
  const one = Array.isArray(value) ? value[0] : value;
  return one ?? '';
}

/**
 * The query the page's address holds. A value that no longer means anything - an organization the
 * organizer has left, a phase this build does not know - is dropped rather than narrowing the list
 * to nothing, so an old bookmark still opens onto markets.
 */
export function marketListQueryFromRoute(
  route: LocationQuery,
  organizationIds: readonly string[],
): MarketListQuery {
  const org = first(route.org);
  const phases = new Set(first(route.phase).split(','));
  const sort = first(route.sort);
  return {
    search: first(route.q),
    organizationId: organizationIds.includes(org) ? org : null,
    phases: PHASES_IN_ORDER.filter((phase) => phases.has(phase)),
    sort: MARKET_SORTS.some((s) => s.value === sort)
      ? (sort as MarketSort)
      : DEFAULT_MARKET_LIST_QUERY.sort,
  };
}

/** The address for a query. The defaults write nothing, so an untouched page has a clean address. */
export function marketListQueryToRoute(query: MarketListQuery): LocationQueryRaw {
  const route: LocationQueryRaw = {};
  if (query.search) route.q = query.search;
  if (query.organizationId) route.org = query.organizationId;
  if (query.phases.length) {
    route.phase = PHASES_IN_ORDER.filter((phase) => query.phases.includes(phase)).join(',');
  }
  if (query.sort !== DEFAULT_MARKET_LIST_QUERY.sort) route.sort = query.sort;
  return route;
}
