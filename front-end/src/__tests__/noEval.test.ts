// @vitest-environment node
/**
 * A build evaluates no string as script (T84): the Content-Security-Policy has no `'unsafe-eval'`,
 * and with no reporting endpoint, a call that only production would report reaches nobody.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findStringEvaluation, report } from '../../scripts/no-eval';

let dist: string | undefined;

afterEach(() => {
  if (dist) rmSync(dist, { recursive: true });
  dist = undefined;
});

function builtDist(files: Record<string, string>): string {
  dist = mkdtempSync(join(tmpdir(), 'no-eval-'));
  mkdirSync(join(dist, 'assets'));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dist, path), content);
  return dist;
}

describe('findStringEvaluation', () => {
  it("finds core-js's global lookup, as vuedraggable's UMD build shipped it", () => {
    const dir = builtDist({
      'assets/MarketSetupView-AAAA.js':
        'var n=(function(){return this})();try{n||=Function(`return this`)()}catch{}',
      'assets/index-BBBB.js': 'export const ok=1;',
    });

    expect(findStringEvaluation(dir)).toEqual([
      {
        file: 'assets/MarketSetupView-AAAA.js',
        excerpt: expect.stringContaining('Function(`return this`)'),
      },
    ]);
  });

  it.each(['eval("x")', 'new Function("a","return a")', 'window.x=1;eval (code)'])(
    'finds %s',
    (code) => {
      expect(findStringEvaluation(builtDist({ 'assets/a.js': code }))).toHaveLength(1);
    },
  );

  it.each([
    'isFunction(x)',
    'typeof x=="function"',
    'obj.eval(x)',
    'retrieval(x)',
    '$Function(x)',
    'x instanceof Function',
    'const io=e=>/Function(?:Expression|Declaration)$/.test(e)',
  ])('lets %s pass', (code) => {
    expect(findStringEvaluation(builtDist({ 'assets/a.js': code }))).toEqual([]);
  });

  it('reads only JavaScript', () => {
    const dir = builtDist({ 'assets/index.css': '.a{content:"eval(x)"}' });
    expect(findStringEvaluation(dir)).toEqual([]);
  });
});

describe('report', () => {
  it('passes a build with no finding', () => {
    expect(report([]).ok).toBe(true);
  });

  it('fails on a finding, naming its file and how to clear it', () => {
    const { ok, lines } = report([{ file: 'assets/a.js', excerpt: 'Function(`return this`)()' }]);
    expect(ok).toBe(false);
    const text = lines.join('\n');
    expect(text).toContain('assets/a.js');
    expect(text).toContain('vuedraggable');
  });
});
