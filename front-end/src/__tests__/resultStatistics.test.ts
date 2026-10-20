/**
 * The statistics as a ledger of bars (E35/F03/S01, layout A, chosen 2026-10-20): the same counts as
 * before, each with its share of all placements and a bar against the largest in its group.
 */
import { describe, expect, it } from 'vitest';
import type { AssignmentStatistics } from '@/assets/types/datatypes';
import { statisticsLedger } from '@/utils/resultStatistics';

const STATS = {
  totalAssignments: 193,
  assignmentsPerDate: { '2026-11-20': 66, '2026-11-18': 64, '2026-11-19': 63 },
  assignmentsPerSection: { A: 101, B: 92 },
  assignmentsPerTier: { Gold: 101, Silver: 92 },
  assignmentsPerTableChoice: {
    'Full Table': 161,
    'Half Table (Left)': 16,
    'Half Table (Right)': 16,
  },
} as unknown as AssignmentStatistics;

describe('the statistics ledger', () => {
  const ledger = statisticsLedger(STATS);
  const group = (filter: string) => ledger.find((g) => g.filter === filter)!;

  it('has the four groups, each filtering the tables by its own key', () => {
    expect(ledger.map((g) => [g.title, g.filter])).toEqual([
      ['Per date', 'date'],
      ['Per section', 'section'],
      ['Per tier', 'tier'],
      ['Per table size', 'choice'],
    ]);
  });

  it('keeps the counts, dates in order, the halves as one', () => {
    expect(group('date').rows.map((r) => [r.value, r.count])).toEqual([
      ['2026-11-18', 64],
      ['2026-11-19', 63],
      ['2026-11-20', 66],
    ]);
    expect(group('choice').rows.map((r) => [r.label, r.value, r.count])).toEqual([
      ['Full table', 'full', 161],
      ['Half table', 'half', 32],
    ]);
  });

  it('gives each its share of all placements, and its bar against the largest in its group', () => {
    const [wed, , fri] = group('date').rows;
    expect(wed.share).toBe(33);
    expect(fri.bar).toBe(100);
    expect(wed.bar).toBeCloseTo((64 / 66) * 100);
  });

  it('draws no bar and no share where nothing was placed', () => {
    const empty = statisticsLedger({
      ...STATS,
      totalAssignments: 0,
      assignmentsPerSection: { A: 0 },
    } as AssignmentStatistics);
    const [a] = empty.find((g) => g.filter === 'section')!.rows;
    expect([a.share, a.bar]).toEqual([0, 0]);
  });
});
