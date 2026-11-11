// @vitest-environment node
/**
 * Every front-end build says which commit it was built from (T254), at `/version.json`.
 *
 * The Deploy workflow reads that file on the staged deployment and on `conventioner.io` to prove
 * which build serves, and a person reads it to answer "which build is live". The commit comes from
 * `BUILD_COMMIT` in the build's environment, which `vercel deploy --build-env` sets; a build made
 * without it, a local or CI one, says `null`. This builds with the project's own configuration, as
 * production builds, and reads what comes out.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  build,
  loadConfigFromFile,
  mergeConfig,
  type InlineConfig,
  type Rolldown,
  type UserConfig,
} from 'vite';

const ROOT = process.cwd();
const SHA = '0123456789abcdef0123456789abcdef01234567';

/**
 * The project's own `vite.config.ts`, loaded as a production build loads it, after the case has set
 * `BUILD_COMMIT`, as `vercel deploy --build-env` sets it before the build reads its config.
 */
async function projectConfig(): Promise<UserConfig> {
  // The config refuses a production build with no reCAPTCHA site key; these bundles are never served.
  const allowInsecure = process.env.VITE_ALLOW_INSECURE_LOCAL_DEV;
  process.env.VITE_ALLOW_INSECURE_LOCAL_DEV = 'true';
  try {
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      resolve(ROOT, 'vite.config.ts'),
      ROOT,
      'silent',
    );
    return loaded!.config;
  } finally {
    if (allowInsecure === undefined) delete process.env.VITE_ALLOW_INSECURE_LOCAL_DEV;
    else process.env.VITE_ALLOW_INSECURE_LOCAL_DEV = allowInsecure;
  }
}

const savedCommit = process.env.BUILD_COMMIT;

afterEach(() => {
  if (savedCommit === undefined) delete process.env.BUILD_COMMIT;
  else process.env.BUILD_COMMIT = savedCommit;
});

/** Builds, as production does, one entry module that logs `BUILD_COMMIT` if the bundle had it. */
async function buildOutput(): Promise<(Rolldown.OutputChunk | Rolldown.OutputAsset)[]> {
  const scratch = mkdtempSync(join(tmpdir(), 'build-says-its-commit-'));
  try {
    const entry = join(scratch, 'entry.ts');
    writeFileSync(entry, 'export const commit = String(import.meta.env.BUILD_COMMIT);\n');
    const one: InlineConfig = {
      configFile: false,
      logLevel: 'silent',
      build: { write: false, lib: { entry, formats: ['es'] } },
    };
    // Vitest runs under NODE_ENV=test, which Vite reads as a development build; a production
    // build is what ships.
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const result = await build(mergeConfig(await projectConfig(), one));
      return (Array.isArray(result) ? result : [result]).flatMap((r) =>
        'output' in r ? r.output : [],
      );
    } finally {
      process.env.NODE_ENV = nodeEnv;
    }
  } finally {
    rmSync(scratch, { recursive: true });
  }
}

/** The text of the `version.json` the build emits at the root of its output. */
function versionJson(output: (Rolldown.OutputChunk | Rolldown.OutputAsset)[]): string {
  const asset = output.find((o) => o.type === 'asset' && o.fileName === 'version.json');
  expect(asset, 'the build emitted no version.json').toBeDefined();
  const source = (asset as Rolldown.OutputAsset).source;
  return typeof source === 'string' ? source : new TextDecoder().decode(source);
}

describe('version.json', () => {
  it('holds the commit BUILD_COMMIT names', async () => {
    process.env.BUILD_COMMIT = SHA;
    expect(versionJson(await buildOutput())).toBe(`{"commit":"${SHA}"}`);
  }, 60_000);

  it('says null when BUILD_COMMIT is unset', async () => {
    delete process.env.BUILD_COMMIT;
    expect(versionJson(await buildOutput())).toBe('{"commit":null}');
  }, 60_000);

  it.each([[''], ['   '], ['\t\n']])(
    'says null when BUILD_COMMIT is blank (%j)',
    async (blank) => {
      process.env.BUILD_COMMIT = blank;
      expect(versionJson(await buildOutput())).toBe('{"commit":null}');
    },
    60_000,
  );

  it('never puts the commit into a chunk', async () => {
    process.env.BUILD_COMMIT = SHA;
    const chunks = (await buildOutput()).filter((o) => o.type === 'chunk');
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) expect(chunk.code).not.toContain(SHA);
  }, 60_000);
});
