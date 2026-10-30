/**
 * Whose share an application is, for the reader (E38/F07/S03, ADR 0020).
 *
 * With reviewers chosen, every row and card names the reviewer an application was dealt to, and
 * deciding one dealt to someone else carries a warning on the card - never a dialog to click
 * through, since helping a reviewer who is behind should stay easy. The words live here, so the All
 * view's rows, its drawer, One by one's card and a selection's confirmation say them alike.
 */
import { ApplicationStatus, type Application, type Market } from '@/assets/types/datatypes';
import { reviewerAddresses } from '@/utils/reviewTeam';

/** Not decided yet, so whose share it is still matters: open, or waiting on a follow-up. */
const UNDECIDED: readonly string[] = [
  ApplicationStatus.Open,
  ApplicationStatus.UnderReview,
  ApplicationStatus.NeedsFollowUp,
];

type Dealt = Pick<Application, 'status' | 'reviewer'>;
type Team = Pick<Market, 'reviewTeam'> | null | undefined;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Whom the application was dealt to, while reviewers are chosen: with none, it is first come,
 * first served again, and a follow-up's reviewer kept from before names nobody's share.
 */
function dealtTo(application: Dealt, market: Team): string | null {
  if (!reviewerAddresses(market).length) return null;
  return application.reviewer?.email || null;
}

/** "Reviewer: sam@example.com", or "Reviewer: you" for the reader's own; null when not dealt. */
export function reviewerLine(application: Dealt, reader: string, market: Team): string | null {
  const reviewer = dealtTo(application, market);
  if (!reviewer) return null;
  return `Reviewer: ${same(reviewer, reader) ? 'you' : reviewer}`;
}

/**
 * The address of the reviewer an undecided application is dealt to, when that is not the reader;
 * null for the reader's own, a decided application (deciding it again is a change, not a share)
 * and one never dealt.
 */
export function dealtElsewhere(application: Dealt, reader: string, market: Team): string | null {
  const reviewer = dealtTo(application, market);
  if (!reviewer || !UNDECIDED.includes(application.status)) return null;
  return same(reviewer, reader) ? null : reviewer;
}

/** The warning above the verdict buttons of an application dealt to someone else. */
export function dealtWarning(reviewer: string): string {
  return `This application is dealt to ${reviewer}. If you decide it, its history will say you decided it for them.`;
}

/** What a selection's confirmation adds for the ticked rows dealt to others; null for none. */
export function selectionDealtLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? '1 of them is dealt to another reviewer; its history will say you decided it.'
    : `${count} of them are dealt to other reviewers; their history will say you decided them.`;
}
