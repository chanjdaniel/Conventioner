import { describe, expect, it } from 'vitest';
import type { Allocation } from '@/assets/types/datatypes';
import { outOfDateLine } from '@/utils/assignmentOutOfDate';

/**
 * What the result says when the market has changed since its assignment ran (E22/F03/S02).
 *
 * The server names the groups (`assignmentOutOfDate`); this words them, and speaks only when the
 * served allocation is `stale` (T316), the word Publish results is refused on.
 */
describe('the out-of-date line', () => {
  it('names each group that changed, in plain words', () => {
    expect(outOfDateLine(['rules', 'applications'], 'stale')).toBe(
      'Your rules and the approved applications changed since tables were allocated.',
    );
    expect(outOfDateLine(['rules', 'plan', 'applications'], 'stale')).toBe(
      'Your rules, the market plan and the approved applications changed since tables were allocated.',
    );
    expect(outOfDateLine(['plan'], 'stale')).toBe(
      'The market plan changed since tables were allocated.',
    );
  });

  it('says the review was reopened in a sentence of its own', () => {
    expect(outOfDateLine(['review'], 'stale')).toBe(
      'The review was reopened after tables were allocated.',
    );
  });

  it('says the reopened review beside, not inside, the groups that changed', () => {
    expect(outOfDateLine(['applications', 'review'], 'stale')).toBe(
      'The review was reopened after tables were allocated. The approved applications changed since tables were allocated.',
    );
    expect(outOfDateLine(['rules', 'plan', 'review'], 'stale')).toBe(
      'The review was reopened after tables were allocated. Your rules and the market plan changed since tables were allocated.',
    );
  });

  it('says nothing when nothing changed, or when it is not known', () => {
    expect(outOfDateLine([], 'stale')).toBeNull();
    expect(outOfDateLine(undefined, 'stale')).toBeNull();
  });

  // Every allocation but `stale`, the absent one included: whatever groups are served, the line
  // never speaks where Publish results is not refused as out of date.
  const NOT_STALE: (Allocation | undefined | null)[] = [
    'none',
    'pinned',
    'current',
    'published',
    'changed_since_published',
    undefined,
    null,
  ];

  it.each(NOT_STALE)('says nothing when the allocation is %s', (allocation) => {
    expect(outOfDateLine(['rules'], allocation)).toBeNull();
    expect(outOfDateLine(['review'], allocation)).toBeNull();
    expect(outOfDateLine(['rules', 'plan', 'applications', 'review'], allocation)).toBeNull();
  });

  it('ignores a group this build does not know, rather than printing its key', () => {
    expect(outOfDateLine(['rules', 'something_new'], 'stale')).toBe(
      'Your rules changed since tables were allocated.',
    );
    expect(outOfDateLine(['something_new'], 'stale')).toBeNull();
  });
});
