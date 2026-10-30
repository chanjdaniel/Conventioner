import { ApplicationStatus, type Application } from '@/assets/types/datatypes';
import { getFormattedTimestamp } from '@/utils/utils';

/** An application's status in the organizer's words: the one map the review reads. */
const STATUS_LABELS: Record<ApplicationStatus, string> = {
  [ApplicationStatus.Open]: 'Open',
  [ApplicationStatus.UnderReview]: 'Under Review',
  [ApplicationStatus.ReviewerApproved]: 'Approved',
  [ApplicationStatus.ReviewerRejected]: 'Rejected',
  [ApplicationStatus.NeedsFollowUp]: 'Needs follow-up',
  [ApplicationStatus.Unassigned]: 'Unassigned',
  [ApplicationStatus.Assigned]: 'Assigned',
  [ApplicationStatus.AssignmentSent]: 'Assignment Sent',
  [ApplicationStatus.VendorAccepted]: 'Accepted',
  [ApplicationStatus.VendorRefused]: 'Refused',
  [ApplicationStatus.Cancelled]: 'Cancelled',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as ApplicationStatus] ?? status;
}

/*
 * A status is a chip, tinted, in the product's tones (bug 43). These were solid fills, so in the
 * reviewed list "Rejected" sat beside "Approve instead" as two filled pills in the same two
 * colours, and nothing said which was the verdict and which the action.
 */
const STATUS_TONES: Record<ApplicationStatus, string> = {
  [ApplicationStatus.Open]: 'informational',
  [ApplicationStatus.UnderReview]: 'attention',
  [ApplicationStatus.ReviewerApproved]: 'positive',
  [ApplicationStatus.ReviewerRejected]: 'destructive',
  [ApplicationStatus.NeedsFollowUp]: 'attention',
  [ApplicationStatus.Unassigned]: 'neutral',
  [ApplicationStatus.Assigned]: 'informational',
  [ApplicationStatus.AssignmentSent]: 'neutral',
  [ApplicationStatus.VendorAccepted]: 'positive',
  [ApplicationStatus.VendorRefused]: 'destructive',
  [ApplicationStatus.Cancelled]: 'neutral',
};

/** The chip classes for an application's status, wherever a review shows one. */
export function statusChip(status: string): string {
  return `chip chip--${STATUS_TONES[status as ApplicationStatus] ?? 'neutral'}`;
}

const VERDICTS: readonly string[] = [
  ApplicationStatus.ReviewerApproved,
  ApplicationStatus.ReviewerRejected,
];

/**
 * Whether an application carries a verdict, so a verdict on it changes one: the table's row "Change
 * a verdict, or overturn an automatic rejection" (E38/F06/S01). A follow-up is marked, not decided:
 * deciding one is giving a verdict.
 */
export function isDecided(application: Pick<Application, 'status'>): boolean {
  return VERDICTS.includes(application.status);
}

/**
 * Who gave an application its verdict, and when, in the review's words (E34/F01/S01): "Approved by
 * alex@market.test, Oct 19, 2026 at 5:04 PM", or "Rejected automatically: did not tick ..." for a
 * rule's (E33/F03/S02). Null when nobody was recorded - an application decided before verdicts
 * recorded their giver, or one with no verdict.
 */
export function verdictGiverLine(
  application: Pick<Application, 'status' | 'verdictBy' | 'verdictAt' | 'verdictReason'>,
): string | null {
  const by = application.verdictBy;
  if (!VERDICTS.includes(application.status) || !by) return null;
  const verb = statusLabel(application.status);
  // A rule's verdict says why, in the server's words, which a reviewer weighs before overturning
  // it (E33/F03/S02).
  if (by.kind === 'rule') {
    return application.verdictReason
      ? `${verb} automatically: ${application.verdictReason}`
      : `${verb} automatically`;
  }
  if (!by.email) return null;
  const when = application.verdictAt ? `, ${getFormattedTimestamp(application.verdictAt)}` : '';
  return `${verb} by ${by.email}${when}`;
}

/**
 * The verdict an application was given, with who gave it where that is recorded, or null while it
 * has none. A verdict stored before its giver was recorded still reads as itself (E36/F02/S03): the
 * vendor drawer used to show nothing at all for one.
 */
export function verdictLine(
  application: Pick<Application, 'status' | 'verdictBy' | 'verdictAt' | 'verdictReason'>,
): string | null {
  if (!VERDICTS.includes(application.status)) return null;
  return verdictGiverLine(application) ?? statusLabel(application.status);
}

/**
 * Who recorded a vendor who never applied, and when (E36/F03/S01): "Added by alex@market.test, Nov
 * 18, 2026 at 9:00 AM". Null for an applicant, who applied.
 */
export function addedLine(application: Pick<Application, 'addedBy' | 'addedAt'>): string | null {
  const by = application.addedBy?.email;
  if (!by) return null;
  const when = application.addedAt ? `, ${getFormattedTimestamp(application.addedAt)}` : '';
  return `Added by ${by}${when}`;
}
