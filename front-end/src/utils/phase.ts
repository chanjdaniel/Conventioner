import { MarketPhase } from '@/assets/types/datatypes';

/**
 * How a market phase is named and coloured, wherever one is shown.
 *
 * Both used to live inside `PhaseControlPanel`, which is the only place a phase appeared. The
 * market list omitted the phase entirely, so a running market looked exactly like a draft - and
 * phase is the single source of truth for a market's state.
 */
export const PHASE_LABELS: Record<string, string> = {
  [MarketPhase.Draft]: 'Draft',
  [MarketPhase.ApplicationsOpen]: 'Applications Open',
  [MarketPhase.ApplicationsClosed]: 'Applications Closed',
  [MarketPhase.Review]: 'Review',
  [MarketPhase.Assignment]: 'Assignment',
  [MarketPhase.Offers]: 'Offers',
  [MarketPhase.MarketDays]: 'Market Days',
  [MarketPhase.Archived]: 'Archived',
};

/** A phase as a human reads it. A value this build does not know is shown as it is stored. */
export function phaseLabel(phase: string | undefined | null): string {
  const stored = String(phase ?? MarketPhase.Draft);
  return PHASE_LABELS[stored] ?? stored;
}

/** Frontend mirror of guards.py VALID_TRANSITIONS -- single source of truth for UI routing. */
export const VALID_TRANSITIONS: Array<[string, string]> = [
  ['draft', 'applications_open'],
  ['draft', 'archived'],
  // The way back, so a form can be corrected before anyone has answered it (E03/F04). Guarded
  // server-side on no application existing; the button is offered and the guard decides.
  ['applications_open', 'draft'],
  ['applications_open', 'applications_closed'],
  ['applications_open', 'archived'],
  ['applications_closed', 'applications_open'],
  ['applications_closed', 'review'],
  ['applications_closed', 'archived'],
  ['review', 'applications_closed'],
  ['review', 'assignment'],
  // Publishing (E03/F03): market_days means the market is running.
  ['assignment', 'market_days'],
  ['review', 'archived'],
  ['assignment', 'offers'],
  ['assignment', 'archived'],
  ['offers', 'market_days'],
  ['offers', 'archived'],
  ['market_days', 'archived'],
];

/**
 * Can a market leave this phase again?
 *
 * `archived` is the end: reaching it is never a way back from anywhere, so an edge into it does
 * not count as a route out. Everything else that has an outbound edge can be undone.
 */
export function isReversible(phase: string, table = VALID_TRANSITIONS): boolean {
  return table.some(([from, to]) => from === phase && to !== MarketPhase.Archived);
}

/**
 * Does moving to this phase need confirming?
 *
 * It confirms when it cannot be undone. Today that is exactly `market_days` and `archived`:
 * `archived` has no outbound edge at all, and `market_days` reaches only `archived`. Everything
 * else has a documented reverse edge and fires on one click, which is right.
 *
 * Derived from the table rather than listed, and that is the whole point: the answer stays correct
 * when the table changes. Adding a reverse edge stops that transition confirming without anyone
 * touching the panel - the same reason `_validate_registry()` refuses a table that disagrees with
 * itself at import.
 */
export function transitionNeedsConfirmation(toPhase: string, table = VALID_TRANSITIONS): boolean {
  return !isReversible(toPhase, table);
}
