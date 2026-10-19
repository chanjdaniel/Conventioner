import type { PreconditionResult } from '@/assets/types/datatypes';
import { VALID_TRANSITIONS } from '@/utils/phase';

/**
 * The moves a market read serves for a market whose path stops in every phase - a form market -
 * none of them refused. The server judges which moves a market has (`path_moves` in guards.py,
 * E32/F02/S01); a test of the Google Form path states the moves it is served instead.
 */
export function movesServedFrom(phase: string): Record<string, PreconditionResult[]> {
  return Object.fromEntries(
    VALID_TRANSITIONS.filter(([from]) => from === phase).map(([, to]) => [to, []]),
  );
}

/** What the read serves a Google Form market importing its responses, nothing yet refused. */
export const IMPORTING_SERVED = {
  transitionBlockers: { draft: [], review: [], archived: [] },
  phasesPassedThrough: ['applications_closed'],
};
