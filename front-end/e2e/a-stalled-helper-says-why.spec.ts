import { test, expect, TEST_USER } from './fixtures';
import { requestsWhile } from './helpers/peopleAtScale';
import { withUser } from './helpers/withUser';

/**
 * A helper that stalls says what the browser was doing (T263), so a failure that cannot be
 * reproduced still names its cause: a `withUser` page attaches what its browser said, as the
 * fixture's page does, and the people-at-scale wait for quiet names each request still open.
 * Each is made to fail on purpose here, with the failure caught, so the self-test passes. And that
 * wait neither stalls on the reads a reload drops nor ends before the new page's own.
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
  // The reads still open are named in the order they were sent, and other reads may be open
  // beside the held one, so any may come first; the markets read must still be named, with its
  // age.
  await expect(stalled).rejects.toThrow(/still open: (?:.+; )?GET \/api\/markets for \d+ms/);
});

/** The page's organizations read, `GET /api/organizations`. */
const THE_ORGANIZATIONS_READ = /\/api\/organizations$/;

test('the wait for quiet ends across a reload, though the old page dropped its reads', async ({
  authenticatedPage: page,
}) => {
  // The sign-in has just landed on Markets, whose reads are still out; the reload drops them with
  // the old page, and Playwright reports neither their end nor their failure (T284).
  const made = await requestsWhile(page, {}, async () => {
    await page.reload();
  });
  expect(made).toContain('GET /api/markets');
});

test("the wait for quiet still waits for the new page's reads after a reload", async ({
  authenticatedPage: page,
}) => {
  let reloaded = false;
  let answered = 0;
  // The new page's organizations read is answered 2s late.
  await page.route(THE_ORGANIZATIONS_READ, async (route) => {
    if (reloaded) await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.continue();
  });
  page.on('requestfinished', (request) => {
    if (reloaded && THE_ORGANIZATIONS_READ.test(request.url())) answered = Date.now();
  });
  await requestsWhile(page, {}, async () => {
    reloaded = true;
    await page.reload();
  });
  const quietAt = Date.now();
  expect(answered, "the new page's organizations read was answered").toBeGreaterThan(0);
  // The wait for quiet ends 750ms after the last request, so never before that read's answer.
  expect(quietAt - answered).toBeGreaterThanOrEqual(700);
  await page.unrouteAll({ behavior: 'wait' });
});
