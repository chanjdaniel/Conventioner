import type { Page, TestInfo } from '@playwright/test';

/**
 * What the browser said, kept for a test that fails. The suite has twice failed on a page that
 * never painted, with nothing in the stack's logs to say why; a tab can run out of network
 * resources on the dev server's unbundled modules (`net::ERR_INSUFFICIENT_RESOURCES`), its route's
 * chunk then fails to import, and the app mounts with no page. Attached only on failure, so a
 * passing run carries nothing and a failing one names its cause.
 *
 * `watchTheBrowser` starts listening on a page and hands back what it has heard so far; the
 * fixture's page and every `withUser` page are watched (T263).
 */
export function watchTheBrowser(page: Page): () => string[] {
  const said: string[] = [];
  const at = () => new Date().toISOString();
  page.on('console', (message) => {
    if (message.type() === 'error') said.push(`${at()} console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => said.push(`${at()} pageerror: ${error.message}`));
  page.on('crash', () => said.push(`${at()} the page crashed`));
  page.on('requestfailed', (request) => {
    const why = request.failure()?.errorText ?? '';
    // A navigation cancels what the page it leaves was loading; that is not a failure.
    if (!why.includes('ERR_ABORTED')) {
      said.push(`${at()} requestfailed: ${request.method()} ${request.url()} ${why}`);
    }
  });
  return () => [...said];
}

/** Attaches what a watched page's browser said, when it said anything; `whose` heads it. */
export async function attachWhatTheBrowserSaid(
  testInfo: TestInfo,
  said: string[],
  whose?: string,
): Promise<void> {
  if (!said.length) return;
  await testInfo.attach('what the browser said', {
    body: (whose ? [whose, ...said] : said).join('\n'),
    contentType: 'text/plain',
  });
}
