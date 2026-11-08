/**
 * The e2e shards (T234): deals the Playwright spec files to CI's shards by measured time, and runs
 * one shard's hand.
 *
 * Playwright's own `--shard` cuts the alphabetical list of spec files into runs of equal test count,
 * whatever the tests cost: on its first six-shard run the three people-at-scale files, whose names
 * sort together, all landed on one shard, which ran 24 minutes of tests while another ran 6. Here
 * every shard lists the suite itself, deals each spec file to the shard with the least time so far,
 * heaviest first by the seconds in `e2e-shard-timings.json`, and runs its own hand. The dealing
 * depends only on the list and the timings, so every runner deals the same hands, and each file is
 * in exactly one.
 *
 * Run one shard, from `front-end/`, as CI's `e2e-shard` job does:
 *
 *   node scripts/e2e-shards.ts --shard=3/6
 *
 * A spec file with no timing yet weighs the median of those measured, so a new file is dealt as an
 * ordinary one until the timings are refreshed. Refresh them from a CI run's Playwright reports, the
 * `e2e-results-shard-*` artifacts every shard uploads:
 *
 *   gh run download <run id> -R chanjdaniel/Conventioner -p 'e2e-results-shard-*' -D <dir>
 *   node scripts/e2e-shards.ts refresh <dir>
 *
 * and commit the rewritten `scripts/e2e-shard-timings.json`.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Each spec file's measured seconds, its path relative to Playwright's `testDir`. */
export type Timings = Readonly<Record<string, number>>;

/** The committed timings, beside this script; resolved when used, so a unit test can import it. */
const timingsFile = () => fileURLToPath(new URL('./e2e-shard-timings.json', import.meta.url));

/** The weight of a file with no timing: the median of the files measured, or 1 when none are. */
export function defaultSeconds(files: readonly string[], seconds: Timings): number {
  const known = files
    .map((file) => seconds[file])
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  if (known.length === 0) return 1;
  const middle = Math.floor(known.length / 2);
  return known.length % 2 === 1 ? known[middle]! : (known[middle - 1]! + known[middle]!) / 2;
}

/**
 * The spec files dealt to `total` shards: heaviest first, each to the shard with the least time so
 * far (the lowest-numbered on a tie), ties between files broken by name, so the hands depend on the
 * files and their timings alone, never on the order the files were listed in. Each hand runs in
 * alphabetical order.
 */
export function dealShards(files: readonly string[], seconds: Timings, total: number): string[][] {
  if (!Number.isInteger(total) || total < 1) throw new Error(`a shard count of ${total}`);
  const unique = new Set(files);
  if (unique.size !== files.length) {
    const twice = files.find((file, n) => files.indexOf(file) !== n);
    throw new Error(`${twice} is listed twice`);
  }
  const fallback = defaultSeconds(files, seconds);
  const weight = (file: string) => seconds[file] ?? fallback;
  const order = [...unique].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0));
  const hands: string[][] = Array.from({ length: total }, () => []);
  const load: number[] = Array.from({ length: total }, () => 0);
  for (const file of order) {
    const lightest = load.indexOf(Math.min(...load));
    hands[lightest]!.push(file);
    load[lightest]! += weight(file);
  }
  return hands.map((hand) => hand.sort());
}

/** `--shard`'s "current/total", 1-based. */
export function parseShard(value: string): { current: number; total: number } {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  const current = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || total < 1 || current < 1 || current > total) {
    throw new Error(`--shard takes "current/total", 1-based, as 3/6, not "${value}"`);
  }
  return { current, total };
}

/** Escapes a path for a regular expression, its slashes too, since the filter is `/source/`. */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * A Playwright command-line filter matching the one spec file and no other: Playwright reads an
 * argument as an unanchored regular expression over the file's absolute path, so the bare name
 * `tables.spec.ts` would run `the-tables.spec.ts` as well.
 */
export function fileFilter(rootDir: string, file: string): string {
  return `/^${escape(`${rootDir.replace(/\/$/, '')}/${file}`)}$/`;
}

interface ReportSuite {
  file?: string;
  specs?: { tests?: { results?: { duration?: number }[] }[] }[];
  suites?: ReportSuite[];
}

interface Report {
  config?: { rootDir?: string };
  suites?: ReportSuite[];
}

/** The spec files a Playwright JSON report names, each once, in alphabetical order. */
export function specFiles(report: Report): string[] {
  return [...new Set((report.suites ?? []).map((suite) => suite.file!))].sort();
}

