import { ApplicationStatus, type Application } from '@/assets/types/datatypes';
import { getFormattedTimestamp } from '@/utils/utils';

const VERDICT_VERBS: Partial<Record<ApplicationStatus, string>> = {
  [ApplicationStatus.ReviewerApproved]: 'Approved',
  [ApplicationStatus.ReviewerRejected]: 'Rejected',
};

/**
 * Who gave an application its verdict, and when, in the review's words (E34/F01/S01): "Approved by
 * alex@market.test, Oct 19, 2026 at 5:04 PM". Null when nobody was recorded - an application decided
 * before verdicts recorded their giver, or one with no verdict.
 */
export function verdictGiverLine(
  application: Pick<Application, 'status' | 'verdictBy' | 'verdictAt'>,
): string | null {
  const verb = VERDICT_VERBS[application.status];
  const by = application.verdictBy;
  if (!verb || !by?.email) return null;
  const when = application.verdictAt ? `, ${getFormattedTimestamp(application.verdictAt)}` : '';
  return `${verb} by ${by.email}${when}`;
}
