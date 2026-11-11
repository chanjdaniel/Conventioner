// @vitest-environment node
/**
 * A production build needs the back end's address, and Vercel never builds under the hatch (T273).
 *
 * `VITE_FLASK_HOST` is baked into the bundle at build time, and with none every API request goes to
 * the front end's own origin, which answers every path with `index.html` and 200: a bundle that
 * looks deployed and does nothing. `VITE_ALLOW_INSECURE_LOCAL_DEV` lets a local or CI build go
 * without it (and without the reCAPTCHA site key), so a Vercel build refuses that hatch outright.
 * This loads the project's own `vite.config.ts` as a build or the dev server loads it, after the
 * case has set the environment, and reads whether it loads, refuses or warns.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { resolve } from 'node:path';
import { loadConfigFromFile } from 'vite';

const ROOT = process.cwd();

const NO_API_HOST =
  'VITE_FLASK_HOST is not set, so this bundle would send every API request to its own origin, ' +
  "where every path answers index.html with 200 and nothing works. Set it to the back end's " +
  'address (https://api.conventioner.io in production), or set VITE_ALLOW_INSECURE_LOCAL_DEV=true ' +
  'if this build only ever talks to a local back end.';

const NO_API_HOST_WARNING =
  '[api] VITE_ALLOW_INSECURE_LOCAL_DEV is set: building a bundle with no VITE_FLASK_HOST. It ' +
  'calls its own origin. Never deploy this bundle.';

const HATCH_ON_VERCEL =
  'VITE_ALLOW_INSECURE_LOCAL_DEV is set on a Vercel build. It lets a bundle build with no ' +
  'reCAPTCHA site key or API address, which a deployed front end must never ship. Remove it from ' +
  "the front-end project's environment on Vercel.";

/** What each case may set; every one is restored after it. */
const NAMES = [
  'VITE_FLASK_HOST',
  'VITE_RECAPTCHA_SITE_KEY',
  'VITE_ALLOW_INSECURE_LOCAL_DEV',
  'VERCEL',
] as const;
type Name = (typeof NAMES)[number];

const saved = Object.fromEntries(NAMES.map((name) => [name, process.env[name]]));

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

/**
 * Sets the case's environment and loads the config. Each `VITE_` name left out is set to the empty
 * string, not deleted: `loadEnv` lets the process environment win over a developer's `.env` file,
 * so the case holds whatever that file says. `VERCEL` is read from the process alone, so it is
 * deleted when left out.
 */
async function loadConfig(
  command: 'build' | 'serve',
  set: Partial<Record<Name, string>>,
): Promise<unknown> {
  for (const name of NAMES) {
    const value = set[name];
    if (value !== undefined) process.env[name] = value;
    else if (name === 'VERCEL') delete process.env[name];
    else process.env[name] = '';
  }
  const loaded = await loadConfigFromFile(
    { command, mode: command === 'build' ? 'production' : 'development' },
    resolve(ROOT, 'vite.config.ts'),
    ROOT,
    'silent',
  );
  return loaded?.config;
}

/** The words of every `console.warn` the load made. */
function warnings(): string[] {
  return warn.mock.calls.map((args) => args.map(String).join(' '));
}

const SITE_KEY = 'fixture-site-key';
const API_HOST = 'https://api.example.com';

describe('a production build', () => {
  it('refuses a bundle with a site key and no VITE_FLASK_HOST', async () => {
    await expect(loadConfig('build', { VITE_RECAPTCHA_SITE_KEY: SITE_KEY })).rejects.toThrow(
      NO_API_HOST,
    );
  });

  it.each([['   '], ['\t\n']])('refuses a blank VITE_FLASK_HOST (%j)', async (blank) => {
    await expect(
      loadConfig('build', { VITE_RECAPTCHA_SITE_KEY: SITE_KEY, VITE_FLASK_HOST: blank }),
    ).rejects.toThrow(NO_API_HOST);
  });

  it('loads with both the API address and the site key, and warns of nothing', async () => {
    await expect(
      loadConfig('build', { VITE_RECAPTCHA_SITE_KEY: SITE_KEY, VITE_FLASK_HOST: API_HOST }),
    ).resolves.toBeDefined();
    expect(warnings()).toEqual([]);
  });

  it('builds under the hatch with no VITE_FLASK_HOST, and warns in so many words', async () => {
    await expect(
      loadConfig('build', {
        VITE_RECAPTCHA_SITE_KEY: SITE_KEY,
        VITE_ALLOW_INSECURE_LOCAL_DEV: 'true',
      }),
    ).resolves.toBeDefined();
    expect(warnings()).toEqual([NO_API_HOST_WARNING]);
  });

  it('builds under the hatch with neither variable, as CI and the gate build', async () => {
    await expect(
      loadConfig('build', { VITE_ALLOW_INSECURE_LOCAL_DEV: 'true' }),
    ).resolves.toBeDefined();
    expect(warnings()).toContain(NO_API_HOST_WARNING);
  });

  it.each([['1'], ['false'], ['TRUE']])(
    'refuses with the hatch set to anything but "true" (%j)',
    async (hatch) => {
      await expect(
        loadConfig('build', {
          VITE_RECAPTCHA_SITE_KEY: SITE_KEY,
          VITE_ALLOW_INSECURE_LOCAL_DEV: hatch,
        }),
      ).rejects.toThrow(NO_API_HOST);
    },
  );
});

describe('a Vercel build', () => {
  it.each([
    ['with neither variable', {}],
    ['with both variables', { VITE_RECAPTCHA_SITE_KEY: SITE_KEY, VITE_FLASK_HOST: API_HOST }],
    ['with the site key alone', { VITE_RECAPTCHA_SITE_KEY: SITE_KEY }],
  ])('refuses the hatch %s', async (_case, set) => {
    await expect(
      loadConfig('build', { ...set, VERCEL: '1', VITE_ALLOW_INSECURE_LOCAL_DEV: 'true' }),
    ).rejects.toThrow(HATCH_ON_VERCEL);
    expect(warnings()).toEqual([]);
  });

  it('loads with both variables and no hatch', async () => {
    await expect(
      loadConfig('build', {
        VERCEL: '1',
        VITE_RECAPTCHA_SITE_KEY: SITE_KEY,
        VITE_FLASK_HOST: API_HOST,
      }),
    ).resolves.toBeDefined();
    expect(warnings()).toEqual([]);
  });

  it('refuses no VITE_FLASK_HOST by the API address check', async () => {
    await expect(
      loadConfig('build', { VERCEL: '1', VITE_RECAPTCHA_SITE_KEY: SITE_KEY }),
    ).rejects.toThrow(NO_API_HOST);
  });

  it.each([[''], ['   ']])('is not one when VERCEL is blank (%j)', async (blank) => {
    await expect(
      loadConfig('build', { VERCEL: blank, VITE_ALLOW_INSECURE_LOCAL_DEV: 'true' }),
    ).resolves.toBeDefined();
    expect(warnings()).toContain(NO_API_HOST_WARNING);
  });
});

describe('the dev server', () => {
  it('loads with neither variable and no hatch, and warns of nothing', async () => {
    await expect(loadConfig('serve', {})).resolves.toBeDefined();
    expect(warnings()).toEqual([]);
  });

  it('loads on a host that sets VERCEL, with the hatch', async () => {
    await expect(
      loadConfig('serve', { VERCEL: '1', VITE_ALLOW_INSECURE_LOCAL_DEV: 'true' }),
    ).resolves.toBeDefined();
    expect(warnings()).toEqual([]);
  });
});
