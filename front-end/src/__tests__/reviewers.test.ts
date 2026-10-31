import { describe, expect, it } from 'vitest';

import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import {
  assignedAddress,
  assignedTo,
  assignedToOptions,
  dealtElsewhere,
  dealtWarning,
  myShare,
  reviewerLine,
  selectionDealtLine,
} from '@/utils/reviewers';

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
  owner?: string,
): Pick<Application, 'status' | 'reviewer' | 'followUpOwner'> {
  return {
    status,
    reviewer: reviewer ? { userId: 'u', email: reviewer } : null,
    followUpOwner: owner ? { userId: 'o', email: owner } : null,
  };
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

  it('answers null to the owner of a follow-up dealt to someone else: it is in their share too', () => {
    expect(
      dealtElsewhere(
        application(ApplicationStatus.NeedsFollowUp, SAM, 'ANA@example.com'),
        ANA,
        chosen,
      ),
    ).toBeNull();
    // Owning it is a follow-up's alone: an open application keeps no owner's share.
    expect(dealtElsewhere(application(ApplicationStatus.Open, SAM, ANA), ANA, chosen)).toBe(SAM);
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

describe('the "Assigned to" filter (E38/F07/S04)', () => {
  const BEN = 'ben@example.com';

  it('offers Me to a chosen reviewer, then Anyone and each other reviewer by address', () => {
    expect(assignedToOptions(ANA, chosen)).toEqual([
      { value: 'me', label: 'Me' },
      { value: 'anyone', label: 'Anyone' },
      { value: SAM, label: SAM },
    ]);
  });

  it('offers Anyone and every reviewer to someone not chosen', () => {
    expect(assignedToOptions(BEN, chosen)).toEqual([
      { value: 'anyone', label: 'Anyone' },
      { value: ANA, label: ANA },
      { value: SAM, label: SAM },
    ]);
  });

  it('is absent with no reviewers chosen', () => {
    expect(assignedToOptions(ANA, noneChosen)).toEqual([]);
    expect(assignedTo(undefined, ANA, noneChosen)).toBeNull();
    expect(assignedTo('anyone', ANA, noneChosen)).toBeNull();
    expect(assignedTo(SAM, ANA, null)).toBeNull();
  });

  it('opens on Me for a chosen reviewer and on Anyone for anyone else', () => {
    expect(assignedTo(undefined, ANA, chosen)).toBe('me');
    expect(assignedTo(undefined, 'Ana@Example.com', chosen)).toBe('me');
    expect(assignedTo(undefined, BEN, chosen)).toBe('anyone');
  });

  it('reads what the address names', () => {
    expect(assignedTo('anyone', ANA, chosen)).toBe('anyone');
    expect(assignedTo('me', ANA, chosen)).toBe('me');
    expect(assignedTo(SAM, ANA, chosen)).toBe(SAM);
    expect(assignedTo('Sam@Example.COM', BEN, chosen)).toBe(SAM);
  });

  it('reads the reader’s own address as Me', () => {
    expect(assignedTo(ANA, ANA, chosen)).toBe('me');
  });

  it('reads an address naming nobody chosen, or Me for someone not chosen, as the default', () => {
    expect(assignedTo(BEN, ANA, chosen)).toBe('me');
    expect(assignedTo('nonsense', BEN, chosen)).toBe('anyone');
    expect(assignedTo('me', BEN, chosen)).toBe('anyone');
    expect(assignedTo(['me'], ANA, chosen)).toBe('me');
  });

  it('narrows to the reader for Me, to nobody for Anyone, and to the reviewer named', () => {
    expect(assignedAddress('me', ANA)).toBe(ANA);
    expect(assignedAddress('anyone', ANA)).toBeNull();
    expect(assignedAddress(null, ANA)).toBeNull();
    expect(assignedAddress(SAM, ANA)).toBe(SAM);
  });
});

describe('myShare (E38/F07/S04)', () => {
  const queue = [
    { id: 'a', ...application(ApplicationStatus.Open, ANA) },
    { id: 'b', ...application(ApplicationStatus.Open, SAM) },
    { id: 'c', ...application(ApplicationStatus.NeedsFollowUp, SAM, ANA) },
    { id: 'd', ...application(ApplicationStatus.NeedsFollowUp, ANA, SAM) },
  ];
  const ids = (reader: string, market = chosen) => myShare(queue, reader, market).map((a) => a.id);

  it('holds what was dealt to the reader and the follow-ups they own, wherever dealt', () => {
    expect(ids(ANA)).toEqual(['a', 'c', 'd']);
    expect(ids(SAM)).toEqual(['b', 'c', 'd']);
  });

  it('is empty for someone not chosen, and with nobody chosen', () => {
    expect(ids('cal@example.com')).toEqual([]);
    expect(ids(ANA, noneChosen)).toEqual([]);
  });
});
