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
 * The files run once together, and that run's time decides how many more runs follow
 * (`repeatsAfter`), so every file runs the same number of times in all: as many as fit
 * `REPEAT_BUDGET_SECONDS`, between `MIN_REPEATS` and `MAX_REPEATS`. The first run is cut at
 * `REPEAT_LIMIT_SECONDS` (`--global-timeout`), and a first run cut there with no test failed, or
 * one past the limit, gets no more: the job passes with a warning annotation, as the shards ran
 * each file once. Timing the run, not reading `e2e-shard-timings.json`, bounds a new or renamed
 * file, which has no timing yet. The timings only decide, before anything runs, whether the files
 * are too many to run at all: past `REPEAT_LIMIT_SECONDS` a run by them (a file with no timing
 * weighing the median), none runs, with the same warning.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';

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

/** How many more times to run files whose first run, all together, took `seconds`; 0 past the limit. */
export function repeatsAfter(seconds: number): number {
  return Math.max(0, repeatsFor(seconds) - 1);
}

/** The seconds of one run of `files` by the timings, a file with none weighing `fallback`. */
export function estimateSeconds(
  files: readonly string[],
  timings: Timings,
  fallback: number,
): number {
  return files.reduce((sum, file) => sum + (timings[file] ?? fallback), 0);
}

/** Playwright's arguments for `filters` run `repeats` times each, with no retry. */
function testArgs(
  filters: readonly string[],
  repeats: number,
  playwrightArgs: readonly string[],
): string[] {
  return [
    'playwright',
    'test',
    ...filters,
    `--repeat-each=${repeats}`,
    // A run that passes only on a retry is the flake this job is for, so none is retried.
    '--retries=0',
    '--trace=retain-on-failure',
    ...playwrightArgs,
  ];
}

/**
 * The first run's arguments: once each, cut at the limit, so files the timings misjudge (a moved
 * heavy file weighs the median) never hold the runner past it. Its JSON report says how it ended.
 */
export function firstRunArgs(
  filters: readonly string[],
  playwrightArgs: readonly string[],
): string[] {
  return [
    ...testArgs(filters, 1, playwrightArgs),
    `--global-timeout=${REPEAT_LIMIT_SECONDS * 1000}`,
    '--reporter=list,html,json',
  ];
}

/** What Playwright's JSON reporter writes that tells how a run ended. */
export interface RunReport {
  stats?: { unexpected?: number; flaky?: number };
  errors?: readonly { message?: string }[];
}

/**
 * How the first run ended, by its exit status and JSON report: `timed out` only when Playwright
 * cut it at the global timeout and no test had failed, so a failure is never read as the limit.
 */
export function firstRunOutcome(
  status: number,
  report: RunReport | undefined,
): 'passed' | 'failed' | 'timed out' {
  if (status === 0) return 'passed';
  const failed = (report?.stats?.unexpected ?? 1) + (report?.stats?.flaky ?? 0) > 0;
  const cut = (report?.errors ?? []).some((error) =>
    /Timed out waiting \S+ for the test suite to run/.test(error.message ?? ''),
  );
  return cut && !failed ? 'timed out' : 'failed';
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

/** Runs Playwright with `args`; its exit status and seconds. */
function playwright(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): { status: number; seconds: number } {
  const started = performance.now();
  const run = spawnSync('npx', args, { stdio: 'inherit', env });
  return { status: run.status ?? 1, seconds: (performance.now() - started) / 1000 };
}

/** The JSON report a run wrote, or undefined when it wrote none. */
function readReport(file: string): RunReport | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as RunReport;
  } catch {
    return undefined;
  }
}

/** Runs the changed files once, then `repeatsAfter` that run's seconds more times, with no retry. */
function run(base: string, playwrightArgs: readonly string[]): number {
  const { rootDir, files } = changed(base);
  if (files.length === 0) {
    console.log(`e2e repeat: no spec file changed since ${base}; nothing to run.`);
    return 0;
  }
  const count = `${files.length} spec ${files.length === 1 ? 'file' : 'files'}`;
  const timings = JSON.parse(readFileSync(timingsFile(), 'utf8')) as Timings;
  const fallback = defaultSeconds(specFiles(list()), timings);
  const estimate = estimateSeconds(files, timings, fallback);
  if (estimate > REPEAT_LIMIT_SECONDS) {
    console.log(
      `::warning title=e2e repeat::${count} changed, about ${duration(estimate)} a run by the ` +
        `timings, past the repeat's limit of ${duration(REPEAT_LIMIT_SECONDS)}; none is repeated, ` +
        'and the shards ran each once.',
    );
    return 0;
  }
  console.log(
    `e2e repeat: ${count} changed since ${base}, run once, then again by that run's time:`,
  );
  for (const file of files) console.log(`  ${file}${file in timings ? '' : ' (no timing yet)'}`);

  const filters = files.map((file) => fileFilter(rootDir, file));
  const selected = specFiles(list(filters));
  if (JSON.stringify(selected) !== JSON.stringify(files)) {
    console.error(`The filters select ${JSON.stringify(selected)}, not the changed spec files.`);
    return 1;
  }
  const report = join(rootDir, '..', 'test-results', 'results.json');
  // A report an earlier run left must never be read as this one's.
  rmSync(report, { force: true });
  const first = playwright(firstRunArgs(filters, playwrightArgs), {
    ...process.env,
    PLAYWRIGHT_JSON_OUTPUT_FILE: report,
    PLAYWRIGHT_HTML_OPEN: 'never',
  });
  const outcome = firstRunOutcome(first.status, readReport(report));
  if (outcome === 'failed') return first.status || 1;
  if (outcome === 'timed out') {
    console.log(
      `::warning title=e2e repeat::The first run of the ${count} was cut at the repeat's limit of ` +
        `${duration(REPEAT_LIMIT_SECONDS)} with no test failed; none is repeated, and the shards ran ` +
        'each once.',
    );
    return 0;
  }
  const more = repeatsAfter(first.seconds);
  if (more === 0) {
    console.log(
      `::warning title=e2e repeat::The first run of the ${count} took ${duration(first.seconds)}, ` +
        `past the repeat's limit of ${duration(REPEAT_LIMIT_SECONDS)}; it ran once, as its shards did.`,
    );
    return 0;
  }
  console.log(
    `e2e repeat: the first run took ${duration(first.seconds)}; running each ${more} more ` +
      `${more === 1 ? 'time' : 'times'}, ${more + 1} in all.`,
  );
  return playwright(testArgs(filters, more, playwrightArgs)).status;
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
