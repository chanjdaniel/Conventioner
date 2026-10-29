/**
 * Who applied, as the Stats tab counts it (E45/F01/S01): every application by its status and by the
 * day it arrived.
 *
 * Read from the server's counts (`GET /markets/:id/stats`, `back-end/market_stats.py`), so the
 * page never downloads the applications to count them: every application by its stored status, how
 * many were added by hand, and the time each of the others applied. The statuses are counted into
 * the Applications tab's All view filters through the All view's own test (`allViewLists`), so the
 * two pages can never disagree: a status row's count is what its filter lists, and the row opens
 * it. A vendor added by hand never applied, so they are counted apart and on no day, while their
 * status is the approval the adding gave them, as the All view shows it.
 *
 * A day is the reader's calendar day, as every "today" in the app is (`calendarToday`): the server
 * keeps no time zone for a market, so it sends times and the page makes them days.
 */
import { marketPath } from '@/utils/market';
import { calendarToday } from '@/utils/marketGuide';
import { ledgerRows, type Counted, type LedgerRow } from '@/utils/barLedger';
import { ALL_VIEW_FILTERS, allViewLists } from '@/utils/reviewQueue';
import { getShortDate } from '@/utils/utils';
import { statusLabel } from '@/utils/verdicts';

/** Who applied, as the server counts them. */
export interface ApplicantCounts {
  /** Every application, those added by hand among them. */
  total: number;
  addedByHand: number;
  /** Every application by its stored status. */
  statuses: Record<string, number>;
  /** When each that was not added by hand applied, as stored. */
  submittedAt: string[];
}

export interface ApplicantStats {
  /** Every application, those added by hand among them. */
  total: number;
  /** Those who applied, on the market's page or in an imported form. */
  applied: number;
  addedByHand: number;
  /** By status, in the All view's order; shares are of `total`. */
  byStatus: LedgerRow[];
  /** By the day each applied, earliest first; shares are of `applied`. */
  byDay: LedgerRow[];
}

export function applicantStats(counts: ApplicantCounts, marketId: string): ApplicantStats {
  const { total, addedByHand } = counts;
  const statuses = Object.entries(counts.statuses);
  const filters = ALL_VIEW_FILTERS.filter((filter) => filter.id !== 'all');
  const filtered: Counted[] = filters.map((filter) => ({
    label: filter.label,
    value: filter.id,
    count: statuses
      .filter(([status]) => allViewLists(filter.id, status))
      .reduce((sum, [, count]) => sum + count, 0),
    to: { path: marketPath(marketId, 'applications'), query: { view: 'all', status: filter.id } },
  }));

  // A status no filter lists is still counted, so the rows add up to every application.
  const others: Counted[] = statuses
    .filter(([status]) => !filters.some((filter) => allViewLists(filter.id, status)))
    .map(([status, count]) => ({ label: statusLabel(status), value: status, count }));

  const applied = total - addedByHand;
  const perDay = new Map<string, number>();
  for (const submitted of counts.submittedAt) {
    const at = new Date(submitted);
    if (Number.isNaN(at.getTime())) continue;
    const day = calendarToday(at);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const days: Counted[] = [...perDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ label: getShortDate(day), value: day, count }));

  return {
    total,
    applied,
    addedByHand,
    byStatus: ledgerRows([...filtered, ...others], total),
    byDay: ledgerRows(days, applied),
  };
}
