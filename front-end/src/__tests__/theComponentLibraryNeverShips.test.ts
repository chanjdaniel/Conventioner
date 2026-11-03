// @vitest-environment node
/**
 * A production build holds none of the component library (T200): `src/dev/` is a development
 * build's only, reached by the router inside `if (import.meta.env.DEV)`, which `vite build` drops.
 *
 * Two guards hold it, and this drives each through its real seam. ESLint refuses a static import
 * of `src/dev/` from anywhere but the router, by the alias or by a relative path. And the project's
 * own `vite build` fails when any module under `src/dev/` is in a chunk, however it got there: the
 * fixture's 359 synthetic applicants imported by a shipped file is the case it exists for.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { build, loadConfigFromFile, mergeConfig, type InlineConfig, type UserConfig } from 'vite';

const ROOT = process.cwd();
const SRC = resolve(ROOT, 'src');

let config: UserConfig;
let scratch: string;
/** `front-end/` reached through a symbolic link to the checkout above it, as a linked home or workspace folder reaches it. */
let linked: string;
let linkedConfig: UserConfig;

/** The project's own `vite.config.ts`, loaded from `root` as a production build loads it. */
async function projectConfig(root: string): Promise<UserConfig> {
  // The config refuses a production build with no reCAPTCHA site key; these bundles are never served.
  const allowInsecure = process.env.VITE_ALLOW_INSECURE_LOCAL_DEV;
  process.env.VITE_ALLOW_INSECURE_LOCAL_DEV = 'true';
  try {
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      resolve(root, 'vite.config.ts'),
      root,
      'silent',
    );
    return loaded!.config;
  } finally {
    if (allowInsecure === undefined) delete process.env.VITE_ALLOW_INSECURE_LOCAL_DEV;
    else process.env.VITE_ALLOW_INSECURE_LOCAL_DEV = allowInsecure;
  }
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'library-never-ships-'));
  symlinkSync(resolve(ROOT, '..'), join(scratch, 'checkout'), 'dir');
  linked = join(scratch, 'checkout', 'front-end');
  config = await projectConfig(ROOT);
  linkedConfig = await projectConfig(linked);
}, 60_000);

afterAll(() => {
  rmSync(scratch, { recursive: true });
});

/** Builds, as production does, one entry module whose source is `code`. */
async function buildEntry(name: string, code: string, using = config): Promise<void> {
  const entry = join(scratch, `${name}.ts`);
  writeFileSync(entry, code);
  const one: InlineConfig = {
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      lib: { entry, formats: ['es'] },
      rolldownOptions: { external: ['vue', 'vue-router'] },
    },
  };
  // Vitest runs under NODE_ENV=test, which Vite reads as a development build (`DEV` true); a
  // production build is what ships.
  const nodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await build(mergeConfig(using, one));
  } finally {
    process.env.NODE_ENV = nodeEnv;
  }
}

describe('the production build', () => {
  it("fails when a shipped module imports the library's fixture, and names it", async () => {
    await expect(
      buildEntry(
        'leaks-the-fixture',
        `import { fixture } from '${SRC}/dev/library/fixture';\n` +
          'export const people = fixture.people.length;\n',
      ),
    ).rejects.toThrow(/src\/dev\/library\/fixture/);
  }, 60_000);

  it('fails when a shipped module imports one of its parts', async () => {
    await expect(
      buildEntry(
        'leaks-a-part',
        `import ReadOut from '${SRC}/dev/library/parts/ReadOut.vue';\nexport default ReadOut;\n`,
      ),
    ).rejects.toThrow(/src\/dev\/library\/parts\/ReadOut\.vue/);
  }, 60_000);

  it('fails the same when the checkout is reached through a symbolic link', async () => {
    await expect(
      buildEntry(
        'leaks-the-fixture-through-a-link',
        `import { fixture } from '${linked}/src/dev/library/fixture';\n` +
          'export const people = fixture.people.length;\n',
        linkedConfig,
      ),
    ).rejects.toThrow(/src\/dev\/library\/fixture/);
  }, 60_000);

  it('builds what the app ships', async () => {
    await expect(
      buildEntry(
        'ships-a-component',
        `import ReadFailed from '${SRC}/components/ReadFailed.vue';\nexport default ReadFailed;\n`,
      ),
    ).resolves.toBeUndefined();
  }, 60_000);
});

describe('ESLint', () => {
  const eslint = new ESLint({ cwd: ROOT });

  /** The `no-restricted-imports` findings for `code` linted as the file at `path`. */
  async function refusals(path: string, code: string): Promise<string[]> {
    const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, path) });
    return result!.messages
      .filter((message) => message.ruleId === 'no-restricted-imports')
      .map((message) => message.message);
  }

  it.each([
    ['src/components/Leak.ts', "import { fixture } from '../dev/library/fixture';"],
    ['src/components/application/Leak.ts', "import { fixture } from '../../dev/library/fixture';"],
    ['src/main.ts', "import { fixture } from './dev/library/fixture';"],
    ['src/components/Leak.ts', "import { fixture } from '@/dev/library/fixture';"],
    ['src/components/Leak.ts', "import '@/dev';"],
  ])('refuses %s importing the library (%s)', async (path, code) => {
    expect(await refusals(path, `${code}\nexport {};\n`)).toEqual([
      expect.stringContaining('src/dev/ is the development-only component library'),
    ]);
  });

  it.each([
    ['src/router/index.ts', "import { ENTRIES } from '@/dev/library/catalog';"],
    ['src/dev/library/LibraryIndexView.ts', "import { ENTRIES } from './catalog';"],
    ['src/dev/library/entries/Leak.ts', "import { fixture } from '../fixture';"],
    ['src/components/Fine.ts', "import { devices } from '../utils/devices';"],
    ['src/components/Fine.ts', "import { x } from './developer';"],
  ])('lets %s import %s', async (path, code) => {
    expect(await refusals(path, `${code}\nexport {};\n`)).toEqual([]);
  });
});
