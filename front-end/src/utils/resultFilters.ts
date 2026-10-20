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
  /** Words that find a table by its label or by someone at it (E35/F02/S01). */
  search: string;
}

/**
 * What the search finds each vendor by beyond their address, as `GET /markets/:id/tables` serves
 * it: their names and their answers to the form's text questions, keyed by lowercased address.
 */
export type VendorSearch = Readonly<Record<string, readonly string[]>>;

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
    // As typed: the box reads the address, so trimming here would eat the space between two words.
    search: firstValue(query.search),
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

/** A whole address, as Change placement searches by (E35/F02/S02), rather than part of one. */
const WHOLE_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The search: the table's label, or anyone at it by address, name or text answer. A whole address
 * finds that vendor alone - "al@x.test" is part of "sal@x.test", and of anyone's answer naming it.
 */
function matchesSearch(row: MarketTableRow, needle: string, search: VendorSearch): boolean {
  if (!needle) return true;
  if (WHOLE_ADDRESS.test(needle)) {
    return (row.assignmentSlots ?? []).some((email) => email?.trim().toLowerCase() === needle);
  }
  const found = (text: string) => text.toLowerCase().includes(needle);
  if (found(row.tableCode)) return true;
  return (row.assignmentSlots ?? []).some((email) => {
    if (!email) return false;
    const address = email.trim().toLowerCase();
    return found(address) || (search[address] ?? []).some(found);
  });
}

/** Every filter but the status, the search's words prepared once for every row. */
function placeMatcher(filters: ResultFilters, search: VendorSearch) {
  const needle = filters.search.trim().toLowerCase();
  return (row: MarketTableRow) =>
    (!filters.date || row.date === filters.date) &&
    placeMatches(row, filters) &&
    matchesSearch(row, needle, search);
}

export function tablesMatching(
  rows: MarketTableRow[],
  filters: ResultFilters,
  search: VendorSearch = {},
): MarketTableRow[] {
  const matchesPlace = placeMatcher(filters, search);
  return rows.filter(
    (row) => matchesPlace(row) && (!filters.status || rowStatus(row).label === filters.status),
  );
}

/** How many tables are in each status under every filter except the status itself. */
export function statusCounts(
  rows: MarketTableRow[],
  filters: ResultFilters,
  search: VendorSearch = {},
): Record<TableStatus, number> {
  const counts: Record<TableStatus, number> = { assigned: 0, partial: 0, empty: 0 };
  const matchesPlace = placeMatcher(filters, search);
  for (const row of rows) {
    if (matchesPlace(row)) counts[rowStatus(row).label] += 1;
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

/** Which of a market's applicants the Vendors page is listing: everyone, or one kind (E36/F02/S04). */
export type VendorsShown = 'unassigned' | 'rejected' | null;

/** The choice an address names in `?show=`, and nothing else as one. */
export function vendorsShownFrom(query: unknown): VendorsShown {
  return query === 'unassigned' || query === 'rejected' ? query : null;
}

/**
 * Whether a vendor belongs to that choice. Unassigned is a vendor of the run without a seat, so a
 * rejected applicant is never one of them, seated or not: counting them was bug 10.
 */
export function inVendorsShown(
  vendor: { inTheRun: boolean; rejected: boolean },
  shown: VendorsShown,
): boolean {
  if (shown === 'unassigned') return vendor.inTheRun;
  if (shown === 'rejected') return vendor.rejected;
  return true;
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
  if (page === 'tables') return [...PLACE_FILTERS, 'status', 'search'];
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

/**
 * A date's sections in the order the plan ranks them: by tier first, as the plan orders its tiers,
 * then as the plan lists its sections. By name, "Courtyard (Bronze)" led a market whose Gold tables
 * were its first (E30/F01/S05). Anything the plan does not name follows, by name.
 */
export function sectionsInPlanOrder<T extends { section: string; tier?: string }>(
  groups: T[],
  plan: { tiers?: { name: string }[]; sections?: { name: string }[] } | null | undefined,
): T[] {
  const rank = (names: string[], name: string | undefined) => {
    const at = name === undefined ? -1 : names.indexOf(name);
    return at === -1 ? names.length : at;
  };
  const tiers = (plan?.tiers ?? []).map((tier) => tier.name);
  const sections = (plan?.sections ?? []).map((section) => section.name);
  return [...groups].sort(
    (a, b) =>
      rank(tiers, a.tier) - rank(tiers, b.tier) ||
      rank(sections, a.section) - rank(sections, b.section) ||
      a.section.localeCompare(b.section),
  );
}
