import { ApplicationStatus, type Application } from '@/assets/types/datatypes';
import { getFormattedTimestamp } from '@/utils/utils';

/** An application's status in the organizer's words: the one map the review reads. */
const STATUS_LABELS: Record<ApplicationStatus, string> = {
  [ApplicationStatus.Open]: 'Open',
  [ApplicationStatus.UnderReview]: 'Under Review',
  [ApplicationStatus.ReviewerApproved]: 'Approved',
  [ApplicationStatus.ReviewerRejected]: 'Rejected',
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

const VERDICTS: readonly string[] = [
  ApplicationStatus.ReviewerApproved,
  ApplicationStatus.ReviewerRejected,
];

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
