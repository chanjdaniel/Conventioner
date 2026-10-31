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

/**
 * The All view's "Assigned to" filter (E38/F07/S04): whose share the rows show, as the address
 * names it (`?reviewer=`) - the reader's own (`me`), everyone's (`anyone`), or a chosen reviewer's
 * address.
 */
export type AssignedTo = 'me' | 'anyone' | (string & {});

/**
 * What the filter offers the reader: "Me" only to a chosen reviewer, "Anyone", and each other
 * reviewer by address, the reader's own being "Me". None with no reviewers chosen: the filter is
 * not there.
 */
export function assignedToOptions(
  reader: string,
  market: Team,
): Array<{ value: AssignedTo; label: string }> {
  const reviewers = reviewerAddresses(market);
  if (!reviewers.length) return [];
  const chosen = reviewers.some((address) => same(address, reader));
  return [
    ...(chosen ? [{ value: 'me', label: 'Me' }] : []),
    { value: 'anyone', label: 'Anyone' },
    ...reviewers
      .filter((address) => !same(address, reader))
      .map((address) => ({ value: address, label: address })),
  ];
}

/**
 * What the filter is set to, or null with no reviewers chosen. With nothing in the address it is
 * "Me" for a chosen reviewer, who lands on their own work, and "Anyone" for everyone else, an Admin
 * overseeing the review among them; an address naming nobody it offers reads as that default.
 */
export function assignedTo(asked: unknown, reader: string, market: Team): AssignedTo | null {
  const options = assignedToOptions(reader, market);
  if (!options.length) return null;
  const value = typeof asked === 'string' ? asked : '';
  if (value && same(value, reader) && options[0].value === 'me') return 'me';
  return (options.find((option) => same(option.value, value)) ?? options[0]).value;
}

/** The address the rows narrow to: the reader's for "Me", the reviewer's named, none for Anyone. */
export function assignedAddress(choice: AssignedTo | null, reader: string): string | null {
  if (!choice || choice === 'anyone') return null;
  return choice === 'me' ? reader : choice;
}
