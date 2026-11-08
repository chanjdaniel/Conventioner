/**
 * The e2e shards (T234) are dealt by measured minutes, not cut from the alphabetical list by test
 * count: Playwright's own `--shard` put the three people-at-scale files, whose names sort together,
 * on one shard, which ran 24 minutes of tests while another ran 6. Each shard deals the whole list
 * itself and runs its own hand, so the dealing must be the same on every runner and must hand every
 * spec file to exactly one shard.
 */
import { describe, expect, it } from 'vitest';

import {
  dealShards,
  defaultSeconds,
  fileFilter,
  parseShard,
  secondsFromReports,
  specFiles,
} from '../../scripts/e2e-shards';

const FILES = Array.from({ length: 40 }, (_, n) => `spec-${String(n).padStart(2, '0')}.spec.ts`);
/** Uneven, as the suite is: a few heavy files and many light ones. */
const SECONDS = Object.fromEntries(FILES.map((file, n) => [file, n % 7 === 0 ? 300 + n : 10 + n]));

/** A Playwright JSON report: one top-level suite per spec file, with nested suites and retries. */
function report(files: Record<string, number[][]>) {
  return {
    config: { rootDir: '/repo/front-end/e2e' },
    suites: Object.entries(files).map(([file, tests]) => ({
      title: file,
      file,
      specs: [],
      suites: [
        {
          title: 'a describe',
          file,
          specs: tests.map((durations, n) => ({
            title: `test ${n}`,
            file,
            tests: [{ results: durations.map((duration) => ({ duration })) }],
          })),
        },
      ],
    })),
  };
}

describe('dealShards', () => {
  it('hands every spec file to exactly one shard', () => {
    for (const total of [1, 4, 6, 7]) {
      const hands = dealShards(FILES, SECONDS, total);
      expect(hands).toHaveLength(total);
      const dealt = hands.flat();
      expect(dealt).toHaveLength(FILES.length);
      expect(new Set(dealt)).toEqual(new Set(FILES));
    }
  });

  it('deals the same hands whatever order the files are listed in', () => {
    const first = dealShards(FILES, SECONDS, 6);
    const reversed = dealShards([...FILES].reverse(), SECONDS, 6);
    const shuffled = dealShards(
      [...FILES].sort((a, b) => (a.slice(-9) < b.slice(-9) ? -1 : 1)),
      SECONDS,
      6,
    );
    expect(reversed).toEqual(first);
    expect(shuffled).toEqual(first);
    expect(dealShards(FILES, SECONDS, 6)).toEqual(first);
  });

  it('deals by measured time, so no shard runs far longer than the others', () => {
    const hands = dealShards(FILES, SECONDS, 6);
    const load = hands.map((hand) => hand.reduce((sum, file) => sum + SECONDS[file]!, 0));
    const heaviest = Math.max(...Object.values(SECONDS));
    // A greedy deal by time is within one file of the lightest shard.
    expect(Math.max(...load) - Math.min(...load)).toBeLessThanOrEqual(heaviest);
  });

  it('spreads files whose names sort together', () => {
    const files = [...FILES, 'people-a.spec.ts', 'people-b.spec.ts', 'people-c.spec.ts'];
    const seconds = {
      ...SECONDS,
      'people-a.spec.ts': 900,
      'people-b.spec.ts': 900,
      'people-c.spec.ts': 900,
    };
    const hands = dealShards(files, seconds, 6);
    const holding = (file: string) => hands.findIndex((hand) => hand.includes(file));
    expect(
      new Set(['people-a', 'people-b', 'people-c'].map((p) => holding(`${p}.spec.ts`))).size,
    ).toBe(3);
  });

  it('runs each hand in alphabetical order', () => {
    for (const hand of dealShards(FILES, SECONDS, 6)) expect(hand).toEqual([...hand].sort());
  });

  it('weighs a file with no timing yet at the median of those measured', () => {
    expect(defaultSeconds(['a', 'b', 'c', 'new'], { a: 10, b: 30, c: 200 })).toBe(30);
    expect(defaultSeconds(['a', 'b', 'new'], { a: 10, b: 30 })).toBe(20);
    expect(defaultSeconds(['new'], {})).toBe(1);
    const files = [...FILES, 'brand-new.spec.ts'];
    expect(new Set(dealShards(files, SECONDS, 6).flat())).toEqual(new Set(files));
  });

  it('ignores a timing for a file no longer in the suite', () => {
    const hands = dealShards(FILES, { ...SECONDS, 'deleted.spec.ts': 10_000 }, 6);
    expect(hands).toEqual(dealShards(FILES, SECONDS, 6));
  });

  it('refuses a shard count below one, and a file listed twice', () => {
    expect(() => dealShards(FILES, SECONDS, 0)).toThrow();
    expect(() => dealShards([...FILES, FILES[0]!], SECONDS, 6)).toThrow(/twice/);
  });
});

