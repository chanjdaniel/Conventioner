/**
 * The repeat of the spec files a pull request adds or changes: CI's `e2e-repeat` job runs each of
 * them several times on one stack, with no retry, so a spec that passes only sometimes fails here
 * instead of merging on one lucky green run of its shard.
 *
 * The files are those the diff from `<base>` to `HEAD` adds, changes or renames to, kept only where
 * Playwright lists them as spec files of the suite, so a helper, a fixture or a deleted file is
 * never run. CI passes the pull request's merge commit's first parent, `HEAD^1`, so the diff is
 * exactly what the PR brings to its base. From `front-end/`:
 *
 *   node scripts/e2e-repeat.ts changed <base>   prints each file, one a line, and nothing for none
 *   node scripts/e2e-repeat.ts run <base>       runs them, passing at once when there is none
 *
 * Every file runs the same number of times, `repeatsFor` their seconds in `e2e-shard-timings.json`
 * (a new file weighs the median): as many as fit `REPEAT_BUDGET_SECONDS`, between `MIN_REPEATS`
 * and `MAX_REPEATS`. Past `REPEAT_LIMIT_SECONDS` a run, none: the job passes with a warning
 * annotation saying the files were too many to repeat.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import {
  defaultSeconds,
  fileFilter,
  list,
  specFiles,
  type Timings,
  timingsFile,
} from './e2e-shards.ts';

/** The seconds of tests the repeats aim to fit, about one shard's share of the suite. */
export const REPEAT_BUDGET_SECONDS = 10 * 60;
/** Never fewer: one run is what the shard already gave. */
export const MIN_REPEATS = 2;
/** Never more, however light the files: five runs catch a spec failing one in three 87% of the time. */
export const MAX_REPEATS = 5;
/**
 * Past this many seconds a run, the files are not repeated at all: a change that sweeps through
 * the suite would hold the runner for hours, and its shards have still run every file once.
 */
export const REPEAT_LIMIT_SECONDS = 15 * 60;

/** Seconds as a person reads them: whole seconds under a minute, else minutes to a tenth. */
export function duration(seconds: number): string {
  return seconds < 59.5 ? `${Math.round(seconds)} seconds` : `${(seconds / 60).toFixed(1)} minutes`;
}

/** How many times to run files measured at `seconds` a run, all together; 0 past the limit. */
export function repeatsFor(seconds: number): number {
  if (seconds > REPEAT_LIMIT_SECONDS) return 0;
  const fits = seconds > 0 ? Math.floor(REPEAT_BUDGET_SECONDS / seconds) : MAX_REPEATS;
  return Math.min(MAX_REPEATS, Math.max(MIN_REPEATS, fits));
}

/**
 * The spec files of the suite (`listed`, relative to its test folder) among the repository paths
 * the diff names (`changed`), the test folder given relative to the repository, in order.
 */
export function changedSpecFiles(
  changed: readonly string[],
  listed: readonly string[],
  testDir: string,
): string[] {
  const prefix = `${testDir.replace(/\/$/, '')}/`;
  const paths = new Set(changed);
  return listed.filter((file) => paths.has(`${prefix}${file}`)).sort();
}

/** Runs git and returns its output, failing on a non-zero exit. */
function git(args: readonly string[]): string {
  const run = spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} exited ${run.status}`);
  return run.stdout;
}

/** The suite's folder and the spec files the diff from `base` to `HEAD` adds or changes. */
function changed(base: string): { rootDir: string; files: string[] } {
  const top = git(['rev-parse', '--show-toplevel']).trim();
  // Renames as an add and a delete, and deletes left out, so a renamed spec runs by its new name.
  const paths = git(['diff', '--name-only', '--no-renames', '--diff-filter=d', base, 'HEAD'])
    .split('\n')
    .filter(Boolean);
  const suite = list();
  const rootDir = suite.config?.rootDir;
  if (!rootDir) throw new Error("Playwright's list names no rootDir");
  return { rootDir, files: changedSpecFiles(paths, specFiles(suite), relative(top, rootDir)) };
}

/** Runs the changed files, each `repeatsFor` their seconds times, with no retry. */
function run(base: string, playwrightArgs: readonly string[]): number {
  const { rootDir, files } = changed(base);
  if (files.length === 0) {
    console.log(`e2e repeat: no spec file changed since ${base}; nothing to run.`);
    return 0;
  }
  const timings = JSON.parse(readFileSync(timingsFile(), 'utf8')) as Timings;
  const fallback = defaultSeconds(specFiles(list()), timings);
  const seconds = files.reduce((sum, file) => sum + (timings[file] ?? fallback), 0);
  const repeats = repeatsFor(seconds);
  if (repeats === 0) {
    console.log(
      `::warning title=e2e repeat::${files.length} spec ${files.length === 1 ? 'file' : 'files'} changed, about ` +
        `${duration(seconds)} a run by the timings, past the repeat's limit of ` +
        `${duration(REPEAT_LIMIT_SECONDS)}; none is repeated, and the shards ran each once.`,
    );
    return 0;
  }
  console.log(
    `e2e repeat: ${files.length} spec ${files.length === 1 ? 'file' : 'files'} changed since ${base}, about ` +
      `${duration(seconds)} a run by the timings, each run ${repeats} times:`,
  );
  for (const file of files) console.log(`  ${file}${file in timings ? '' : ' (no timing yet)'}`);

  const filters = files.map((file) => fileFilter(rootDir, file));
  const selected = specFiles(list(filters));
  if (JSON.stringify(selected) !== JSON.stringify(files)) {
    console.error(`The filters select ${JSON.stringify(selected)}, not the changed spec files.`);
    return 1;
  }
  const playwright = spawnSync(
    'npx',
    [
      'playwright',
      'test',
      ...filters,
      `--repeat-each=${repeats}`,
      // A run that passes only on a retry is the flake this job is for, so none is retried.
      '--retries=0',
      '--trace=retain-on-failure',
      ...playwrightArgs,
    ],
    { stdio: 'inherit' },
  );
  return playwright.status ?? 1;
}

if (import.meta.main) {
  const [command, base, ...rest] = process.argv.slice(2);
  if (command === 'changed' && base && rest.length === 0) {
    for (const file of changed(base).files) console.log(file);
  } else if (command === 'run' && base) {
    process.exitCode = run(base, rest);
  } else {
    console.error(
      'Usage: node scripts/e2e-repeat.ts changed <base>\n' +
        '       node scripts/e2e-repeat.ts run <base> [playwright args]',
    );
    process.exitCode = 2;
  }
}
