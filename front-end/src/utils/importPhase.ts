/**
 * Whether a market can be imported into, and if not, why - in words that name an action the
 * organizer can take from the phase they are actually in.
 *
 * Mirrors `IMPORT_PHASES` and `import_phase_refusal` in `back-end/csv_import.py`, which is the
 * enforcement: all three import endpoints are reachable directly, and a hidden button is not a
 * rule. This exists so the product can say no before the organizer picks a file, and so the two
 * places that need to say it - the Import button on the Applications tab and the import wizard's
 * own first step - say the same thing.
 *
 * The message used to be one hard-coded sentence, "move the market back to applications closed",
 * shown in both directions. From a draft the organizer needs to move *forward*, and
 * `applications_closed` is not among the transitions offered to them from there, so the advice
 * named a control that was not on their screen.
 */
export const IMPORT_PHASES = ['applications_open', 'applications_closed'];

export function canImportInto(phase: string | undefined | null): boolean {
  return IMPORT_PHASES.includes(String(phase ?? ''));
}

/** Why importing is refused right now, or null when it is not. */
export function importRefusal(phase: string | undefined | null): string | null {
  const current = String(phase ?? '');
  if (canImportInto(current)) return null;
  if (current === 'draft' || current === '') {
    return 'This market is still a draft, so it is not taking applications yet. Open applications first, then import.';
  }
  const readable = current.replace(/_/g, ' ');
  return `This market is in the ${readable} phase, so importing would change who has applied under a review that has already begun. Reopen applications first - move back to applications closed - then import.`;
}
