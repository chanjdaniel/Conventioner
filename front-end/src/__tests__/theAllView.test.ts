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
  allViewLists,
  heldElsewhere,
  notSelectedLine,
  reviewView,
  selectAll,
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

describe('Select all (E38/F05/S02)', () => {
  const held = (id: string, status: ApplicationStatus, holder: string): Application =>
    ({ ...app(id, status), heldBy: { email: holder } }) as Application;
  const ROWS = [
    app('a', ApplicationStatus.Open),
    held('b', ApplicationStatus.Open, 'sam@market.test'),
    held('c', ApplicationStatus.UnderReview, 'Alex@Market.test'),
    app('d', ApplicationStatus.ReviewerApproved),
  ];

  it('ticks every row the filter shows, and nothing it hides', () => {
    const shown = allViewApplications(ROWS, 'undecided', false, 'alex@market.test');
    expect(selectAll(shown, 'alex@market.test').ids).toEqual(['a', 'c']);
  });

  it('skips the rows another reviewer has open, and counts them', () => {
    expect(selectAll(ROWS, 'alex@market.test')).toEqual({
      ids: ['a', 'c', 'd'],
      held: 1,
      decided: 0,
    });
  });

  it('skips the rows already approved or rejected for someone who may not change a verdict (E38/F06/S01)', () => {
    expect(selectAll(ROWS, 'alex@market.test', false)).toEqual({
      ids: ['a', 'c'],
      held: 1,
      decided: 1,
    });
    // A row held elsewhere is said once, as held, whatever its verdict.
    const heldAndDecided = held('e', ApplicationStatus.ReviewerRejected, 'sam@market.test');
    expect(selectAll([heldAndDecided], 'alex@market.test', false)).toEqual({
      ids: [],
      held: 1,
      decided: 0,
    });
  });

  it("reads a row the viewer has open as theirs, whatever the address's case", () => {
    expect(heldElsewhere(ROWS[2], 'alex@market.test')).toBeNull();
    expect(heldElsewhere(ROWS[1], 'alex@market.test')).toBe('sam@market.test');
    expect(heldElsewhere(ROWS[0], 'alex@market.test')).toBeNull();
  });
});

describe('what Select all left out, in words (E38/F05/S02, E38/F06/S01)', () => {
  const WHO = 'an Admin or the owner';

  it('says nothing when it left nothing out', () => {
    expect(notSelectedLine(0, 0, WHO)).toBeNull();
  });

  it('says the rows another reviewer has open', () => {
    expect(notSelectedLine(1, 0, WHO)).toBe(
      '1 application not selected: another reviewer has it open.',
    );
    expect(notSelectedLine(2, 0, WHO)).toBe(
      '2 applications not selected: another reviewer has them open.',
    );
  });

  it('says the rows already decided, and who may change them', () => {
    expect(notSelectedLine(0, 1, WHO)).toBe(
      '1 application not selected: it already has a verdict, which only an Admin or the owner may change.',
    );
    expect(notSelectedLine(0, 3, null)).toBe(
      '3 applications not selected: they already have a verdict, which you may not change.',
    );
  });

  it('says both, each in its own clause', () => {
    expect(notSelectedLine(1, 2, WHO)).toBe(
      '3 applications not selected: another reviewer has 1 open, and 2 already have a verdict, which only an Admin or the owner may change.',
    );
  });
});

describe('the All view narrowed to a reviewer’s share (E38/F07/S04)', () => {
  const dealt = (
    id: string,
    status: ApplicationStatus,
    reviewer: string | null,
    owner?: string,
  ): Application => ({
    ...app(id, status, owner),
    reviewer: reviewer ? { userId: reviewer, email: reviewer } : null,
  });
  const SHARES = [
    dealt('a', ApplicationStatus.Open, 'alex@market.test'),
    dealt('b', ApplicationStatus.Open, 'Sam@Market.test'),
    dealt('c', ApplicationStatus.NeedsFollowUp, 'alex@market.test', 'alex@market.test'),
    dealt('d', ApplicationStatus.NeedsFollowUp, 'sam@market.test', 'alex@market.test'),
    dealt('e', ApplicationStatus.ReviewerApproved, 'alex@market.test'),
    dealt('f', ApplicationStatus.ReviewerRejected, null),
  ];
  const shareIds = (reviewer: string | null, filter = 'all', mine = false) =>
    allViewApplications(SHARES, allViewFilter(filter), mine, 'alex@market.test', reviewer).map(
      (a) => a.id,
    );

  it('lists only the applications dealt to the reviewer named, decided ones included', () => {
    expect(shareIds('sam@market.test')).toEqual(['b', 'd']);
  });

  it('counts a follow-up the reviewer named owns in their share, whoever reads it', () => {
    const owned = [
      ...SHARES,
      dealt('g', ApplicationStatus.NeedsFollowUp, 'alex@market.test', 'sam@market.test'),
    ];
    const ids = (reviewer: string) =>
      allViewApplications(owned, allViewFilter('all'), false, 'alex@market.test', reviewer).map(
        (a) => a.id,
      );
    // Alex reads Sam's share: Sam's follow-up on Alex's share is in both.
    expect(ids('sam@market.test')).toEqual(['b', 'd', 'g']);
    expect(ids('alex@market.test')).toEqual(['a', 'c', 'd', 'e', 'g']);
  });

  it('counts a follow-up the reader owns in their own share, whoever it was dealt to', () => {
    expect(shareIds('alex@market.test')).toEqual(['a', 'c', 'd', 'e']);
    expect(shareIds('ALEX@market.test ')).toEqual(['a', 'c', 'd', 'e']);
  });

  it('lists every application for nobody named, those never dealt included', () => {
    expect(shareIds(null)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('narrows together with the status filter and Mine', () => {
    expect(shareIds('alex@market.test', 'undecided')).toEqual(['a']);
    expect(shareIds('sam@market.test', 'needs_follow_up')).toEqual(['d']);
    expect(shareIds('alex@market.test', 'all', true)).toEqual(['c', 'd']);
    expect(shareIds('sam@market.test', 'all', true)).toEqual(['d']);
  });

  it('lists nothing for a reviewer dealt nothing', () => {
    expect(shareIds('ben@market.test')).toEqual([]);
  });

  it('leaves the Stats tab’s test by status alone', () => {
    expect(allViewLists.length).toBe(2);
    expect(allViewLists('undecided', ApplicationStatus.Open)).toBe(true);
    expect(allViewLists('undecided', ApplicationStatus.NeedsFollowUp)).toBe(false);
  });
});
