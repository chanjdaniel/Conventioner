/**
 * What the result says when the market has changed since its assignment ran (E22/F03/S02).
 *
 * The server decides WHAT changed, from the fingerprints a run records
 * (`back-end/assignment/made_from.py`), and serves the groups as `assignmentOutOfDate`; this only
 * words them, and only when the served `allocation` is `stale` (T316), the word Publish results is
 * refused on, so the notice and the refusal never disagree. The server serves the groups only in
 * `assignment`, the one phase in which running again is possible, because a notice the organizer
 * cannot act on is noise.
 *
 * The reopened review (`review`, T207) is no input that "changed": the run was made before the
 * review it now stands on. It is said in a sentence of its own, first, since it is often why the
 * approved applications changed too.
 */
import type { Allocation, AssignmentInputGroup } from '@/assets/types/datatypes';

const REVIEW_REOPENED = 'The review was reopened after tables were allocated.';

/** Each input the server names, as the sentence says it; the first is capitalised in place. */
const WORDS: Record<Exclude<AssignmentInputGroup, 'review'>, string> = {
  rules: 'your rules',
  plan: 'the market plan',
  applications: 'the approved applications',
};

export function outOfDateLine(
  groups: string[] | undefined,
  allocation: Allocation | undefined | null,
): string | null {
  if (allocation !== 'stale') return null;
  const sentences = [
    ...((groups ?? []).includes('review') ? [REVIEW_REOPENED] : []),
    ...changedLine(groups ?? []),
  ];
  return sentences.length ? sentences.join(' ') : null;
}

/** The inputs that changed, in one sentence, or none. */
function changedLine(groups: string[]): string[] {
  const named = groups
    .filter((group): group is keyof typeof WORDS => group in WORDS)
    .map((group) => WORDS[group]);
  if (!named.length) return [];
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  return [`${list.charAt(0).toUpperCase()}${list.slice(1)} changed since tables were allocated.`];
}
