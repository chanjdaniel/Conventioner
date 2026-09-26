import { describe, expect, it } from 'vitest';
import { outOfDateLine } from '@/utils/assignmentOutOfDate';

/**
 * What the result says when the market has changed since its assignment ran (E22/F03/S02).
 *
 * The server names the groups (`assignmentOutOfDate`); this words them, and says nothing outside
 * the `assignment` phase, the one phase in which the organizer can act on it by running again.
 */
describe('the out-of-date line', () => {
  it('names each group that changed, in plain words', () => {
    expect(outOfDateLine(['rules', 'applications'], 'assignment')).toBe(
      'Your rules and the approved applications changed since this assignment ran.',
    );
    expect(outOfDateLine(['rules', 'plan', 'applications'], 'assignment')).toBe(
      'Your rules, the market plan and the approved applications changed since this assignment ran.',
    );
    expect(outOfDateLine(['plan'], 'assignment')).toBe(
      'The market plan changed since this assignment ran.',
    );
  });

  it('says nothing when nothing changed, or when it is not known', () => {
    expect(outOfDateLine([], 'assignment')).toBeNull();
    expect(outOfDateLine(undefined, 'assignment')).toBeNull();
  });

  it('says nothing outside the assignment phase, where running again is impossible', () => {
    for (const phase of ['review', 'offers', 'market_days', 'archived']) {
      expect(outOfDateLine(['rules'], phase)).toBeNull();
    }
  });

  it('ignores a group this build does not know, rather than printing its key', () => {
    expect(outOfDateLine(['rules', 'something_new'], 'assignment')).toBe(
      'Your rules changed since this assignment ran.',
    );
    expect(outOfDateLine(['something_new'], 'assignment')).toBeNull();
  });
});
