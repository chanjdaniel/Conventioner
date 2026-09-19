import type { Application, ApplicationForm } from '@/assets/types/datatypes';
import { applicationAnswerRows, type AnswerRow } from '@/utils/essentialFields';

/**
 * Everything an application says, as a reviewer reads it.
 *
 * This exists because the review queue showed an email address, a status pill and two buttons -
 * so an organizer was asked to accept or refuse 232 people with nothing to decide on (E08/F04).
 * Triage answers that by showing the whole application, one at a time.
 *
 * The organizer's OWN questions come first, which is the one thing a reviewer's order does that
 * the applicant's does not. They are what distinguish applicants from each other - what the vendor
 * sells, their portfolio - while the essential answers mostly repeat, because they are drawn from
 * the same small offering. The rendering itself belongs to the contract being rendered, so it
 * lives in `essentialFields.ts` and the applicant's own dashboard reads the same answers back.
 */
export function reviewAnswers(
  application: Application,
  form?: ApplicationForm | null,
): AnswerRow[] {
  const { essential, custom } = applicationAnswerRows(
    (application.formData ?? {}) as Record<string, unknown>,
    form?.fields ?? [],
  );
  return [...custom, ...essential];
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
