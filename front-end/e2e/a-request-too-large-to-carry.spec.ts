import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect } from './fixtures';

/**
 * A request too large for the host is said as too large, never as a lost connection (T315).
 *
 * In production the app calls its API on another origin (`https://api.conventioner.io`), and the
 * host refuses a body over 4.5 MB itself, before the back end runs, with a 413 that carries no CORS
 * header. The browser hides such an answer from the page, which reads it as no answer at all: "You
 * seem to be offline". So the app's API client refuses such a body before it is sent.
 *
 * The host is played by a server of the test's own on another origin: it answers the preflight as
 * the back end does, allowing the app's own origin alone, which a preflight's empty body lets
 * through, and the request itself 413 with no CORS header. Not by `page.route`: its `fulfill`
 * adds the CORS header a cross-origin answer lacks (Playwright issue 12929), so the page would
 * read a 413 the host's never shows it. The page's Content-Security-Policy, which names the
 * production API, is bypassed to reach it.
 */
const TOO_LARGE = 'This was larger than the 4.5 MB one request can carry.';

let host: Server;
let hostOrigin = '';
const sent: string[] = [];

test.beforeAll(async () => {
  // The app's origin, as the back end's own allow-list names it: never the asking origin echoed.
  const appOrigin = new URL(String(test.info().project.use.baseURL)).origin;
  host = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': appOrigin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }
    sent.push(String(req.method));
    req.resume();
    req.on('end', () => {
      res.writeHead(413, { 'Content-Type': 'text/plain' });
      res.end('Request Entity Too Large');
    });
  });
  await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve));
  hostOrigin = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => host.close(resolve));
});

test.use({ bypassCSP: true });

test("a body over the host's 4.5 MB is refused as too large, before it is sent", async ({
  page,
}) => {
  await page.goto('/login');

  const said = await page.evaluate(async (url) => {
    // The app's own client, as Vite serves it, so the request goes out as a screen's would.
    const client = '/src/utils/api.ts';
    const { api, getApiErrorMessage } = await import(/* @vite-ignore */ client);
    try {
      await api.post(url, { csvContent: 'x'.repeat(4_600_000) });
      return 'answered';
    } catch (err) {
      return getApiErrorMessage(err, 'The request failed.');
    }
  }, `${hostOrigin}/markets/m/applications/import/inspect`);

  expect(said).toBe(TOO_LARGE);
  expect(sent, 'nothing the host would refuse is sent').toEqual([]);
});
