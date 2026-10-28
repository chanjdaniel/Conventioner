// @vitest-environment node
/**
 * Every page the front end serves carries the standard security headers and a tight
 * Content-Security-Policy, in report-only mode until it has run in production with no reports.
 * Promoting it is renaming its header to `Content-Security-Policy`, and nothing here changes.
 *
 * `vercel.json` is where they are declared, for every path, and `vite preview` serves the same
 * headers from it, so a production build can be walked locally under the policy production sends.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview, type PreviewServer } from 'vite';

const FRONT_END = fileURLToPath(new URL('../..', import.meta.url));

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

const vercel = JSON.parse(readFileSync(join(FRONT_END, 'vercel.json'), 'utf8')) as {
  headers?: HeaderRule[];
};

function declared(): Record<string, string> {
  const rule = vercel.headers?.find((each) => each.source === '/(.*)');
  return Object.fromEntries((rule?.headers ?? []).map(({ key, value }) => [key, value]));
}

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(';')
      .map((each) => each.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name!, sources]),
  );
}

const POLICY_HEADER = /^Content-Security-Policy(-Report-Only)?$/;

function policyHeader(): string | undefined {
  return Object.keys(declared()).find((key) => POLICY_HEADER.test(key));
}

const policy = () => directives(declared()[policyHeader() ?? ''] ?? '');

describe('the headers vercel.json sends on every path', () => {
  it('are the standard security headers and a policy', () => {
    expect(policyHeader()).toBeDefined();
    expect(declared()).toEqual({
      [policyHeader()!]: expect.any(String),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    });
  });

  it('allow only the app itself unless a directive names more', () => {
    expect(policy().get('default-src')).toEqual(["'self'"]);
    expect(policy().get('object-src')).toEqual(["'none'"]);
    expect(policy().get('base-uri')).toEqual(["'self'"]);
    expect(policy().get('form-action')).toEqual(["'self'"]);
    expect(policy().get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('list every source the app loads from', () => {
    expect(policy().get('script-src')).toEqual([
      "'self'",
      'https://www.google.com/recaptcha/',
      'https://www.gstatic.com/recaptcha/',
    ]);
    expect(policy().get('style-src')).toEqual(["'self'"]);
    expect(policy().get('img-src')).toEqual(["'self'", 'blob:']);
    expect(policy().get('font-src')).toEqual(["'self'"]);
    expect(policy().get('connect-src')).toEqual([
      "'self'",
      'https://api.conventioner.io',
      'https://www.google.com/recaptcha/',
    ]);
    expect(policy().get('frame-src')).toEqual([
      'https://www.google.com/recaptcha/',
      'https://recaptcha.google.com/recaptcha/',
    ]);
  });

  it('let no inline code or eval run', () => {
    const everySource = [...policy().values()].flat();
    expect(everySource).not.toContain("'unsafe-inline'");
    expect(everySource).not.toContain("'unsafe-eval'");
    expect(everySource).not.toContain("'unsafe-hashes'");
    expect(everySource).not.toContain('*');
  });
});

describe('the page vite preview serves', () => {
  let server: PreviewServer | undefined;
  let dist: string | undefined;

  afterEach(async () => {
    await server?.close();
    if (dist) rmSync(dist, { recursive: true });
    server = undefined;
    dist = undefined;
  });

  it.each(['/', '/markets/a-market/review'])(
    'carries the headers vercel.json declares (%s)',
    async (path) => {
      dist = mkdtempSync(join(tmpdir(), 'security-headers-'));
      writeFileSync(
        join(dist, 'index.html'),
        '<!doctype html><html lang="en"><div id="app"></div></html>',
      );
      server = await preview({
        root: FRONT_END,
        logLevel: 'silent',
        build: { outDir: dist },
        preview: { host: '127.0.0.1', port: 0 },
      });

      const response = await fetch(new URL(path, server.resolvedUrls!.local[0]));

      expect(response.status).toBe(200);
      for (const [key, value] of Object.entries(declared())) {
        expect(response.headers.get(key)).toBe(value);
      }
    },
  );
});
