import { describe, expect, it } from 'vitest';

import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { dealtElsewhere, dealtWarning, reviewerLine, selectionDealtLine } from '@/utils/reviewers';

/**
 * Whose share an application is, for the reader, and the warning on deciding someone else's
 * (E38/F07/S03): one utility, so the row, the card, the drawer and a selection say it alike.
 */
const SAM = 'sam@example.com';
const ANA = 'ana@example.com';

const chosen: Pick<Market, 'reviewTeam'> = {
  reviewTeam: {
    reviewers: [
      { email: ANA, able: true },
      { email: SAM, able: true },
    ],
  },
};
const noneChosen: Pick<Market, 'reviewTeam'> = { reviewTeam: { reviewers: [] } };

function application(
  status: ApplicationStatus,
  reviewer: string | null,
): Pick<Application, 'status' | 'reviewer'> {
  return { status, reviewer: reviewer ? { userId: 'u', email: reviewer } : null };
}

describe('reviewerLine', () => {
  it('names the reviewer an application was dealt to', () => {
    expect(reviewerLine(application(ApplicationStatus.Open, SAM), ANA, chosen)).toBe(
      `Reviewer: ${SAM}`,
    );
  });

  it('says "you" for the reader’s own, whatever the case of either address', () => {
    expect(reviewerLine(application(ApplicationStatus.Open, 'Sam@Example.com'), SAM, chosen)).toBe(
      'Reviewer: you',
    );
  });

  it('names the reviewer of a decided application too: it stays the record of whose it was', () => {
    expect(reviewerLine(application(ApplicationStatus.ReviewerApproved, SAM), ANA, chosen)).toBe(
      `Reviewer: ${SAM}`,
    );
  });

  it('says nothing for an application never dealt', () => {
    expect(reviewerLine(application(ApplicationStatus.Open, null), ANA, chosen)).toBeNull();
  });

  it('says nothing with no reviewers chosen, even on one dealt before', () => {
    expect(reviewerLine(application(ApplicationStatus.Open, SAM), ANA, noneChosen)).toBeNull();
    expect(reviewerLine(application(ApplicationStatus.Open, SAM), ANA, null)).toBeNull();
  });
});

describe('dealtElsewhere', () => {
  it('answers whom an open application is dealt to, when that is someone else', () => {
    expect(dealtElsewhere(application(ApplicationStatus.Open, SAM), ANA, chosen)).toBe(SAM);
    expect(dealtElsewhere(application(ApplicationStatus.UnderReview, SAM), ANA, chosen)).toBe(SAM);
  });

  it('counts a follow-up as someone else’s too: it is not decided yet', () => {
    expect(dealtElsewhere(application(ApplicationStatus.NeedsFollowUp, SAM), ANA, chosen)).toBe(
      SAM,
    );
  });

  it('answers null for the reader’s own, compared in lower case', () => {
    expect(
      dealtElsewhere(
        application(ApplicationStatus.Open, 'SAM@example.com'),
        'sam@EXAMPLE.com',
        chosen,
      ),
    ).toBeNull();
  });

  it('answers null for a decided application: deciding it again is a change, not a share', () => {
    for (const status of [ApplicationStatus.ReviewerApproved, ApplicationStatus.ReviewerRejected]) {
      expect(dealtElsewhere(application(status, SAM), ANA, chosen)).toBeNull();
    }
  });

  it('answers null for an application with no reviewer', () => {
    expect(dealtElsewhere(application(ApplicationStatus.Open, null), ANA, chosen)).toBeNull();
  });

  it('answers null with no reviewers chosen: a follow-up keeps its reviewer, but nothing is dealt', () => {
    expect(
      dealtElsewhere(application(ApplicationStatus.NeedsFollowUp, SAM), ANA, noneChosen),
    ).toBeNull();
  });
});

describe('the warning’s words', () => {
  it('names whose the application is, and what its history will say', () => {
    expect(dealtWarning(SAM)).toBe(
      `This application is dealt to ${SAM}. If you decide it, its history will say you decided it for them.`,
    );
  });

  it('counts the ticked rows dealt to others in a selection’s confirmation', () => {
    expect(selectionDealtLine(3)).toBe(
      '3 of them are dealt to other reviewers; their history will say you decided them.',
    );
    expect(selectionDealtLine(1)).toBe(
      '1 of them is dealt to another reviewer; its history will say you decided it.',
    );
  });

  it('says nothing when no ticked row is dealt to someone else', () => {
    expect(selectionDealtLine(0)).toBeNull();
  });
});
