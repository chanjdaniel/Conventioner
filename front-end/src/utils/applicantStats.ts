/**
 * Who applied, as the Stats tab counts it (E45/F01/S01): every application by its status, as the
 * parts of the review's split bar (T201).
 *
 * Read from the server's counts (`GET /markets/:id/stats`, `back-end/market_stats.py`), so the
 * page never downloads the applications to count them: every application by its stored status, how
 * many were added by hand, and the time each of the others applied. The statuses are counted into
 * the Applications tab's All view filters through the All view's own test (`allViewLists`), so the
 * two pages can never disagree: a part's count is what its filter lists, and its legend line opens
 * it, on every reviewer's share (E38/F07/S04). A vendor added by hand never applied, so they are
 * counted apart, while their status is the approval the adding gave them, as the All view shows it.
 * When the others applied is drawn over time by `appliedOverTime.ts`.
 */
import { marketPath } from '@/utils/market';
import type { IntakeTimes } from '@/utils/appliedOverTime';
import { ALL_VIEW_FILTERS, allViewLists, type AllViewFilter } from '@/utils/reviewQueue';
import type { SplitPart } from '@/utils/splitBar';
import { statusLabel } from '@/utils/verdicts';

/** Who applied, as the server counts them. */
export interface ApplicantCounts extends IntakeTimes {
  /** Every application, those added by hand among them. */
  total: number;
  addedByHand: number;
  /** Every application by its stored status. */
  statuses: Record<string, number>;
}

export interface ApplicantStats {
  /** Every application, those added by hand among them. */
  total: number;
  /** Those who applied, on the market's page or in an imported form. */
  applied: number;
  addedByHand: number;
  /** By status, in the All view's order, the parts of the review's split bar. */
  byStatus: SplitPart[];
}

/** Each filter's fill; Needs follow-up the chart's yellow, as the button's is under 3:1 on white. */
const FILLS: Record<Exclude<AllViewFilter, 'all'>, string> = {
  undecided: '--mm-blue',
  needs_follow_up: '--mm-chart-yellow',
  reviewer_approved: '--mm-green',
  reviewer_rejected: '--mm-red',
};
/** A status no filter lists, such as `cancelled`: grey, a part of the whole and of no filter. */
const OTHER_FILL = '--mm-chart-grey';

export function applicantStats(counts: ApplicantCounts, marketId: string): ApplicantStats {
  const { total, addedByHand } = counts;
  const statuses = Object.entries(counts.statuses);
  const filters = ALL_VIEW_FILTERS.filter((filter) => filter.id !== 'all');
  const filtered: SplitPart[] = filters.map((filter) => ({
    label: filter.label,
    value: filter.id,
    fill: FILLS[filter.id],
    count: statuses
      .filter(([status]) => allViewLists(filter.id, status))
      .reduce((sum, [, count]) => sum + count, 0),
    // On every reviewer's share, which the count is, not the one a chosen reviewer lands on.
    to: {
      path: marketPath(marketId, 'applications'),
      query: { view: 'all', status: filter.id, reviewer: 'anyone' },
    },
  }));

  // A status no filter lists is still counted, so the parts add up to every application.
  const others: SplitPart[] = statuses
    .filter(([status]) => !filters.some((filter) => allViewLists(filter.id, status)))
    .map(([status, count]) => ({
      label: statusLabel(status),
      value: status,
      count,
      fill: OTHER_FILL,
    }));

  return {
    total,
    applied: total - addedByHand,
    addedByHand,
    byStatus: [...filtered, ...others],
  };
}
