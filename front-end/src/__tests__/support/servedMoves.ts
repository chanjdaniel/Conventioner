import type { PreconditionResult } from '@/assets/types/datatypes';
import { VALID_TRANSITIONS } from '@/utils/phase';

/**
 * The moves a market read serves from a phase, none of them refused: one edge of the table each
 * (`moves_from` in guards.py). A test of a refused move states what it is served instead.
 */
export function movesServedFrom(phase: string): Record<string, PreconditionResult[]> {
  return Object.fromEntries(
    VALID_TRANSITIONS.filter(([from]) => from === phase).map(([, to]) => [to, []]),
  );
}
