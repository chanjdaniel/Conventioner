/**
 * No screen decides a permission from a role (E39/F01/S02).
 *
 * Each screen used to read one of five role-shaped reasons, and Manage market and the market list
 * compared the person's role themselves, so what a role may do was written into the screens as well
 * as the server, and a rule changed on the server would have left them offering the old one. A
 * screen now asks the table's answer for the action its control takes (`utils/marketActions.ts`).
 *
 * This reads the source, as `noMarketInTheBrowser.test.ts` does, so the next file that reads the
 * person's role to decide what to offer fails here, by name.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath } from 'node:path';

const SRC = resolvePath(process.cwd(), 'src');

/** The parser carries the role the server serves, for nothing to compare. */
const CARRIES_THE_ROLE = new Set(['utils/market.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(path);
    return /\.(ts|vue)$/.test(entry) ? [path] : [];
  });
}

/** What a role threshold looks like in a screen, each by name. */
const THRESHOLDS: Array<[string, RegExp]> = [
  // `role === MarketRole.Owner`, `MarketRole.Admin !== role`.
  ['compares a market role', /[=!]==?\s*MarketRole\.\w+|MarketRole\.\w+\s*[=!]==?/],
  // `[MarketRole.Owner, MarketRole.Admin].includes(role)`.
  ['looks a role up in a list', /\[[^\]]*MarketRole\.\w+[^\]]*\]\s*\.includes\(/],
  // A rank: `Record<MarketRole, number>`, `roleHierarchy[...]`, `hasPermission(...)`.
  ['ranks the roles', /Record<\s*MarketRole\s*,\s*number\s*>|\broleHierarchy\b|\bhasPermission\(/],
  // The person's own role on a market, which is only ever read to compare it.
  ['reads the role this person holds', /\bmarket\w*(\.value)?\??\.(userRole|user_role)\b/i],
];

function thresholdsIn(source: string): string[] {
  return THRESHOLDS.filter(([, pattern]) => pattern.test(source)).map(([what]) => what);
}

describe('no screen compares a role', () => {
  const files = sourceFiles(SRC);

  it('reads the source it claims to', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no source file decides a permission from a role', () => {
    const offenders = files
      .map((file) => relative(SRC, file))
      .filter((file) => !CARRIES_THE_ROLE.has(file))
      .flatMap((file) =>
        thresholdsIn(readFileSync(join(SRC, file), 'utf8')).map((what) => `${file}: ${what}`),
      );

    expect(offenders).toEqual([]);
  });

  it('would catch one that did, in each shape', () => {
    expect(thresholdsIn('if (props.market.userRole === MarketRole.Owner) {')).toEqual([
      'compares a market role',
      'reads the role this person holds',
    ]);
    expect(thresholdsIn('const ok = MarketRole.Admin !== role;')).toEqual([
      'compares a market role',
    ]);
    expect(thresholdsIn('[MarketRole.Owner, MarketRole.Admin].includes(role)')).toEqual([
      'looks a role up in a list',
    ]);
    expect(thresholdsIn('const rank: Record<MarketRole, number> = {};')).toEqual([
      'ranks the roles',
    ]);
    expect(thresholdsIn('return hasPermission(role, required);')).toEqual(['ranks the roles']);
    expect(thresholdsIn('const role = marketData.value?.userRole;')).toEqual([
      'reads the role this person holds',
    ]);
  });

  it('lets a role be named as the one given, and an organization role be read', () => {
    expect(thresholdsIn('const newUserRole = ref<MarketRole>(MarketRole.Editor);')).toEqual([]);
    expect(thresholdsIn('[MarketRole.Admin, MarketRole.Editor].filter(keep)')).toEqual([]);
    expect(thresholdsIn('const role = orgData.value?.userRole;')).toEqual([]);
  });
});
