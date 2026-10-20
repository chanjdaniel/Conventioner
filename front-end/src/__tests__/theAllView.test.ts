/**
 * The All view of the review (E34/F04/S01): every application, filtered by status - follow-ups
 * included - and by "Mine", the follow-ups the viewer owns.
 */
import { describe, expect, it } from 'vitest';
import { ApplicationStatus, type Application } from '@/assets/types/datatypes';
import { ALL_VIEW_FILTERS, allViewApplications, allViewFilter } from '@/utils/reviewQueue';

const app = (id: string, status: ApplicationStatus, owner?: string): Application =>
  ({
    id,
    applicantEmail: `${id}@x.test`,
    status,
    submittedAt: '2026-05-01',
    formData: {},
    followUpOwner: owner ? { email: owner } : null,
  }) as Application;

const APPS = [
  app('a', ApplicationStatus.Open),
  app('b', ApplicationStatus.UnderReview),
  app('c', ApplicationStatus.NeedsFollowUp, 'alex@market.test'),
  app('d', ApplicationStatus.NeedsFollowUp, 'sam@market.test'),
  app('e', ApplicationStatus.ReviewerApproved),
  app('f', ApplicationStatus.ReviewerRejected),
];

const ids = (filter: string, mine = false) =>
  allViewApplications(APPS, allViewFilter(filter), mine, 'alex@market.test').map((a) => a.id);

describe('the All view', () => {
  it('lists every application by default', () => {
    expect(ids('all')).toHaveLength(6);
  });

  it('filters by status, the undecided together', () => {
    expect(ids('undecided')).toEqual(['a', 'b']);
    expect(ids('needs_follow_up')).toEqual(['c', 'd']);
    expect(ids('reviewer_approved')).toEqual(['e']);
    expect(ids('reviewer_rejected')).toEqual(['f']);
  });

  it('narrows to the follow-ups the viewer owns with Mine', () => {
    expect(ids('all', true)).toEqual(['c']);
    expect(ids('needs_follow_up', true)).toEqual(['c']);
  });

  it('reads an unknown filter in the address as every application', () => {
    expect(allViewFilter('nonsense')).toBe('all');
    expect(ALL_VIEW_FILTERS.map((f) => f.id)).toContain('needs_follow_up');
  });
});
