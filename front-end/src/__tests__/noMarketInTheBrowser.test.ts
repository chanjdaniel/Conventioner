/**
 * Nothing about a market is stored in the browser (E21/F02/S05).
 *
 * The whole market used to live in `localStorage` under `market`: written by eleven call sites that
 * each patched their own copy, read by five screens, and trusted over the server by the ones that
 * never fetched. It is how the form builder ignored a phase change until the organizer changed tabs,
 * and how a stale copy came to be sent back to the server. The back end is the only source of truth
 * now, held in one store; the dashboard's `lastMarketId` is a pointer, never a copy.
 *
 * This reads the source rather than the running app, so the next file that reaches for the old key
 * fails here, by name, instead of drifting back in unnoticed.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath } from 'node:path';

const SRC = resolvePath(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(path);
    return /\.(ts|vue)$/.test(entry) ? [path] : [];
  });
}

/** `localStorage.getItem('market')`, `.setItem("market", ...)`, `.removeItem(`market`)`. */
const STORED_MARKET = /localStorage\s*\.\s*(get|set|remove)Item\(\s*['"`]market['"`]/;

describe('no market in the browser', () => {
  const files = sourceFiles(SRC);

  it('reads the source it claims to', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no source file reads, writes or removes the stored market', () => {
    const offenders = files
      .filter((file) => STORED_MARKET.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));

    expect(offenders).toEqual([]);
  });

  it('would catch one that did', () => {
    expect(STORED_MARKET.test(`localStorage.setItem('market', JSON.stringify(m))`)).toBe(true);
    expect(STORED_MARKET.test(`localStorage.getItem("market")`)).toBe(true);
    expect(STORED_MARKET.test(`localStorage.getItem('lastMarketId')`)).toBe(false);
  });
});
