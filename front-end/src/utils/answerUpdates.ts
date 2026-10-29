import type { AnswerUpdate, Application } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import { getFormattedTimestamp } from '@/utils/utils';

/**
 * An organizer's updates of a vendor's answers (E41/F01/S01), as every screen says them.
 *
 * The server keeps an update beside the vendor's own answer, never over it, and serves the
 * application's `formData` with each update read in its place; `answerUpdates` says which answers
 * were updated, by whom, when, and what the vendor wrote. So a screen reads the answers as it always
 * did, and says the update beside the ones that carry one.
 */

/** Said beside an updated answer when what the vendor wrote has changed since the update. */
export const CHANGED_SINCE = 'Their answer changed since your update.';

/**
 * "Updated by alex@market.test, Oct 19, 2026 at 5:04 PM; they wrote Ember Ceramcs", with what they
 * wrote as the screen shows an answer.
 */
export function updatedLine(update: AnswerUpdate, theyWrote: string): string {
  const when = update.at ? `, ${getFormattedTimestamp(update.at)}` : '';
  const wrote = theyWrote.trim() ? `they wrote ${theyWrote.trim()}` : 'they left it blank';
  return `Updated by ${update.by.email}${when}; ${wrote}`;
}

/** An application's update of one answer, or undefined where the answer is the vendor's own. */
export function updateOf(
  application: Pick<Application, 'answerUpdates'> | null | undefined,
  key: string,
): AnswerUpdate | undefined {
  return application?.answerUpdates?.[key];
}

/** What the vendor wrote for this question: their own answer, whether or not it was updated. */
export function theirAnswer(application: Application, key: string): unknown {
  const update = updateOf(application, key);
  return update ? update.theyWrote : application.formData?.[key];
}

/**
 * Two answers as the server compares them once stored: blank is blank whatever its shape, an
 * option list in its order, a number and its text alike, text without its surrounding space.
 */
export function sameAnswer(a: unknown, b: unknown): boolean {
  return answerKey(a) === answerKey(b);
}

function answerKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value))
    return value.length ? JSON.stringify(value.map((item) => String(item).trim())) : '';
  if (typeof value === 'boolean') return value ? 'true' : '';
  return String(value).trim();
}

/**
 * Write some of a vendor's answers, `{question key: answer}`; an answer set back to what they wrote
 * takes its update away. Answers the application as the organizer now reads it.
 */
export async function updateVendorInfo(
  marketId: string,
  applicationId: string,
  answers: Record<string, unknown>,
): Promise<Application> {
  const { data } = await api.put<{ application: Application }>(
    `/markets/${encodeURIComponent(marketId)}/applications/${encodeURIComponent(applicationId)}/answers`,
    { answers },
  );
  return data.application;
}
