/**
 * The All view of the review (E34/F04/S01): every application, filtered by status - follow-ups
 * included - and by "Mine", the follow-ups the viewer owns.
 */
import { describe, expect, it } from 'vitest';
import { ApplicationStatus, type Application } from '@/assets/types/datatypes';
import {
  ALL_VIEW_FILTERS,
  allViewApplications,
  allViewFilter,
  reviewView,
} from '@/utils/reviewQueue';
import { statusLabel } from '@/utils/verdicts';

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

describe('which view the review opens on (E38/F05/S01)', () => {
  it('opens on All with no view in the address', () => {
    expect(reviewView({})).toBe('all');
    expect(reviewView({ status: 'undecided' })).toBe('all');
  });

  it('keeps saved links to All working', () => {
    expect(reviewView({ view: 'all' })).toBe('all');
  });

  it('opens One by one by its own value', () => {
    expect(reviewView({ view: 'one' })).toBe('one');
  });

  it('opens One by one at a named application, as the Assignment tab links to it', () => {
    expect(reviewView({ application: 'app-7' })).toBe('one');
    expect(reviewView({ application: 'app-7', view: 'all' })).toBe('all');
  });

  it('calls the undecided status Open, as the status itself does, under its old address', () => {
    expect(ALL_VIEW_FILTERS.map((f) => f.label)).toEqual([
      'Any status',
      'Open',
      'Needs follow-up',
      'Approved',
      'Rejected',
    ]);
    expect(ALL_VIEW_FILTERS[1].id).toBe('undecided');
    expect(ALL_VIEW_FILTERS[1].label).toBe(statusLabel(ApplicationStatus.Open));
  });
});
