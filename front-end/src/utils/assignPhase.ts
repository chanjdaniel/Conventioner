/**
 * Whether the assignment may be run right now, and if not, why - in words that name an action
 * the organizer can take from the phase they are actually in.
 *
 * Mirrors `ASSIGN_PHASE` and `assign_phase_refusal` in `back-end/api/placements.py`, which is
 * the enforcement: the endpoint is reachable directly, and a hidden button is not a rule. The
 * same arrangement `importPhase.ts` has.
 *
 * This says ONLY where Assign may run. It deliberately does not repeat the rules around it: the
 * machine already carries `_ALL_REVIEWED` on the way into `assignment`, so "review everyone
 * first" is said once, server-side; and `_ASSIGNMENT_COMPUTED` on the way into `market_days`, so
 * "run it before publishing" is said once too (`E10/F03/S02`).
 */
export const ASSIGN_PHASE = 'assignment';

export function canAssignIn(phase: string | undefined | null): boolean {
  return String(phase ?? '') === ASSIGN_PHASE;
}

/** Why the assignment cannot be run right now, or null when it can. */
export function assignRefusal(phase: string | undefined | null): string | null {
  const current = String(phase ?? '');
  if (canAssignIn(current)) return null;
  if (current === 'draft' || current === '') {
    return 'This market is still a draft. Plan it, open applications and review them - the assignment runs once the market reaches the assignment phase.';
  }
  if (current === 'applications_open' || current === 'applications_closed') {
    return 'Applications are still being collected. Close them and review them first - the assignment runs once the market reaches the assignment phase.';
  }
  if (current === 'review') {
    return 'This market is still in review. Move it to the assignment phase to run the assignment.';
  }
  // Past assignment: the assignment is settled and vendors have been told. Changing one
  // placement is what is wanted here, and the Result page is where that happens (E11/F03,
  // E22/F04/S04).
  return 'The assignment for this market is settled. Change a single placement on the Result page instead of re-running it.';
}
