/**
 * How the Result page narrows what it shows (E09/F02/S01, E28/F02).
 *
 * Every filter lives in the address, so a filtered view is a link. The status filter is the odd
 * one out: its options are also counts, and a count must not be narrowed by itself - choosing
 * "empty" would otherwise turn the assigned and partial counts into 0 (E28/F02/S01).
 */

export interface MarketTableRow {
  date: string;
  assignment: string[];
  /** The table seat by seat - `[left, right]`, null for vacant. Which side is free is a fact
      the occupant list cannot carry, and every placement names a side. */
  assignmentSlots: (string | null)[];
  location: string;
  section: string;
  tableChoice: string;
  tableCode: string;
  tier: string;
}

export const TABLE_STATUSES = ['assigned', 'partial', 'empty'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export type ChoiceFilter = 'full' | 'half' | '';

export interface ResultFilters {
  date: string;
  section: string;
  tier: string;
  choice: ChoiceFilter;
  status: TableStatus | '';
}

export type ResultFilterName = keyof ResultFilters;

function firstValue(raw: unknown): string {
  if (Array.isArray(raw)) {
    const first = raw.find((v) => typeof v === 'string' && v.length > 0);
    return typeof first === 'string' ? first : '';
  }
  return typeof raw === 'string' ? raw : '';
}

/** The filters a route query names. A value this build does not recognise is no filter. */
export function readResultFilters(query: Record<string, unknown>): ResultFilters {
  const choice = firstValue(query.choice).toLowerCase();
  const status = firstValue(query.status).toLowerCase();
  return {
    date: firstValue(query.date),
    section: firstValue(query.section),
    tier: firstValue(query.tier),
    choice: choice === 'full' || choice === 'half' ? choice : '',
    status: (TABLE_STATUSES as readonly string[]).includes(status) ? (status as TableStatus) : '',
  };
}

export interface RowStatus {
  label: TableStatus;
  leftEmail: string | null;
  rightEmail: string | null;
  isFull: boolean;
}

export function rowStatus(row: MarketTableRow): RowStatus {
  const isFull = row.tableChoice.toLowerCase().includes('full');
  // Seat by seat, not the occupant list: a lone occupant on the RIGHT used to draw on the left,
  // because a list of one cannot say which half of the table it means. Nothing could produce that
  // until a pin could (E11).
  const left = row.assignmentSlots?.[0] ?? null;
  const right = row.assignmentSlots?.[1] ?? null;

  if (!left && !right) {
    return { label: 'empty', leftEmail: null, rightEmail: null, isFull };
  }

  if (isFull) {
    const email = left ?? right;
    return { label: 'assigned', leftEmail: email, rightEmail: email, isFull };
  }

  const filled = (left ? 1 : 0) + (right ? 1 : 0);
  return {
    label: filled === 2 ? 'assigned' : 'partial',
    leftEmail: left,
    rightEmail: right,
    isFull,
  };
}

function matchesChoice(tableChoice: string, filter: ChoiceFilter): boolean {
  if (!filter) return true;
  return tableChoice.toLowerCase().includes(filter);
}

/** Where a table is, or where a vendor sits on one date. */
export interface VendorPlacement {
  section: string;
  tier: string;
  /** The table's size, which is how a vendor at it is placed. */
  tableChoice: string;
}

/** The section, tier and size filters, asked of one place - a table, or one vendor's seat. */
function placeMatches(place: VendorPlacement, filters: ResultFilters): boolean {
  return (
    (!filters.section || place.section === filters.section) &&
    (!filters.tier || place.tier === filters.tier) &&
    matchesChoice(place.tableChoice, filters.choice)
  );
}

/** Every filter but the status. */
function matchesPlace(row: MarketTableRow, filters: ResultFilters): boolean {
  if (filters.date && row.date !== filters.date) return false;
  return placeMatches(row, filters);
}

export function tablesMatching(rows: MarketTableRow[], filters: ResultFilters): MarketTableRow[] {
  return rows.filter(
    (row) =>
      matchesPlace(row, filters) && (!filters.status || rowStatus(row).label === filters.status),
  );
}

/** How many tables are in each status under every filter except the status itself. */
export function statusCounts(
  rows: MarketTableRow[],
  filters: ResultFilters,
): Record<TableStatus, number> {
  const counts: Record<TableStatus, number> = { assigned: 0, partial: 0, empty: 0 };
  for (const row of rows) {
    if (matchesPlace(row, filters)) counts[rowStatus(row).label] += 1;
  }
  return counts;
}

/** The filters that say WHERE, which mean the same on both pages and travel between them. */
export const PLACE_FILTERS = [
  'date',
  'section',
  'tier',
  'choice',
] as const satisfies readonly ResultFilterName[];

/** Whether any of the where-filters is set. */
export function hasPlaceFilter(filters: ResultFilters): boolean {
  return PLACE_FILTERS.some((name) => Boolean(filters[name]));
}

/**
 * The part of a query both Result pages share (E28/F02/S02): moving from the tables to the vendors
 * keeps the day, section, tier and table size the organizer is looking at. The status belongs to
 * tables and the open vendor to the vendors page, so neither travels.
 */
export function placeFilterQuery(query: Record<string, unknown>): Record<string, string> {
  const filters = readResultFilters(query);
  const carried: Record<string, string> = {};
  for (const name of PLACE_FILTERS) {
    if (filters[name]) carried[name] = filters[name];
  }
  return carried;
}

/** What each picker offers. */
export interface FilterOptions {
  dates: string[];
  sections: string[];
  tiers: string[];
}

/** Every distinct value the tables offer for each picker, so a picker offers only what exists. */
export function filterOptions(
  rows: Pick<MarketTableRow, 'date' | 'section' | 'tier'>[],
): FilterOptions {
  const distinct = (pick: (row: (typeof rows)[number]) => string) =>
    Array.from(new Set(rows.map(pick).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  return {
    dates: distinct((row) => row.date),
    sections: distinct((row) => row.section),
    tiers: distinct((row) => row.tier),
  };
}

/**
 * Whether the vendors page shows a vendor (E28/F02/S02), asked of where they are PLACED.
 *
 * A date is the vendors placed that day; a section, tier or table size is a placement there - on the
 * chosen date, or on any of theirs - and all of them must hold of the same placement. A vendor with
 * no placement drops out under any of them. "Unassigned only" asks the opposite question: with a
 * date, it is the vendors not placed that day. The other filters describe a placement, which an
 * unplaced vendor does not have, so the page offers only the date beside it (`filtersBeside`).
 */
export function vendorShown(
  placements: Map<string, VendorPlacement>,
  filters: ResultFilters,
  vendor: { onlyUnassigned: boolean; isAssigned: boolean },
): boolean {
  if (vendor.onlyUnassigned) {
    return filters.date ? !placements.has(filters.date) : !vendor.isAssigned;
  }
  if (!hasPlaceFilter(filters)) return true;

  const candidates = filters.date
    ? [placements.get(filters.date)].filter((p): p is VendorPlacement => Boolean(p))
    : [...placements.values()];
  return candidates.some((place) => placeMatches(place, filters));
}

/**
 * Which filters a Result page offers. The tables take every one; the vendors take the where-filters
 * - the status is a fact about tables - and, with "Unassigned only", the date alone, since the
 * others describe a placement an unplaced vendor does not have. A filter not offered draws neither a
 * picker nor a chip, so nothing on screen claims to narrow a list it does not.
 */
export function filtersBeside(
  page: 'tables' | 'vendors',
  onlyUnassigned = false,
): ResultFilterName[] {
  if (page === 'tables') return [...PLACE_FILTERS, 'status'];
  return onlyUnassigned ? ['date'] : [...PLACE_FILTERS];
}

/** The filters a page offers, with every other one let go. */
export function offeredFilters(filters: ResultFilters, offered: ResultFilterName[]): ResultFilters {
  const kept = { ...filters };
  for (const name of Object.keys(kept) as ResultFilterName[]) {
    if (!offered.includes(name)) (kept[name] as string) = '';
  }
  return kept;
}