describe('parseShard', () => {
  it('reads "current/total", 1-based', () => {
    expect(parseShard('3/6')).toEqual({ current: 3, total: 6 });
    for (const bad of ['0/6', '7/6', '3', 'a/b', '3/0', ''])
      expect(() => parseShard(bad)).toThrow();
  });
});

describe('fileFilter', () => {
  /** As Playwright reads a command-line filter: `/source/flags` is a regular expression. */
  function asPlaywrightReadsIt(filter: string): RegExp {
    const match = filter.match(/^\/(.*)\/([gi]*)$/);
    expect(match, 'the filter is in /source/flags form').not.toBeNull();
    return new RegExp(match![1]!, match![2]);
  }
  const root = '/repo/front-end/e2e';
  const paths = [
    `${root}/tables.spec.ts`,
    `${root}/the-tables.spec.ts`,
    `${root}/tables.spec.tsx`,
    `${root}/sub/tables.spec.ts`,
    `/other/front-end/e2e/tables.spec.ts`,
  ];

  it('matches only its own file, not one whose name ends the same', () => {
    const re = asPlaywrightReadsIt(fileFilter(root, 'tables.spec.ts'));
    expect(paths.filter((path) => re.test(path))).toEqual([`${root}/tables.spec.ts`]);
  });

  it('takes a file in a folder, and a name with a dot or a plus in it', () => {
    expect(asPlaywrightReadsIt(fileFilter(root, 'sub/tables.spec.ts')).test(paths[3]!)).toBe(true);
    const odd = asPlaywrightReadsIt(fileFilter(root, 'a+b.c.spec.ts'));
    expect(odd.test(`${root}/a+b.c.spec.ts`)).toBe(true);
    expect(odd.test(`${root}/aab.c.spec.ts`)).toBe(false);
    expect(odd.test(`${root}/a+bxc.spec.ts`)).toBe(false);
  });
});

describe('specFiles', () => {
  it('lists each spec file a Playwright report names, once, in order', () => {
    expect(specFiles(report({ 'b.spec.ts': [[1]], 'a.spec.ts': [[1]] }))).toEqual([
      'a.spec.ts',
      'b.spec.ts',
    ]);
  });
});

describe('secondsFromReports', () => {
  it("sums every attempt of every test by spec file, across the shards' reports", () => {
    const shard1 = report({ 'a.spec.ts': [[1500], [2000, 2500]], 'b.spec.ts': [[100]] });
    const shard2 = report({ 'c.spec.ts': [[60_000]] });
    expect(secondsFromReports([shard1, shard2])).toEqual({
      'a.spec.ts': 6,
      'b.spec.ts': 0.1,
      'c.spec.ts': 60,
    });
  });

  it('writes the files in alphabetical order, so a refresh diffs line by line', () => {
    const seconds = secondsFromReports([report({ 'z.spec.ts': [[1000]], 'a.spec.ts': [[1000]] })]);
    expect(Object.keys(seconds)).toEqual(['a.spec.ts', 'z.spec.ts']);
  });
});
