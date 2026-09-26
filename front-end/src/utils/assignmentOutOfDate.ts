/**
 * What the result says when the market has changed since its assignment ran (E22/F03/S02).
 *
 * The server decides WHAT changed, from the fingerprints a run records
 * (`back-end/assignment/made_from.py`), and serves the groups as `assignmentOutOfDate`; this only
 * words them. It says nothing outside `assignment`, the one phase in which running again is
 * possible, because a notice the organizer cannot act on is noise.
 */
import { MarketPhase } from '@/assets/types/datatypes';

/** Each group the server names, as the sentence says it; the first is capitalised in place. */
const WORDS: Record<string, string> = {
  rules: 'your rules',
  plan: 'the market plan',
  applications: 'the approved applications',
};

export function outOfDateLine(
  groups: string[] | undefined,
  phase: string | undefined | null,
): string | null {
  if (phase !== MarketPhase.Assignment) return null;
  const named = (groups ?? []).filter((group) => group in WORDS).map((group) => WORDS[group]);
  if (!named.length) return null;
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} changed since this assignment ran.`;
}
