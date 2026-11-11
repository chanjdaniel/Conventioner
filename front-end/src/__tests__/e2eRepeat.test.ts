/**
 * CI's `e2e-repeat` job runs the spec files a pull request adds or changes several times each, so a
 * spec that passes only sometimes cannot merge on one lucky green run. It must pick exactly the
 * spec files the PR changed, never a helper or a deleted file, and run them as often as fits a
 * budget of time without dropping below two runs.
 */
import { describe, expect, it } from 'vitest';

import {
  changedSpecFiles,
  MAX_REPEATS,
  MIN_REPEATS,
  REPEAT_BUDGET_SECONDS,
  REPEAT_LIMIT_SECONDS,
  repeatsFor,
} from '../../scripts/e2e-repeat';

const LISTED = ['a.spec.ts', 'b.spec.ts', 'floorplan/c.spec.ts', 'the-tables.spec.ts'];

describe('changedSpecFiles', () => {
  it('keeps the changed paths that are spec files of the suite, relative to its test folder', () => {
    const changed = [
      'front-end/e2e/b.spec.ts',
      'front-end/e2e/floorplan/c.spec.ts',
      'front-end/src/App.vue',
      'docs/TESTING.md',
    ];
    expect(changedSpecFiles(changed, LISTED, 'front-end/e2e')).toEqual([
      'b.spec.ts',
      'floorplan/c.spec.ts',
    ]);
  });

  it('leaves out a helper, a fixture and a file the suite does not list', () => {
    const changed = [
      'front-end/e2e/helpers/seed.ts',
      'front-end/e2e/fixtures.ts',
      'front-end/e2e/gone.spec.ts',
      'front-end/src/__tests__/a.spec.ts',
    ];
    expect(changedSpecFiles(changed, LISTED, 'front-end/e2e')).toEqual([]);
  });

  it('matches a whole path, never a name that ends the same', () => {
    expect(changedSpecFiles(['front-end/e2e/tables.spec.ts'], LISTED, 'front-end/e2e')).toEqual([]);
  });

  it('reads a test folder given with a trailing slash, and returns the files in order', () => {
    const changed = ['front-end/e2e/the-tables.spec.ts', 'front-end/e2e/a.spec.ts'];
    expect(changedSpecFiles(changed, LISTED, 'front-end/e2e/')).toEqual([
      'a.spec.ts',
      'the-tables.spec.ts',
    ]);
  });
});

describe('repeatsFor', () => {
  it('runs light files the most times, and never more', () => {
    expect(repeatsFor(10)).toBe(MAX_REPEATS);
    expect(repeatsFor(0)).toBe(MAX_REPEATS);
  });

  it('fits the runs to the budget between the bounds', () => {
    const seconds = REPEAT_BUDGET_SECONDS / 3;
    expect(repeatsFor(seconds)).toBe(3);
    expect(repeatsFor(seconds + 1)).toBe(2);
  });

  it('runs files heavier than the budget twice, never once', () => {
    expect(repeatsFor(REPEAT_BUDGET_SECONDS * 1.5)).toBe(MIN_REPEATS);
    expect(repeatsFor(REPEAT_LIMIT_SECONDS)).toBe(MIN_REPEATS);
    expect(MIN_REPEATS).toBe(2);
  });

  it('runs none past the limit, where a sweeping change would hold the runner for hours', () => {
    expect(repeatsFor(REPEAT_LIMIT_SECONDS + 1)).toBe(0);
    expect(REPEAT_LIMIT_SECONDS).toBeGreaterThan(REPEAT_BUDGET_SECONDS);
  });

  it('runs enough times to catch a spec failing one run in three', () => {
    expect(MAX_REPEATS).toBeGreaterThanOrEqual(3);
  });
});
