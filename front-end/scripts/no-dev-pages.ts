/**
 * No development page ships (T200): fails when any file a build emits holds the component library's
 * marker string or its address.
 *
 * The library (`src/dev/`) is reached only through the router's `if (import.meta.env.DEV)` block,
 * which `vite build` turns into dead code, so a production build emits none of it. A static import
 * of `src/dev/` from the app, or a change that keeps that block alive, would put a page of synthetic
 * data and every unconverted prototype on `conventioner.io`; this is where it is caught.
 *
 * Run it after `vite build`: `npm run build-only && npm run no-dev-pages`. CI does, in the required
 * `frontend-lint-and-types` job, and so does `scripts/nm-test.sh`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIBRARY_MARKER, LIBRARY_PATH } from '../src/dev/library/marker.ts';

export interface Finding {
  file: string;
  found: 'the library marker' | 'the library address';
}

/** Every file under `dir`, at any depth, as a path from `root`, in order. */
function everyFile(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? everyFile(root, path) : [relative(root, path)];
    });
}

/** Each file under `distDir` that holds the library's marker or its address. */
export function findDevPages(distDir: string): Finding[] {
  return everyFile(distDir).flatMap((file): Finding[] => {
    const text = readFileSync(join(distDir, file), 'latin1');
    if (text.includes(LIBRARY_MARKER)) return [{ file, found: 'the library marker' }];
    if (text.includes(LIBRARY_PATH)) return [{ file, found: 'the library address' }];
    return [];
  });
}

/** What to print, and whether the build holds no development page. */
export function report(findings: Finding[]): { ok: boolean; lines: string[] } {
  if (findings.length === 0) return { ok: true, lines: ['No development page is in the build.'] };
  return {
    ok: false,
    lines: [
      'The component library, a development build only, is in this build:',
      ...findings.map((finding) => `  ${finding.file}: ${finding.found}`),
      'Only the router may import src/dev/, inside `if (import.meta.env.DEV)`, by a lazy ' +
        'import(); find what reaches it another way and remove it.',
    ],
  };
}

if (import.meta.main) {
  const { ok, lines } = report(findDevPages(fileURLToPath(new URL('../dist/', import.meta.url))));
  for (const line of lines) (ok ? console.log : console.error)(line);
  process.exitCode = ok ? 0 : 1;
}
