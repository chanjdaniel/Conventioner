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
