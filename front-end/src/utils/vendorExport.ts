/**
 * The vendors, exported to a CSV (E42/F01/S01).
 *
 * The export dialog opens on what a page shows, so the file holds the vendors the organizer was
 * looking at; the server builds the file and its preview from the filters the dialog sends
 * (`POST /markets/:id/vendor-export`), and says which columns and filters the market offers.
 */
import { api } from '@/utils/api';
import { downloadErrorMessage, saveCsv } from '@/utils/download';
import { hasPlaceFilter, type ResultFilters, type VendorsShown } from '@/utils/resultFilters';

export type ExportStatus = 'open' | 'follow_up' | 'approved' | 'rejected' | 'added';

/** What narrows the vendors; an empty value narrows nothing. */
export interface ExportFilters {
  /** Any of these; none is any status. */
  statuses: ExportStatus[];
  /** Placed or not, on `date` or, with none, on any date. */
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

export interface ExportColumn {
  id: string;
  label: string;
}

/** What the market offers the dialog, as the server says it. */
export interface ExportOffered {
  columns: ExportColumn[];
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

/** One column in the dialog's list: ticked or not, where it stands in the list. */
export interface ColumnChoice extends ExportColumn {
  ticked: boolean;
}

/**
 * Every column the market offers: the ticked ones first, in the order named, so the file's order
 * reads from the top of the list; then the rest, in the market's order.
 */
export function columnChoices(offered: ExportColumn[], ticked: string[]): ColumnChoice[] {
  const first = ticked
    .map((id) => offered.find((column) => column.id === id))
    .filter((column): column is ExportColumn => Boolean(column));
  const rest = offered.filter((column) => !ticked.includes(column.id));
  return [
    ...first.map((column) => ({ ...column, ticked: true })),
    ...rest.map((column) => ({ ...column, ticked: false })),
  ];
}

/** The ticked columns, in the order the list puts them: the file's columns. */
export function chosenColumns(choices: ColumnChoice[]): string[] {
  return choices.filter((choice) => choice.ticked).map((choice) => choice.id);
}

/** The list with one column moved `by` places, never past either end. */
export function movedColumn(choices: ColumnChoice[], index: number, by: number): ColumnChoice[] {
  const to = index + by;
  if (to < 0 || to >= choices.length || by === 0) return choices;
  const next = choices.slice();
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
