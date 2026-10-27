/**
 * The bundle budget (T76) measures what a first visit downloads before any page paints: the module
 * script `dist/index.html` loads and every chunk it preloads, gzipped. A route's lazy chunk is not
 * in that set, which is the point - Konva once rode in it because `main.ts` installed vue-konva for
 * every page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { entryChunks, measure, report } from '../../scripts/bundle-budget';

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <link rel="icon" href="/favicon.ico" />
    <script type="module" crossorigin src="/assets/index-AAAA.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-BBBB.js">
    <link rel="stylesheet" crossorigin href="/assets/index-CCCC.css">
  </head>
  <body><div id="app"></div></body>
</html>`;

let dist: string | undefined;

afterEach(() => {
  if (dist) rmSync(dist, { recursive: true });
  dist = undefined;
});

function builtDist(files: Record<string, string>): string {
  dist = mkdtempSync(join(tmpdir(), 'bundle-budget-'));
  mkdirSync(join(dist, 'assets'));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dist, path), content);
  return dist;
}

describe('entryChunks', () => {
  it('names the module script and every preloaded module, and nothing else', () => {
    expect(entryChunks(INDEX_HTML)).toEqual(['assets/index-AAAA.js', 'assets/vendor-BBBB.js']);
  });

  it('recognises the tags however their names are cased, as HTML does', () => {
    const html = `<HTML><HEAD>
      <SCRIPT TYPE="MODULE" SRC="/assets/index-AAAA.js"></SCRIPT>
      <LINK REL="MODULEPRELOAD" HREF="/assets/vendor-BBBB.js">
    </HEAD></HTML>`;
    expect(entryChunks(html)).toEqual(['assets/index-AAAA.js', 'assets/vendor-BBBB.js']);
  });

  it('refuses a page that loads no module script, rather than measuring nothing', () => {
    expect(() => entryChunks('<html><head></head></html>')).toThrow(/no module script/);
  });
});

describe('measure', () => {
  it('sums the gzipped size of the entry chunks, leaving out lazy chunks and styles', () => {
    const entry = 'console.log("entry");'.repeat(50);
    const vendor = 'export const vendor = 1;'.repeat(80);
    const dir = builtDist({
      'index.html': INDEX_HTML,
      'assets/index-AAAA.js': entry,
      'assets/vendor-BBBB.js': vendor,
      'assets/index-CCCC.css': 'body{}'.repeat(1000),
      'assets/FloorplanEditorView-DDDD.js': 'konva'.repeat(5000),
    });

    const sizes = measure(dir);

    expect(sizes.chunks.map((chunk) => chunk.file)).toEqual([
      'assets/index-AAAA.js',
      'assets/vendor-BBBB.js',
    ]);
    const expected = [entry, vendor].map((text) => gzipSync(text, { level: 9 }).length);
    expect(sizes.chunks.map((chunk) => chunk.gzipBytes)).toEqual(expected);
    expect(sizes.totalGzipBytes).toBe(expected[0] + expected[1]);
  });
});

describe('report', () => {
  const sizes = {
    chunks: [
      { file: 'assets/index-AAAA.js', gzipBytes: 60_000 },
      { file: 'assets/vendor-BBBB.js', gzipBytes: 40_000 },
    ],
    totalGzipBytes: 100_000,
  };

  it('passes at or under the limit, printing every chunk and the total either way', () => {
    const { ok, lines } = report(sizes, 100_000);
    expect(ok).toBe(true);
    const text = lines.join('\n');
    expect(text).toContain('assets/index-AAAA.js');
    expect(text).toContain('assets/vendor-BBBB.js');
    expect(text).toMatch(/100000 B.*limit 100000 B/);
  });

  it('fails above the limit, and says how to raise it on purpose', () => {
    const { ok, lines } = report(sizes, 99_999);
    expect(ok).toBe(false);
    expect(lines.join('\n')).toMatch(/Over the budget by 1 B/);
    expect(lines.join('\n')).toContain('LIMIT_GZIP_BYTES');
  });
});
