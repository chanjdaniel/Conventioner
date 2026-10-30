import type { AnswerUpdate, Application, EssentialFormOptions } from '@/assets/types/datatypes';
import { api } from '@/utils/api';
import {
  AVAILABLE_DATES_KEY,
  MAX_DATES_KEY,
  SECTION_RANKING_KEY,
  TABLE_CHOICE_KEY,
  TABLE_SHARE_ANSWER_KEY,
  TABLE_SHARE_EMAIL_KEY,
  TABLE_TYPE_RANKING_KEY,
  TIER_PREFERENCE_KEY,
} from '@/utils/essentialFields';
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

/** Said under that line in Update info: saving keeps the update over what they wrote now. */
export const KEEPS_ON_SAVE = 'Save keeps your update.';

/** "Updated by alex@market.test, Oct 19, 2026 at 5:04 PM": who updated an answer, and when. */
export function updatedByLine(update: AnswerUpdate): string {
  const when = update.at ? `, ${getFormattedTimestamp(update.at)}` : '';
  return `Updated by ${update.by.email}${when}`;
}

/**
 * "Updated by alex@market.test, Oct 19, 2026 at 5:04 PM; they wrote Ember Ceramcs", with what they
 * wrote as the screen shows an answer.
 */
export function updatedLine(update: AnswerUpdate, theyWrote: string): string {
  const wrote = theyWrote.trim() ? `they wrote ${theyWrote.trim()}` : 'they left it blank';
  return `${updatedByLine(update)}; ${wrote}`;
}

/**
 * An application's update of one answer, or undefined where the answer is the vendor's own. The
 * table-share question's is its words', which say what the vendor wrote as they wrote it.
 */
export function updateOf(
  application: Pick<Application, 'answerUpdates'> | null | undefined,
  key: string,
): AnswerUpdate | undefined {
  const updates = application?.answerUpdates;
  if (key === TABLE_SHARE_EMAIL_KEY) return updates?.[TABLE_SHARE_ANSWER_KEY] ?? updates?.[key];
  return updates?.[key];
}

/** What the vendor wrote for this question: their own answer, whether or not it was updated. */
export function theirAnswer(application: Application, key: string): unknown {
  const update = updateOf(application, key);
  return update ? update.theyWrote : application.formData?.[key];
}

/**
 * The essential questions whose answers the assignment reads, the server's `SOLVER_RELEVANT_KEYS`:
 * updating one is the row "Update info the assignment or price reads" (E41/F01/S02).
 */
export const ASSIGNMENT_READS: readonly string[] = [
  AVAILABLE_DATES_KEY,
  MAX_DATES_KEY,
  TIER_PREFERENCE_KEY,
  TABLE_CHOICE_KEY,
  TABLE_SHARE_EMAIL_KEY,
  SECTION_RANKING_KEY,
  TABLE_TYPE_RANKING_KEY,
];

/** The answers an essential question is sent as: the tier grid answers the dates as well. */
export function questionKeys(question: string): string[] {
  return question === TIER_PREFERENCE_KEY ? [AVAILABLE_DATES_KEY, TIER_PREFERENCE_KEY] : [question];
}

/**
 * Answers as the form asks for them: the table-share question in the vendor's own words, where the
 * stored answer keeps the address read out of them beside the words.
 */
export function asAsked(answers: Record<string, unknown>): Record<string, unknown> {
  const words = answers[TABLE_SHARE_ANSWER_KEY];
  return typeof words === 'string' ? { ...answers, [TABLE_SHARE_EMAIL_KEY]: words } : answers;
}

/** Every answer as the vendor wrote it, whether or not it was updated, as the form asks for them. */
export function theirAnswers(application: Application): Record<string, unknown> {
  const answers = { ...(application.formData ?? {}) };
  for (const [key, update] of Object.entries(application.answerUpdates ?? {})) {
    answers[key] = update.theyWrote;
  }
  return asAsked(answers);
}

/**
 * The dates and the tiers on each as the server stores them, in the market plan's order, so an
 * answer ticked back to what it was reads as unchanged.
 *
 * On a market with no tiers the day grid is the dates alone, but a stored answer holds its days
 * beside an empty tier map, and the form's day toggle rebuilds the days from that map; so the map
 * is made to name each day the answer gives, or ticking a second day would untick the first.
 */
export function inPlanOrder(
  answers: Record<string, unknown>,
  options: EssentialFormOptions,
): Record<string, unknown> {
  const ordered = (value: unknown, offered: string[]) =>
    Array.isArray(value) ? offered.filter((item) => value.includes(item)) : value;
  const dates = ordered(answers[AVAILABLE_DATES_KEY], options.dates);
  const tiers = answers[TIER_PREFERENCE_KEY];
  return {
    ...answers,
    [AVAILABLE_DATES_KEY]: dates,
    [TIER_PREFERENCE_KEY]:
      !options.tiers.length && Array.isArray(dates)
        ? Object.fromEntries(dates.map((date) => [date, []]))
        : tiers && typeof tiers === 'object' && !Array.isArray(tiers)
          ? Object.fromEntries(
              Object.entries(tiers as Record<string, unknown>).map(([date, names]) => [
                date,
                ordered(names, options.tiers),
              ]),
            )
          : tiers,
  };
}

/**
 * Two answers as the server compares them once stored: blank is blank whatever its shape, an
 * option list in its order, a number and its text alike, text without its surrounding space, and
 * the tiers on each date by date.
 */
export function sameAnswer(a: unknown, b: unknown): boolean {
  return answerKey(a) === answerKey(b);
}

function answerKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value))
    return value.length ? JSON.stringify(value.map((item) => String(item).trim())) : '';
  if (typeof value === 'boolean') return value ? 'true' : '';
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => [key, answerKey(inner)])
      .filter(([, inner]) => inner)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return entries.length ? JSON.stringify(entries) : '';
  }
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
