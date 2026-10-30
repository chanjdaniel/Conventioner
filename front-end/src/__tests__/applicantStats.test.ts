/**
 * Who applied, as the Stats tab counts it (E45/F01/S01): the server's counts by stored status, read
 * as the Applications tab's All view filters, and the times each applied, read as days in the
 * reader's own calendar.
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

  it('opens the All view on that filter from each status', () => {
    expect(row('Needs follow-up').to).toEqual({
      path: '/markets/m1/applications',
      query: { view: 'all', status: 'needs_follow_up' },
    });
    expect(row('Open').to).toEqual({
      path: '/markets/m1/applications',
      query: { view: 'all', status: 'undecided' },
    });
  });

  it('gives each status its share of all applications, and a bar against the largest', () => {
    expect(row('Approved').share).toBe(43);
    expect(row('Approved').bar).toBe(100);
    expect(row('Open').bar).toBeCloseTo(66.67, 1);
  });

  it('still counts a status the All view has no filter for, so the rows add up', () => {
    const odd = applicantStats(
      counted([...APPS, app(ApplicationStatus.Cancelled, '2026-09-04T10:00:00')]),
      'm1',
    );
    const cancelled = odd.byStatus.find((r) => r.label === 'Cancelled')!;
    expect(cancelled.count).toBe(1);
    expect(cancelled.to).toBeUndefined();
    expect(odd.byStatus.reduce((sum, r) => sum + r.count, 0)).toBe(odd.total);
  });

  it('counts the days people applied on, earliest first, leaving out those added by hand', () => {
    expect(stats.byDay.map((r) => [r.value, r.label, r.count])).toEqual([
      ['2026-09-01', 'Sep 1, 2026', 2],
      ['2026-09-02', 'Sep 2, 2026', 1],
      ['2026-09-03', 'Sep 3, 2026', 3],
    ]);
    expect(stats.byDay.map((r) => r.share)).toEqual([33, 17, 50]);
    expect(stats.byDay.every((r) => r.to === undefined)).toBe(true);
  });

  it("reads a day in the reader's own calendar, not the server's", () => {
    const at = new Date(2026, 8, 5, 23, 45).toISOString();
    expect(applicantStats(counted([app(ApplicationStatus.Open, at)]), 'm1').byDay[0].value).toBe(
      '2026-09-05',
    );
  });

  it('puts a time it cannot read on no day', () => {
    const odd = applicantStats({ ...counted(APPS), submittedAt: ['not a time'] }, 'm1');
    expect(odd.byDay).toEqual([]);
  });

  it('is nothing for a market nobody has applied to', () => {
    const none = applicantStats(counted([]), 'm1');
    expect(none.total).toBe(0);
    expect(none.byDay).toEqual([]);
    expect(none.byStatus.every((r) => r.count === 0 && r.share === 0 && r.bar === 0)).toBe(true);
  });
});
