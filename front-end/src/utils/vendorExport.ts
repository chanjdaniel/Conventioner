/**
 * The vendors, exported to a CSV (E42/F01/S01), with where they sit on each date (S02), from the
 * Vendors page or the Applications tab's All view (S03).
 *
 * The export dialog opens on what a page shows, so the file holds the vendors the organizer was
 * looking at; the server builds the file and its preview from the filters the dialog sends
 * (`POST /markets/:id/vendor-export`), and says which columns and filters the market offers.
 */
import { ApplicationStatus } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { downloadErrorMessage, saveCsv } from '@/utils/download';
import { hasPlaceFilter, type ResultFilters, type VendorsShown } from '@/utils/resultFilters';
import type { AllViewFilter } from '@/utils/reviewQueue';

export type ExportStatus = 'open' | 'follow_up' | 'approved' | 'rejected' | 'added';

/** What narrows the vendors; an empty value narrows nothing. */
export interface ExportFilters {
  /** Any of these; none is any status. */
  statuses: ExportStatus[];
  /** Assigned or not (`placed` / `unplaced` on the wire), on `date` or, with none, on any date. */
  placed: '' | 'placed' | 'unplaced';
  date: string;
  /** A seat's section, tier and size, which hold only of the vendors placed. */
  section: string;
  tier: string;
  size: '' | 'full' | 'half';
  /** A name or an address, as the Vendors page's search finds one. */
  search: string;
  /** A choice question's options, any of which the vendor chose. */
  answers: Record<string, string[]>;
  /** Only the follow-ups the one exporting owns, as the All view's Mine. */
  mine: boolean;
}

export const NO_FILTERS: ExportFilters = Object.freeze({
  statuses: [],
  placed: '',
  date: '',
  section: '',
  tier: '',
  size: '',
  search: '',
  answers: {},
  mine: false,
}) as ExportFilters;

/**
 * The Vendors page's filters as the export's. "Unassigned only" is the approved vendors with no
 * seat, on the date when one is chosen; where they are placed is the vendors placed there.
 */
export function vendorsPageSeed(page: {
  shown: VendorsShown;
  filters: ResultFilters;
  search: string;
}): ExportFilters {
  const seed: ExportFilters = { ...NO_FILTERS, search: page.search.trim() };
  if (page.shown === 'unassigned') {
    return { ...seed, statuses: ['approved'], placed: 'unplaced', date: page.filters.date };
  }
  if (page.shown === 'rejected') seed.statuses = ['rejected'];
  if (!hasPlaceFilter(page.filters)) return seed;
  return {
    ...seed,
    placed: 'placed',
    date: page.filters.date,
    section: page.filters.section,
    tier: page.filters.tier,
    size: page.filters.choice,
  };
}

/** The statuses each of the All view's filters lists; a vendor added by hand is approved there. */
const ALL_VIEW_STATUSES: Record<AllViewFilter, ExportStatus[]> = {
  all: [],
  undecided: ['open'],
  [ApplicationStatus.NeedsFollowUp]: ['follow_up'],
  [ApplicationStatus.ReviewerApproved]: ['approved', 'added'],
  [ApplicationStatus.ReviewerRejected]: ['rejected'],
};

/** The Applications tab's All view, its status filter and Mine, as the export's filters. */
export function applicationsAllSeed(view: { filter: AllViewFilter; mine: boolean }): ExportFilters {
  return { ...NO_FILTERS, statuses: [...ALL_VIEW_STATUSES[view.filter]], mine: view.mine };
}

/** Which heading the dialog lists a column under. */
export type ExportGroupId = 'vendor' | 'answers' | 'assignment';

export interface ExportColumn {
  id: string;
  label: string;
  group: ExportGroupId;
}

/** What the market offers the dialog, as the server says it. */
export interface ExportOffered {
  columns: ExportColumn[];
  /** The headings, in the order the dialog lists them. */
  groups: { id: ExportGroupId; label: string }[];
  defaultColumns: string[];
  statuses: { id: ExportStatus; label: string }[];
  dates: string[];
  sections: string[];
  tiers: string[];
  questions: { key: string; label: string; options: string[] }[];
}

export interface ExportPreview {
  count: number;
  header: string[];
  rows: string[][];
  offered: ExportOffered;
}

export interface ColumnGroup {
  id: ExportGroupId;
  label: string;
  columns: ExportColumn[];
}

/**
 * The columns under their headings, in the market's order: who the vendor is, their answers, then
 * where they sit. A heading with no column under it, as a form with no question of its own, is
 * left out.
 */
export function columnGroups(offered: Pick<ExportOffered, 'columns' | 'groups'>): ColumnGroup[] {
  return offered.groups
    .map((group) => ({
      ...group,
      columns: offered.columns.filter((column) => column.group === group.id),
    }))
    .filter((group) => group.columns.length);
}

/** The columns ticked when the dialog opens, in the file's order. */
export function defaultOrder(
  offered: Pick<ExportOffered, 'columns' | 'defaultColumns'>,
): ExportColumn[] {
  return offered.defaultColumns
    .map((id) => offered.columns.find((column) => column.id === id))
    .filter((column): column is ExportColumn => Boolean(column));
}

/** The file's columns with one ticked, at the end, or unticked. */
export function tickedColumn(
  order: ExportColumn[],
  column: ExportColumn,
  ticked: boolean,
): ExportColumn[] {
  const rest = order.filter((each) => each.id !== column.id);
  return ticked ? [...rest, column] : rest;
}

/** The ticked columns, in the order they are put: the file's columns. */
export function chosenColumns(order: ExportColumn[]): string[] {
  return order.map((column) => column.id);
}

/** The list with one column moved `by` places, never past either end. */
export function movedColumn<T>(order: T[], index: number, by: number): T[] {
  const to = index + by;
  if (to < 0 || to >= order.length || by === 0) return order;
  const next = order.slice();
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved!);
  return next;
}

const counted = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** "12 vendors, 3 columns". */
export function exportSummary(vendors: number, columns: number): string {
  return `${counted(vendors, 'vendor')}, ${counted(columns, 'column')}`;
}

/** Today where the organizer is, which names the file: their evening is the server's tomorrow. */
export function localDay(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const exportUrl = (marketId: string) => `/markets/${encodeURIComponent(marketId)}/vendor-export`;

/** The count, header and first rows the filters keep, and what the market offers. */
export async function fetchExportPreview(
  marketId: string,
  filters: ExportFilters,
  columns?: string[],
): Promise<ExportPreview> {
  const { data } = await api.post<ExportPreview>(`${exportUrl(marketId)}/preview`, {
    filters,
    ...(columns ? { columns } : {}),
  });
  return data;
}

/** Download the file; the error the server gave when it refuses, else null. */
export async function downloadExport(
  marketId: string,
  filters: ExportFilters,
  columns: string[],
): Promise<string | null> {
  try {
    const response = await api.post(
      exportUrl(marketId),
      { filters, columns, day: localDay() },
      { responseType: 'blob' },
    );
    saveCsv(response, `vendors_${localDay()}.csv`);
    return null;
  } catch (err: unknown) {
    return downloadErrorMessage(err, 'The export could not be downloaded.');
  }
}
