/**
 * Who applied, as the Stats tab counts it (E45/F01/S01): every application by its status and by the
 * day it arrived.
 *
 * Counted from the same list the Applications tab reads, through the All view's own filters, so the
 * two pages can never disagree: a status row's count is what its filter lists, and the row opens
 * it. A vendor added by hand never applied, so they are counted apart and on no day, while their
 * status is the approval the adding gave them, as the All view shows it.
 *
 * A day is the reader's calendar day, as every "today" in the app is (`calendarToday`): the server
 * keeps no time zone for a market.
 */
import type { Application } from '@/assets/types/datatypes';
import { marketPath } from '@/utils/market';
import { calendarToday } from '@/utils/marketGuide';
import { ledgerRows, type Counted, type LedgerRow } from '@/utils/barLedger';
import { ALL_VIEW_FILTERS, allViewApplications } from '@/utils/reviewQueue';
import { getShortDate } from '@/utils/utils';
import { statusLabel } from '@/utils/verdicts';

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

export function applicantStats(applications: Application[], marketId: string): ApplicantStats {
  const total = applications.length;
  const statuses = ALL_VIEW_FILTERS.filter((filter) => filter.id !== 'all');
  const filtered: Counted[] = statuses.map((filter) => ({
    label: filter.label,
    value: filter.id,
    count: allViewApplications(applications, filter.id, false, '').length,
    to: { path: marketPath(marketId, 'applications'), query: { view: 'all', status: filter.id } },
  }));

  // A status no filter lists is still counted, so the rows add up to every application.
  const listed = new Set(
    statuses.flatMap((filter) => allViewApplications(applications, filter.id, false, '')),
  );
  const unlisted = new Map<string, number>();
  for (const application of applications) {
    if (!listed.has(application)) {
      unlisted.set(application.status, (unlisted.get(application.status) ?? 0) + 1);
    }
  }
  const others: Counted[] = [...unlisted].map(([status, count]) => ({
    label: statusLabel(status),
    value: status,
    count,
  }));

  const appliedOnes = applications.filter((application) => !application.addedBy);
  const perDay = new Map<string, number>();
  for (const application of appliedOnes) {
    const at = application.submittedAt ? new Date(application.submittedAt) : null;
    if (!at || Number.isNaN(at.getTime())) continue;
    const day = calendarToday(at);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const days: Counted[] = [...perDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ label: getShortDate(day), value: day, count }));

  return {
    total,
    applied: appliedOnes.length,
    addedByHand: total - appliedOnes.length,
    byStatus: ledgerRows([...filtered, ...others], total),
    byDay: ledgerRows(days, appliedOnes.length),
  };
}
