/**
 * CI's `e2e-repeat` job runs the spec files a pull request adds or changes several times each, so a
 * spec that passes only sometimes cannot merge on one lucky green run. It must pick exactly the
 * spec files the PR changed, never a helper or a deleted file, and run them as often as fits a
 * budget of time without dropping below two runs.
 */
import { describe, expect, it } from 'vitest';

import {
  changedSpecFiles,
  duration,
  estimateSeconds,
  firstRunArgs,
  firstRunOutcome,
  MAX_REPEATS,
  MIN_REPEATS,
  REPEAT_BUDGET_SECONDS,
  REPEAT_LIMIT_SECONDS,
  repeatsAfter,
  repeatsFor,
} from '../../scripts/e2e-repeat';
import { defaultSeconds, type Timings } from '../../scripts/e2e-shards';

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

describe('repeatsAfter', () => {
  it('runs light files again until they have run the most times', () => {
    expect(repeatsAfter(3)).toBe(MAX_REPEATS - 1);
  });

  it('fits the runs after the first to the budget, the first counted in it', () => {
    const seconds = REPEAT_BUDGET_SECONDS / 3;
    expect(repeatsAfter(seconds)).toBe(2);
    expect(repeatsAfter(seconds + 1)).toBe(1);
  });

  it('runs files heavier than the budget once more, so they run twice in all', () => {
    expect(repeatsAfter(REPEAT_BUDGET_SECONDS + 1)).toBe(MIN_REPEATS - 1);
    expect(repeatsAfter(REPEAT_LIMIT_SECONDS)).toBe(MIN_REPEATS - 1);
  });

  it('runs no more once the first run took past the limit', () => {
    expect(repeatsAfter(REPEAT_LIMIT_SECONDS + 1)).toBe(0);
    expect(repeatsAfter(REPEAT_LIMIT_SECONDS * 4)).toBe(0);
  });
});

describe('the first run', () => {
  // Ten heavy files and a light rest, so the case stays what it is whatever the real timings become.
  const heaviest = Array.from({ length: 10 }, (_, i) => [`heavy-${i}.spec.ts`, 400] as const);
  const lightest = Array.from({ length: 30 }, (_, i) => [`light-${i}.spec.ts`, 10] as const);
  const timings: Timings = Object.fromEntries([...heaviest, ...lightest]);

  it('is estimated by the timings, a renamed file weighing the median, so moved heavy files pass the check', () => {
    const fallback = defaultSeconds(Object.keys(timings), timings);
    const renamed = heaviest.map(([file]) => `moved/${file}`);
    const real = heaviest.reduce((sum, [, seconds]) => sum + seconds, 0);
    expect(estimateSeconds(renamed, timings, fallback)).toBeCloseTo(10 * fallback);
    expect(estimateSeconds(renamed, timings, fallback)).toBeLessThan(REPEAT_LIMIT_SECONDS);
    expect(real).toBeGreaterThan(2 * REPEAT_LIMIT_SECONDS);
  });

  it('is cut at the limit, whatever the estimate said', () => {
    expect(firstRunArgs(['a.spec.ts'], [])).toContain(
      `--global-timeout=${REPEAT_LIMIT_SECONDS * 1000}`,
    );
    expect(firstRunArgs(['a.spec.ts'], [])).toContain('--repeat-each=1');
  });

  const timedOut = { errors: [{ message: 'Timed out waiting 900s for the test suite to run' }] };

  it('passes when every test passed', () => {
    expect(firstRunOutcome(0, { stats: { unexpected: 0, flaky: 0 }, errors: [] })).toBe('passed');
  });

  it('reads a run cut at the limit with no failed test as timed out', () => {
    expect(firstRunOutcome(1, { stats: { unexpected: 0, flaky: 0 }, ...timedOut })).toBe(
      'timed out',
    );
  });

  it('fails a run cut at the limit after a test failed', () => {
    expect(firstRunOutcome(1, { stats: { unexpected: 1, flaky: 0 }, ...timedOut })).toBe('failed');
  });

  it('fails a run that failed with no timeout, or left no report', () => {
    expect(firstRunOutcome(1, { stats: { unexpected: 1, flaky: 0 }, errors: [] })).toBe('failed');
    expect(firstRunOutcome(1, { stats: { unexpected: 0, flaky: 0 }, errors: [] })).toBe('failed');
    expect(firstRunOutcome(1, undefined)).toBe('failed');
  });
});

describe('duration', () => {
  it('reads seconds under a minute, and minutes to a tenth above it', () => {
    expect(duration(2.7)).toBe('3 seconds');
    expect(duration(59.4)).toBe('59 seconds');
    expect(duration(60)).toBe('1.0 minutes');
    expect(duration(389.7)).toBe('6.5 minutes');
  });
});
