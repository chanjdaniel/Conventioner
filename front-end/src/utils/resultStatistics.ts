/**
 * The Result page's statistics as a ledger of bars (E35/F03/S01): per date, section, tier and table
 * size, each count with its share of all placements and a bar against the largest in its group, so
 * the busiest day and the fuller section read before the numbers do. Layout A of the two shown,
 * chosen 2026-10-20. The counts are the server's; nothing here adds or drops one.
 */
import type { AssignmentStatistics } from '@/assets/types/datatypes';
import { ledgerRows, type Counted, type LedgerRow } from '@/utils/barLedger';
import { getShortDate } from '@/utils/utils';

/** The result filter a row narrows the tables to when chosen. */
export type LedgerFilter = 'date' | 'section' | 'tier' | 'choice';

export interface LedgerGroup {
  title: string;
  filter: LedgerFilter;
  rows: LedgerRow[];
}

/**
 * Half tables are one table size to the organizer, whichever side they sit on, so the sides the
 * statistics count apart are added together - and the grid's filter knows them as `half`.
 */
function tableSizes(perChoice: Record<string, number>): Counted[] {
  const merged = new Map<string, Counted>();
  for (const [choice, count] of Object.entries(perChoice)) {
    const half = choice.toLowerCase().includes('half');
    const value = half ? 'half' : 'full';
    const entry = merged.get(value) ?? {
      label: half ? 'Half table' : 'Full table',
      value,
      count: 0,
    };
    merged.set(value, { ...entry, count: entry.count + count });
  }
  return [...merged.values()];
}

export function statisticsLedger(statistics: AssignmentStatistics): LedgerGroup[] {
  const total = statistics.totalAssignments ?? 0;
  const group = (title: string, filter: LedgerFilter, entries: Counted[]): LedgerGroup => ({
    title,
    filter,
    rows: ledgerRows(entries, total),
  });
  const named = (counts: Record<string, number> | undefined): Counted[] =>
    Object.entries(counts ?? {}).map(([name, count]) => ({ label: name, value: name, count }));

  return [
    group(
      'Per date',
      'date',
      Object.entries(statistics.assignmentsPerDate ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ label: getShortDate(date), value: date, count })),
    ),
    group('Per section', 'section', named(statistics.assignmentsPerSection)),
    group('Per tier', 'tier', named(statistics.assignmentsPerTier)),
    group('Per table size', 'choice', tableSizes(statistics.assignmentsPerTableChoice ?? {})),
  ];
}
