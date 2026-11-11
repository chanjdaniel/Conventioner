import { chromium, request } from '@playwright/test';

/**
 * A run starts once the stack is ready (T284): the back end answers through the front end, and
 * the dev server has drawn the sign-in page.
 *
 * `docker compose up --wait` returns once the back end and the dev server containers run, since
 * neither has a health check, which can be before the back end serves or the dev server has
 * transformed a page's modules. Three times a run's first spec on a just-started stack timed out at
 * the sign-in form or drew an empty `main` (T117); those failures came before `networkSettles.ts`,
 * whose wait after a stack's start has covered the stack's own start since, and they have not
 * recurred. This wait is there so a stack that never gets ready fails the run naming the part that
 * did not, rather than its first spec, and so a host where the network settle waits for nothing
 * (CI) still waits for the stack.
 */
const POLL_MS = 500;
const BACK_END_MS = 60_000;
const SIGN_IN_MS = 120_000;
/** One look at the sign-in page; a page whose module failed to load is opened again. */
const SIGN_IN_ATTEMPT_MS = 30_000;
/** A wait shorter than this says nothing, as `networkSettles.ts` says nothing when it waits for nothing. */
const QUIET_MS = 2_000;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What a failed request said, on one line. */
const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0];

/** Waits for `GET <baseURL>/api/healthz` to answer 200, the back end through the dev server's proxy. */
async function backEndAnswers(baseURL: string): Promise<void> {
  const context = await request.newContext({ baseURL, ignoreHTTPSErrors: true });
  const deadline = Date.now() + BACK_END_MS;
  let last = 'no answer yet';
  try {
    while (Date.now() < deadline) {
      try {
        const response = await context.get('/api/healthz', {
          timeout: Math.max(1, Math.min(10_000, deadline - Date.now())),
        });
        if (response.status() === 200) return;
        last = String(response.status());
      } catch (error) {
        last = firstLine(error);
      }
      await pause(POLL_MS);
    }
  } finally {
    await context.dispose();
  }
  throw new Error(
    `e2e: the back end did not answer /api/healthz through the front end within ${BACK_END_MS / 1000}s (last: ${last})`,
  );
}

/** Waits for the dev server to draw the sign-in form, in a browser of its own. */
async function signInDraws(baseURL: string): Promise<void> {
  const browser = await chromium.launch();
  const deadline = Date.now() + SIGN_IN_MS;
  try {
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    while (Date.now() < deadline) {
      const timeout = Math.max(1, Math.min(SIGN_IN_ATTEMPT_MS, deadline - Date.now()));
      try {
        await page.goto(`${baseURL}/login`, { timeout });
        await page.getByTestId('login-email-input').waitFor({ state: 'visible', timeout });
        return;
      } catch {
        // Not drawn yet, or a module of it failed on the way: look again while there is time.
        await pause(POLL_MS);
      }
    }
  } finally {
    await browser.close();
  }
  throw new Error(`e2e: the sign-in page did not draw within ${SIGN_IN_MS / 1000}s`);
}

/** Wait, once a run, for the back end and then the sign-in page; says how long past 2 seconds. */
export async function stackReady(baseURL: string): Promise<void> {
  const started = Date.now();
  await backEndAnswers(baseURL);
  await signInDraws(baseURL);
  const took = Date.now() - started;
  if (took > QUIET_MS) console.log(`e2e: the stack was ready in ${Math.round(took / 1000)}s`);
}
