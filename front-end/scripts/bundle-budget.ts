/**
 * The bundle budget (T76): fails when the JavaScript a first visit downloads before any page
 * paints grows past a set gzipped size.
 *
 * That JavaScript is the module script `dist/index.html` loads plus every chunk it preloads; a
 * route's lazily loaded chunk is not in it. Every page paid for Konva, the floorplan canvas
 * library, until T76, because `main.ts` installed vue-konva for the whole app, and nothing noticed.
 *
 * Run it after `vite build`: `npm run build-only && npm run bundle-budget`. CI does, in the required
 * `frontend-lint-and-types` job, and so does `scripts/nm-test.sh`.
 *
 * To raise the limit on purpose, raise `LIMIT_GZIP_BYTES` in the same PR as the code that needs it,
 * and say in that PR what the extra bytes buy; keep it a few KB above the measured total so the next
 * unplanned growth still fails.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Measured at 102220 B when T76 moved Konva out; the rest is headroom. */
export const LIMIT_GZIP_BYTES = 105_000;

export interface ChunkSize {
  file: string;
  gzipBytes: number;
}

export interface EntrySizes {
  chunks: ChunkSize[];
  totalGzipBytes: number;
}

/** The JavaScript files `index.html` loads before the app runs, relative to `dist/`. */
export function entryChunks(indexHtml: string): string[] {
  const attributes = (tag: string) =>
    Object.fromEntries(
      [...tag.matchAll(/([a-z-]+)(?:="([^"]*)")?/gi)].map(([, name, value]) => [
        name.toLowerCase(),
        value ?? '',
      ]),
    );
  const scripts: string[] = [];
  const preloads: string[] = [];
  for (const [tag] of indexHtml.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const attrs = attributes(tag);
    const name = tag
      .slice(1)
      .split(/[\s/>]/, 1)[0]
      .toLowerCase();
    if (name === 'script' && attrs.type?.toLowerCase() === 'module' && attrs.src)
      scripts.push(attrs.src);
    if (name === 'link' && attrs.rel?.toLowerCase() === 'modulepreload' && attrs.href)
      preloads.push(attrs.href);
  }
  if (scripts.length === 0) {
    throw new Error('dist/index.html has no module script: is this a Vite build?');
  }
  return [...scripts, ...preloads].map((url) => url.replace(/^\//, ''));
}

/** Each entry chunk's size at gzip level 9, and their sum. */
export function measure(distDir: string): EntrySizes {
  const files = entryChunks(readFileSync(join(distDir, 'index.html'), 'utf8'));
  const chunks = files.map((file) => ({
    file,
    gzipBytes: gzipSync(readFileSync(join(distDir, file)), { level: 9 }).length,
  }));
  return { chunks, totalGzipBytes: chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0) };
}

/** What to print, and whether the total is within `limit`. */
export function report(sizes: EntrySizes, limit: number): { ok: boolean; lines: string[] } {
  const width = Math.max(...sizes.chunks.map((chunk) => chunk.file.length));
  const digits = String(sizes.totalGzipBytes).length;
  const lines = [
    'Entry JavaScript (loaded before the first paint), gzip -9:',
    ...sizes.chunks.map(
      (chunk) => `  ${chunk.file.padEnd(width)}  ${String(chunk.gzipBytes).padStart(digits)} B`,
    ),
    `Total ${sizes.totalGzipBytes} B, limit ${limit} B`,
  ];
  const ok = sizes.totalGzipBytes <= limit;
  if (!ok) {
    lines.push(
      `Over the budget by ${sizes.totalGzipBytes - limit} B. Move what grew behind a lazily ` +
        'loaded route or component, or, if the growth is meant, raise LIMIT_GZIP_BYTES in ' +
        'front-end/scripts/bundle-budget.ts and say why in the PR.',
    );
  }
  return { ok, lines };
}

if (import.meta.main) {
  const { ok, lines } = report(
    measure(fileURLToPath(new URL('../dist/', import.meta.url))),
    LIMIT_GZIP_BYTES,
  );
  for (const line of lines) (ok ? console.log : console.error)(line);
  process.exitCode = ok ? 0 : 1;
}
