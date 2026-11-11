/**
 * Who applied, as the Stats tab counts it (E45/F01/S01): the server's counts by stored status, read
 * as the Applications tab's All view filters, each a part of the review's split bar. When they
 * applied is drawn over time by `appliedOverTime.ts`, tested beside it.
 */
import { describe, expect, it } from 'vitest';
import { ApplicationStatus, type Application } from '@/assets/types/datatypes';
import { applicantStats, type ApplicantCounts } from '@/utils/applicantStats';
import { ALL_VIEW_FILTERS, allViewApplications } from '@/utils/reviewQueue';

let next = 0;
function app(status: ApplicationStatus, submittedAt?: string, added = false): Application {
  next += 1;
  return {
    id: `app-${next}`,
    marketId: 'm1',
    applicantEmail: `vendor${next}@example.com`,
    formData: {},
    status,
    applicationType: 'main',
    submittedAt,
    updatedAt: '2026-09-10T12:00:00',
    ...(added ? { addedBy: { email: 'alex@market.test' }, addedAt: '2026-11-18T09:00:00' } : {}),
  } as Application;
}

/** What the server sends for these applications (`back-end/market_stats.py#count_applicants`). */
function counted(applications: Application[]): ApplicantCounts {
  const statuses: Record<string, number> = {};
  for (const a of applications) statuses[a.status] = (statuses[a.status] ?? 0) + 1;
  const applied = applications.filter((a) => !a.addedBy);
  return {
    total: applications.length,
    addedByHand: applications.length - applied.length,
    statuses,
    submittedAt: applied.flatMap((a) => (a.submittedAt ? [a.submittedAt] : [])),
    openedAt: null,
    closedAt: null,
  };
}

// Local times, so the day each falls on is the same wherever the suite runs.
const APPS = [
  app(ApplicationStatus.Open, '2026-09-01T09:00:00'),
  app(ApplicationStatus.UnderReview, '2026-09-01T23:30:00'),
  app(ApplicationStatus.NeedsFollowUp, '2026-09-03T10:00:00'),
  app(ApplicationStatus.ReviewerApproved, '2026-09-03T11:00:00'),
  app(ApplicationStatus.ReviewerApproved, '2026-09-03T12:00:00'),
  app(ApplicationStatus.ReviewerRejected, '2026-09-02T08:00:00'),
  app(ApplicationStatus.ReviewerApproved, '2026-11-18T09:00:00', true),
];

describe('who applied', () => {
  const stats = applicantStats(counted(APPS), 'm1');
  const row = (label: string) => stats.byStatus.find((r) => r.label === label)!;

  it('counts every application, and those added by hand apart', () => {
    expect(stats.total).toBe(7);
    expect(stats.addedByHand).toBe(1);
    expect(stats.applied).toBe(6);
  });

  it("counts each status as the Applications tab's All view filters it", () => {
    expect(stats.byStatus.map((r) => [r.label, r.count])).toEqual([
      ['Open', 2],
      ['Needs follow-up', 1],
      ['Approved', 3],
      ['Rejected', 1],
    ]);
    // The same filter, so the two pages can never disagree.
    for (const filter of ALL_VIEW_FILTERS.filter((f) => f.id !== 'all')) {
      const counted = stats.byStatus.find((r) => r.value === filter.id)!;
      expect(counted.count).toBe(allViewApplications(APPS, filter.id, false, '').length);
    }
  });

  it('opens the All view on that filter from each status, on every reviewer’s share', () => {
    // The count is everyone's, so a chosen reviewer is not landed on their own share (E38/F07/S04).
    expect(row('Needs follow-up').to).toEqual({
      path: '/markets/m1/applications',
      query: { view: 'all', status: 'needs_follow_up', reviewer: 'anyone' },
    });
    expect(row('Open').to).toEqual({
      path: '/markets/m1/applications',
      query: { view: 'all', status: 'undecided', reviewer: 'anyone' },
    });
  });

  it("fills each status in its own colour, in the All view's order", () => {
    expect(stats.byStatus.map((r) => [r.label, r.fill])).toEqual([
      ['Open', '--mm-blue'],
      ['Needs follow-up', '--mm-chart-yellow'],
      ['Approved', '--mm-green'],
      ['Rejected', '--mm-red'],
    ]);
  });

  it('still counts a status the All view has no filter for, so the rows add up', () => {
    const odd = applicantStats(
      counted([...APPS, app(ApplicationStatus.Cancelled, '2026-09-04T10:00:00')]),
      'm1',
    );
    const cancelled = odd.byStatus.find((r) => r.label === 'Cancelled')!;
    expect(cancelled.count).toBe(1);
    expect(cancelled.to).toBeUndefined();
    expect(cancelled.fill).toBe('--mm-text-muted');
    expect(odd.byStatus.reduce((sum, r) => sum + r.count, 0)).toBe(odd.total);
  });

  it('is nothing for a market nobody has applied to', () => {
    const none = applicantStats(counted([]), 'm1');
    expect(none.total).toBe(0);
    expect(none.byStatus.every((r) => r.count === 0)).toBe(true);
  });
});
