// @vitest-environment node
/**
 * Every host-side client of a local stack dials 127.0.0.1, and the dev server listens there (T48).
 *
 * A stack publishes on 127.0.0.1 only. `localhost` is tried as ::1 first, and macOS hands a port
 * held on 127.0.0.1 to any program that listens on IPv6, so a client dialling `localhost:<port>`
 * can reach that program instead: twice a gate run's Playwright got `ERR_INVALID_HTTP_RESPONSE` from
 * its own stack's port. And a dev server left to bind `localhost` listens on ::1 alone, where
 * nothing dialling 127.0.0.1 finds it. So this loads each client's own configuration (Playwright's,
 * the suite's fixtures, Vite's proxy) and starts the dev server to see where it listens.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { createServer, loadConfigFromFile, type ViteDevServer } from 'vite';

const ROOT = process.cwd();

/** Every variable that names a stack or a URL, so the machine running this cannot leak one in. */
const STACK_VARS = [
  'CI',
  'COMPOSE_PROJECT_NAME',
  'TH_BACKEND_PORT',
  'TH_FRONTEND_PORT',
  'TH_MONGO_PORT',
  'BACKEND_URL',
  'FRONTEND_PORT',
  'VITE_BACKEND_URL',
];

/** A stack as `th-compose.sh` exports it, slot 7's ports. */
const SLOT_7 = {
  COMPOSE_PROJECT_NAME: 'conventioner-7',
  TH_BACKEND_PORT: '5071',
  TH_FRONTEND_PORT: '5243',
  TH_MONGO_PORT: '27087',
};

/**
 * Each of these imports a whole config (Playwright's with `@playwright/test`, the suite's fixtures,
 * Vite's through `loadConfigFromFile`), which outlasts the 5 s default on a loaded machine, as the
 * Lucide build test does.
 */
const LOADS_A_CONFIG = 60_000;

const saved = Object.fromEntries(STACK_VARS.map((name) => [name, process.env[name]]));

/** Load modules fresh with only `env` naming the stack: `stack()` is computed once per process. */
async function withStack<T>(env: Record<string, string>, load: () => Promise<T>): Promise<T> {
  vi.resetModules();
  for (const name of STACK_VARS) delete process.env[name];
  Object.assign(process.env, env);
  return load();
}

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('the clients of a local stack dial 127.0.0.1', () => {
  it(
    "Playwright browses the stack's front end there",
    async () => {
      const config = await withStack(
        SLOT_7,
        async () => (await import('../../playwright.config')).default,
      );
      expect(config.use?.baseURL).toBe('http://127.0.0.1:5243');
    },
    LOADS_A_CONFIG,
  );

  it(
    "the suite calls the stack's back end there",
    async () => {
      const { BACKEND_URL } = await withStack(SLOT_7, () => import('../../e2e/fixtures'));
      expect(BACKEND_URL).toBe('https://127.0.0.1:5071');
    },
    LOADS_A_CONFIG,
  );

  it(
    "CI's single stack is reached there too",
    async () => {
      const config = await withStack(
        { CI: 'true' },
        async () => (await import('../../playwright.config')).default,
      );
      const { BACKEND_URL } = await withStack({ CI: 'true' }, () => import('../../e2e/fixtures'));
      expect(new URL(String(config.use?.baseURL)).hostname).toBe('127.0.0.1');
      expect(new URL(BACKEND_URL).hostname).toBe('127.0.0.1');
    },
    LOADS_A_CONFIG,
  );

  it(
    "Vite's proxy sends /api to a native back end there",
    async () => {
      const proxy = await withStack({}, async () => {
        const loaded = await loadConfigFromFile(
          { command: 'serve', mode: 'development' },
          resolve(ROOT, 'vite.config.ts'),
          ROOT,
          'silent',
        );
        return loaded!.config.server?.proxy?.['/api'];
      });
      const target = typeof proxy === 'object' ? proxy.target : undefined;
      expect(new URL(String(target)).hostname).toBe('127.0.0.1');
    },
    LOADS_A_CONFIG,
  );
});

describe('the dev server', () => {
  let server: ViteDevServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('listens on 127.0.0.1, where the docs and the email links send a browser', async () => {
    server = await createServer({
      configFile: resolve(ROOT, 'vite.config.ts'),
      root: ROOT,
      logLevel: 'silent',
      server: { port: 0, watch: null },
    });
    await server.listen();
    const address = server.httpServer!.address() as AddressInfo;
    expect(address.address).toBe('127.0.0.1');
  }, 60_000);
});
