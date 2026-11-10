import { test, expect, TEST_USER } from './fixtures';
import { requestsWhile } from './helpers/peopleAtScale';
import { withUser } from './helpers/withUser';

/**
 * A helper that stalls says what the browser was doing (T263), so a failure that cannot be
 * reproduced still names its cause: a `withUser` page attaches what its browser said, as the
 * fixture's page does, and the people-at-scale wait for quiet names each request still open.
 * Each is made to fail on purpose here, with the failure caught, so the self-test passes.
 */

/** The markets list's one read, `GET /api/markets`. */
const THE_MARKETS_READ = /\/api\/markets$/;

test('a withUser page that fails attaches what its browser said, naming a failed request', async ({
  browser,
}, testInfo) => {
  const failed = withUser(browser, TEST_USER.email, TEST_USER.password, async (page) => {
    await page.route(THE_MARKETS_READ, (route) => route.abort());
    await page.reload();
    // The list never arrives, so this wait fails, as a real stall would.
    await expect(page.getByTestId('market-card-name')).toBeVisible({ timeout: 2_000 });
  });
  await expect(failed).rejects.toThrow();

  const said = testInfo.attachments.filter((a) => a.name === 'what the browser said');
  expect(said).toHaveLength(1);
  const words = said[0].body!.toString();
  expect(words).toContain(`withUser(${TEST_USER.email})`);
  expect(words).toMatch(/requestfailed: GET \S+\/api\/markets net::ERR_FAILED/);
});

test('the wait for quiet fails naming each API request still open, and its age', async ({
  authenticatedPage: page,
}) => {
  // The markets list's read is held, never answered, so the API never goes quiet.
  await page.route(THE_MARKETS_READ, () => {});
  const stalled = requestsWhile(page, {}, async () => {
    await page.reload();
  });
  await expect(stalled).rejects.toThrow(/still open: GET \/api\/markets for \d+ms/);
});
