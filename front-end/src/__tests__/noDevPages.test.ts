// @vitest-environment node
/**
 * A production build holds none of the component library (T200): `src/dev/` is a development
 * build's only, and the build is where a slip that bundles it is caught.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { findDevPages, report } from '../../scripts/no-dev-pages';
import { LIBRARY_MARKER, LIBRARY_PATH } from '../dev/library/marker';

let dist: string | undefined;

afterEach(() => {
  if (dist) rmSync(dist, { recursive: true });
  dist = undefined;
});

function builtDist(files: Record<string, string>): string {
  dist = mkdtempSync(join(tmpdir(), 'no-dev-pages-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dist, path)), { recursive: true });
    writeFileSync(join(dist, path), content);
  }
  return dist;
}

describe('findDevPages', () => {
  it("finds the library's marker in a built chunk", () => {
    const dir = builtDist({
      'index.html': '<div id="app"></div>',
      'assets/index-AAAA.js': 'export const ok=1;',
      'assets/LibraryIndexView-BBBB.js': `const m="${LIBRARY_MARKER}";`,
    });

    expect(findDevPages(dir)).toEqual([
      { file: 'assets/LibraryIndexView-BBBB.js', found: 'the library marker' },
    ]);
  });

  it("finds the library's address, in any file the build emits", () => {
    const dir = builtDist({
      'assets/index-AAAA.js': `r.addRoute({path:"${LIBRARY_PATH}/:entry"})`,
      'assets/deep/data.json': `{"to":"${LIBRARY_PATH}"}`,
    });

    expect(findDevPages(dir).map((finding) => finding.file)).toEqual([
      'assets/deep/data.json',
      'assets/index-AAAA.js',
    ]);
  });

  it('passes a build with neither', () => {
    const dir = builtDist({
      'index.html': '<div id="app"></div>',
      'assets/index-AAAA.js': 'const p="/dev/null";const q="/markets";',
      'assets/index-AAAA.css': '.a{color:red}',
    });

    expect(findDevPages(dir)).toEqual([]);
  });
});

describe('report', () => {
  it('passes a build with no finding', () => {
    expect(report([]).ok).toBe(true);
  });

  it('fails on a finding, naming its file and how to clear it', () => {
    const { ok, lines } = report([{ file: 'assets/a.js', found: 'the library marker' }]);
    expect(ok).toBe(false);
    const text = lines.join('\n');
    expect(text).toContain('assets/a.js');
    expect(text).toContain('import.meta.env.DEV');
  });
});
