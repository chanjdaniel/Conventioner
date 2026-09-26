import type { Application, ApplicationForm } from '@/assets/types/datatypes';
import { applicationAnswerRows, type AnswerRow } from '@/utils/essentialFields';

/**
 * Everything an application says, as a reviewer reads it.
 *
 * This exists because the review queue showed an email address, a status pill and two buttons -
 * so an organizer was asked to accept or refuse 232 people with nothing to decide on (E08/F04).
 * Triage answers that by showing the whole application, one at a time.
 *
 * The answers the market MARKED come first (E19/F03/S01).
 *
 * This used to put the organizer's own questions first and the essential answers after, reasoning
 * that custom questions "are what distinguish applicants from each other". That was a heuristic
 * standing in for exactly this mark, and it was wrong in both directions: a custom "how did you
 * hear about us?" is noise on a triage card, and an essential availability answer can be the whole
 * decision. Now the market says which, and within each group the previous order is unchanged - so
 * nothing else moves at the same time.
 *
 * The rendering itself belongs to the contract being rendered, so it lives in `essentialFields.ts`
 * and the applicant's own dashboard reads the same answers back.
 */
export function reviewAnswers(
  application: Application,
  form?: ApplicationForm | null,
  highlights: string[] = [],
): { leading: AnswerRow[]; rest: AnswerRow[] } {
  const { essential, custom } = applicationAnswerRows(
    (application.formData ?? {}) as Record<string, unknown>,
    form?.fields ?? [],
  );
  const all = [...custom, ...essential];
  if (!highlights.length) return { leading: [], rest: all };

  const marked = new Set(highlights);
  return {
    // In the order the market marked them: that order is what a reviewer reads down.
    leading: highlights.flatMap((key) => all.filter((row) => row.key === key)),
    rest: all.filter((row) => !marked.has(row.key)),
  };
}

/**
 * Whether this market's form asks anything that tells one applicant from another.
 *
 * When it does not, every triage card is identical and the only rational act is pressing Approve
 * over and over. Saying so beats letting the reviewer discover it at card forty. The form freezes
 * when a market leaves draft, so the fix - reopening for editing and adding a question - is a thing
 * the organizer can still do while nobody has applied (E03/F04).
 *
 * This is NOT the "does this market have a form?" question: a market whose form asks only the
 * essential questions has a form, and a valid one. See `asked_essential_keys()` in
 * `back-end/essential_fields.py` for that one.
 */
export function asksNothingDistinguishing(form?: ApplicationForm | null): boolean {
  return (form?.fields ?? []).length === 0;
}
