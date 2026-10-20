/**
 * The Result page's statistics as a ledger of bars (E35/F03/S01): per date, section, tier and table
 * size, each count with its share of all placements and a bar against the largest in its group, so
 * the busiest day and the fuller section read before the numbers do. Layout A of the two shown,
 * chosen 2026-10-20. The counts are the server's; nothing here adds or drops one.
 */
import type { AssignmentStatistics } from '@/assets/types/datatypes';
import { getShortDate } from '@/utils/utils';

/** The result filter a row narrows the tables to when chosen. */
export type LedgerFilter = 'date' | 'section' | 'tier' | 'choice';

export interface LedgerRow {
  label: string;
  /** What the row sets its filter to. */
  value: string;
  count: number;
  /** Its share of all placements, a whole percent. */
  share: number;
  /** Its bar, as a percent of the largest count in its group. */
  bar: number;
}

export interface LedgerGroup {
  title: string;
  filter: LedgerFilter;
  rows: LedgerRow[];
}

/**
 * Half tables are one table size to the organizer, whichever side they sit on, so the sides the
 * statistics count apart are added together - and the grid's filter knows them as `half`.
 */
function tableSizes(perChoice: Record<string, number>): Array<[string, string, number]> {
  const merged = new Map<string, [string, string, number]>();
  for (const [choice, count] of Object.entries(perChoice)) {
    const half = choice.toLowerCase().includes('half');
    const key = half ? 'half' : 'full';
    const entry = merged.get(key) ?? [half ? 'Half table' : 'Full table', key, 0];
    entry[2] += count;
    merged.set(key, entry);
  }
  return [...merged.values()];
}

export function statisticsLedger(statistics: AssignmentStatistics): LedgerGroup[] {
  const total = statistics.totalAssignments ?? 0;
  const group = (
    title: string,
    filter: LedgerFilter,
    entries: Array<[string, string, number]>,
  ): LedgerGroup => {
    const largest = Math.max(0, ...entries.map(([, , count]) => count));
    return {
      title,
      filter,
      rows: entries.map(([label, value, count]) => ({
        label,
        value,
        count,
        share: total ? Math.round((count / total) * 100) : 0,
        bar: largest ? (count / largest) * 100 : 0,
      })),
    };
  };
  const named = (counts: Record<string, number> | undefined): Array<[string, string, number]> =>
    Object.entries(counts ?? {}).map(([name, count]) => [name, name, count]);

  return [
    group(
      'Per date',
      'date',
      Object.entries(statistics.assignmentsPerDate ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => [getShortDate(date), date, count]),
    ),
    group('Per section', 'section', named(statistics.assignmentsPerSection)),
    group('Per tier', 'tier', named(statistics.assignmentsPerTier)),
    group('Per table size', 'choice', tableSizes(statistics.assignmentsPerTableChoice ?? {})),
  ];
}