/** Every attempt's milliseconds in a suite and the suites inside it. */
function milliseconds(suite: ReportSuite): number {
  let sum = 0;
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) sum += result.duration ?? 0;
    }
  }
  for (const inner of suite.suites ?? []) sum += milliseconds(inner);
  return sum;
}

/**
 * Each spec file's seconds over the shards' reports, every attempt counted, since a retry takes
 * the shard's time too; to a tenth of a second, the files in alphabetical order.
 */
export function secondsFromReports(reports: readonly Report[]): Record<string, number> {
  const sums = new Map<string, number>();
  for (const report of reports) {
    for (const suite of report.suites ?? []) {
      sums.set(suite.file!, (sums.get(suite.file!) ?? 0) + milliseconds(suite));
    }
  }
  return Object.fromEntries(
    [...sums.keys()].sort().map((file) => [file, Math.round(sums.get(file)! / 100) / 10]),
  );
}

/** Playwright's list of the suite, or of the files the filters name, as a JSON report. */
function list(filters: readonly string[] = []): Report {
  const listed = spawnSync('npx', ['playwright', 'test', '--list', '--reporter=json', ...filters], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (listed.status !== 0) throw new Error(`playwright test --list exited ${listed.status}`);
  return JSON.parse(listed.stdout) as Report;
}

/** Lists the suite, deals it, checks Playwright selects exactly this shard's hand, and runs it. */
function runShard(shard: string, playwrightArgs: readonly string[]): number {
  const { current, total } = parseShard(shard);
  const suite = list();
  const rootDir = suite.config?.rootDir;
  if (!rootDir) throw new Error("Playwright's list names no rootDir");
  const timings = JSON.parse(readFileSync(timingsFile(), 'utf8')) as Timings;
  const files = specFiles(suite);
  const hand = dealShards(files, timings, total)[current - 1]!;
  const fallback = defaultSeconds(files, timings);
  const minutes = hand.reduce((sum, file) => sum + (timings[file] ?? fallback), 0) / 60;
  console.log(
    `e2e shard ${current}/${total}: ${hand.length} of ${files.length} spec files, ` +
      `about ${minutes.toFixed(1)} minutes of tests by the timings`,
  );
  for (const file of hand) console.log(`  ${file}${file in timings ? '' : ' (no timing yet)'}`);
  if (hand.length === 0) return 0;

  const filters = hand.map((file) => fileFilter(rootDir, file));
  const selected = specFiles(list(filters));
  if (JSON.stringify(selected) !== JSON.stringify(hand)) {
    console.error(`The filters select ${JSON.stringify(selected)}, not this shard's hand.`);
    return 1;
  }
  const run = spawnSync('npx', ['playwright', 'test', ...filters, ...playwrightArgs], {
    stdio: 'inherit',
  });
  return run.status ?? 1;
}

/** Every `*.json` under `dir`, at any depth, as `gh run download` lays the artifacts out. */
function jsonFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return jsonFiles(path);
      return name.endsWith('.json') ? [path] : [];
    });
}

/** Rewrites the timings from the Playwright reports under `dir`. */
function refresh(dir: string): number {
  const reports = jsonFiles(dir).map((path) => JSON.parse(readFileSync(path, 'utf8')) as Report);
  const seconds = secondsFromReports(reports);
  const files = Object.keys(seconds).length;
  if (files === 0) {
    console.error(`No Playwright JSON report under ${dir}.`);
    return 1;
  }
  writeFileSync(timingsFile(), `${JSON.stringify(seconds, null, 2)}\n`);
  const minutes = Object.values(seconds).reduce((sum, value) => sum + value, 0) / 60;
  console.log(
    `${timingsFile()}: ${files} spec files from ${reports.length} reports, ` +
      `${minutes.toFixed(1)} minutes of tests`,
  );
  return 0;
}

if (import.meta.main) {
  const [first, ...rest] = process.argv.slice(2);
  if (first === 'refresh' && rest.length === 1) {
    process.exitCode = refresh(rest[0]!);
  } else if (first?.startsWith('--shard=')) {
    process.exitCode = runShard(first.slice('--shard='.length), rest);
  } else {
    console.error(
      'Usage: node scripts/e2e-shards.ts --shard=<current>/<total> [playwright args]\n' +
        '       node scripts/e2e-shards.ts refresh <dir of Playwright JSON reports>',
    );
    process.exitCode = 2;
  }
}
