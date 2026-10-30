import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';

/**
 * The review says when its list was last read, and reads it again on Refresh (E38/F05/S03).
 *
 * Others decide while a reviewer works, and the list on screen is what was read: both views say how
 * old it is, and Refresh shows a second reviewer's verdict at once - keeping the ticks of rows still
 * shown and the card the reviewer holds - or says it could not, and keeps the list.
 */
const SECOND = { email: 'e2e-refresh-reviewer@example.com', password: 'e2erefreshreviewer1' };
/** The list's own read, not a write to one application under it. */
const THE_LIST = /\/markets\/[^/]+\/applications(\?.*)?$/;
/** The API's read of it, not the page of the same address nor a write. */
const isTheListRead = (request: import('@playwright/test').Request) =>
  request.method() === 'GET' && ['xhr', 'fetch'].includes(request.resourceType());

async function reviewingMarket(request: import('@playwright/test').APIRequestContext) {
  ensureVerifiedUser(SECOND.email, SECOND.password);
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_open');
  const nadia = seedApplicationWithStatus(marketId, 'open', 'nadia@ember.test');
  const theo = seedApplicationWithStatus(marketId, 'open', 'theo@thistle.test');
  const ines = seedApplicationWithStatus(marketId, 'open', 'ines@loom.test');
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_closed');
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'review');
  const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: SECOND.email, role: 'editor' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();
  return { marketId, nadia, theo, ines };
}

test("All: a second reviewer's verdict shows on Refresh, and the ticks stay", async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  const { marketId, ines } = await reviewingMarket(request);
  const all = new ApplicationsAllPage(page);
  const updated = page.getByTestId('applications-updated');
  const refresh = page.getByTestId('applications-refresh');

  await all.goto(marketId);
  await expect(all.rows).toHaveCount(3);
  await expect(updated).toHaveText('Updated just now');
  await all.tickOf('theo@thistle.test').check();

  await withUser(browser, SECOND.email, SECOND.password, async (other) => {
    const approved = await other.request.put(
      `${BACKEND_URL}/markets/${marketId}/applications/${ines}/review`,
      { data: { status: 'reviewer_approved' } },
    );
    expect(approved.ok(), await approved.text()).toBeTruthy();
  });
  // Not on screen until the list is read again.
  await expect(all.statusOf('ines@loom.test')).toHaveText('Open');

  await refresh.click();
  await expect(all.statusOf('ines@loom.test')).toHaveText('Approved');
  await expect(all.giverOf('ines@loom.test')).toContainText(`Approved by ${SECOND.email}`);
  await expect(all.tickOf('theo@thistle.test')).toBeChecked();
  await expect(all.selection).toContainText('1 application selected');
  await expect(updated).toHaveText('Updated just now');

  // A refresh that cannot reach the server says so, and the list stays as it was.
  await page.route(THE_LIST, (route) =>
    isTheListRead(route.request()) ? route.abort() : route.continue(),
  );
  await refresh.click();
  await expect(page.getByTestId('applications-refresh-error')).toHaveText(
    'Could not refresh. The list is as it was last read.',
  );
  await expect(all.rows).toHaveCount(3);
  await expect(all.tickOf('theo@thistle.test')).toBeChecked();
  await page.unroute(THE_LIST);
  await refresh.click();
  await expect(page.getByTestId('applications-refresh-error')).toHaveCount(0);
});

test("One by one: Refresh brings others' verdicts into the counts, and keeps the card", async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  const { marketId, nadia } = await reviewingMarket(request);
  const monitor = new ApplicationMonitorPage(page);

  await monitor.goto(marketId);
  await monitor.waitForLoaded();
  await expect(monitor.progress).toContainText('of 3 to review');
  await expect(page.getByTestId('applications-updated')).toHaveText('Updated just now');
  // On to the second card, which the reviewer now holds; the first is let go.
  await expect(monitor.email).toHaveText('nadia@ember.test');
  await monitor.nextCard();
  await expect(monitor.email).toHaveText('theo@thistle.test');

  // The second reviewer decides the card before it, so the card up moves up the queue.
  await withUser(browser, SECOND.email, SECOND.password, async (other) => {
    const rejected = await other.request.put(
      `${BACKEND_URL}/markets/${marketId}/applications/${nadia}/review`,
      { data: { status: 'reviewer_rejected' } },
    );
    expect(rejected.ok(), await rejected.text()).toBeTruthy();
  });
  await expect(monitor.progress).toContainText('of 3 to review');

  await page.getByTestId('applications-refresh').click();
  await expect(monitor.progress).toContainText('of 2 to review');
  await expect(monitor.tally).toContainText('1 reviewed · 0 approved · 1 rejected');
  await expect(monitor.email).toHaveText('theo@thistle.test');
  await expect(monitor.progress).toContainText('1 of 2 to review');
});

test('Refresh recovers from a list that failed to load, in both views', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await reviewingMarket(request);
  const all = new ApplicationsAllPage(page);
  const monitor = new ApplicationMonitorPage(page);
  const refresh = page.getByTestId('applications-refresh');
  const failRead = () =>
    page.route(THE_LIST, (route) =>
      isTheListRead(route.request()) ? route.abort() : route.continue(),
    );

  // All: the first read fails, so the page says so; a Refresh that reads the list shows it.
  const lead = page.getByTestId('market-setup-applications-condition');
  await failRead();
  await all.goto(marketId);
  await expect(page.getByText('Failed to load applications')).toBeVisible();
  // Nothing was read, so nothing is counted: not "Every application has been decided".
  await expect(lead).toHaveText(
    'Every application must be decided before this market can enter Assignment.',
  );
  await page.unroute(THE_LIST);
  await refresh.click();
  await expect(all.rows).toHaveCount(3);
  await expect(lead).toContainText('3 applications still to decide');
  await expect(all.selectAll).toBeVisible();
  await expect(page.getByText('Failed to load applications')).toHaveCount(0);

  // One by one: the same, and its own refresh failing says so and keeps the card.
  await failRead();
  await monitor.goto(marketId);
  await expect(page.getByText('Failed to load applications')).toBeVisible();
  await expect(lead).not.toContainText('Every application has been decided');
  // Not "No applications received yet." under the error: nothing was read to say so.
  await expect(monitor.empty).toHaveCount(0);
  await page.unroute(THE_LIST);
  await refresh.click();
  await expect(monitor.progress).toContainText('of 3 to review');
  await expect(monitor.card).toBeVisible();
  await expect(page.getByText('Failed to load applications')).toHaveCount(0);
  const up = ((await monitor.email.textContent()) ?? '').trim();

  await failRead();
  await refresh.click();
  await expect(page.getByTestId('applications-refresh-error')).toHaveText(
    'Could not refresh. The list is as it was last read.',
  );
  await expect(monitor.email).toHaveText(up);
  await page.unroute(THE_LIST);
  await refresh.click();
  await expect(page.getByTestId('applications-refresh-error')).toHaveCount(0);
  await expect(monitor.email).toHaveText(up);
});
