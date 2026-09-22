/**
 * Whether a market's plan offers anything to apply FOR (E18/F01/S01).
 *
 * Mirrors `plan_derived_asked_keys` in `back-end/essential_fields.py`, which `FormHasFieldsGuard`
 * and `application_write._asks_nothing` both read. What all three are really asking is the same
 * question: does this plan offer anything?
 *
 * It must NOT count custom form fields, and it must not count the applicant's name. A form is its
 * custom fields PLUS the essential questions the plan asks, and the name is asked unconditionally -
 * so counting either would make this unable to say no, silently, while still claiming otherwise.
 * That disagreement is the bug CLAUDE.md records: a market could open applications and then refuse
 * every application it received.
 */
import type { EssentialFormOptions } from '@/assets/types/datatypes';

/**
 * Does this plan offer anything to apply for?
 *
 * Mirrors what `asked_essential_keys` gates on, minus the name: dates gate availability, how many
 * dates and how a table is occupied; tiers gate tier preference; two or more sections gate the
 * section ranking; two or more table types gate the table-type ranking.
 *
 * The name is excluded deliberately, exactly as `plan_derived_asked_keys` excludes it. It is asked
 * unconditionally, so counting it would make this unable to say no - silently, while still
 * claiming otherwise.
 */
export function planOffersSomething(options: EssentialFormOptions): boolean {
  return (
    (options.dates?.length ?? 0) > 0 ||
    (options.tiers?.length ?? 0) > 0 ||
    (options.sections?.length ?? 0) >= 2 ||
    (options.tableTypes?.length ?? 0) >= 2
  );
}

/**
 * What the plan is missing, in the plan's own words - or null when it is missing nothing.
 *
 * Naming what is absent is the difference between a guided page and a disabled one. The guard says
 * the same thing on the server; this says it before the organizer tries.
 */
export function planGateReason(options: EssentialFormOptions): string | null {
  if (planOffersSomething(options)) return null;

  const missing: string[] = [];
  if (!options.dates?.length) missing.push('dates');
  if (!options.tiers?.length) missing.push('tiers');
  if ((options.sections?.length ?? 0) < 2) missing.push('two or more sections');

  return `Add ${missing.join(', ')} above, and this form will have something to ask about.`;
}
