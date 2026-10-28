/**
 * No string is evaluated as script (T84): fails when any JavaScript file of a build calls `eval` or
 * the `Function` constructor.
 *
 * The Content-Security-Policy in `vercel.json` has no `'unsafe-eval'`, so such a call is refused
 * once the policy is enforcing, and reported while it is report-only. It has no reporting endpoint,
 * so a report in production reaches nobody: this is where a new one is caught, at build time. The
 * first one found was vuedraggable's UMD build, whose bundled core-js looks up the global object
 * with `Function('return this')()`; `vite.config.ts` resolves vuedraggable to its ES source instead.
 *
 * Run it after `vite build`: `npm run build-only && npm run no-eval`. CI does, in the required
 * `frontend-lint-and-types` job, and so does `scripts/nm-test.sh`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `eval(` or `Function(`, `new Function(` included, as a call of its own rather than a member's;
 * not a regular expression's group (`/Function(?:Expression)/`).
 */
const STRING_EVALUATION = /(?<![\w$.])(?:eval|Function)\s*\((?!\?)/g;

export interface Finding {
  file: string;
  excerpt: string;
}

/** Every call that evaluates a string, in the `.js` files under `assets/` of `distDir`. */
export function findStringEvaluation(distDir: string): Finding[] {
  const assets = join(distDir, 'assets');
  return readdirSync(assets)
    .filter((file) => file.endsWith('.js'))
    .sort()
    .flatMap((file) => {
      const source = readFileSync(join(assets, file), 'utf8');
      return [...source.matchAll(STRING_EVALUATION)].map((match) => ({
        file: `assets/${file}`,
        excerpt: source.slice(Math.max(0, match.index - 40), match.index + 40).replace(/\s+/g, ' '),
      }));
    });
}

/** What to print, and whether the build evaluates no string. */
export function report(findings: Finding[]): { ok: boolean; lines: string[] } {
  if (findings.length === 0) return { ok: true, lines: ['No string is evaluated as script.'] };
  return {
    ok: false,
    lines: [
      'These calls evaluate a string as script, which the Content-Security-Policy refuses:',
      ...findings.map((finding) => `  ${finding.file}: ...${finding.excerpt}...`),
      'Find the dependency that ships it and resolve an ES build of it without the call, as ' +
        'vite.config.ts does for vuedraggable, or replace it.',
    ],
  };
}

if (import.meta.main) {
  const { ok, lines } = report(
    findStringEvaluation(fileURLToPath(new URL('../dist/', import.meta.url))),
  );
  for (const line of lines) (ok ? console.log : console.error)(line);
  process.exitCode = ok ? 0 : 1;
}
