import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';

/**
 * A verdict is written only on what the reviewer saw (E34/F03/S01).
 *
 * Two reviewers on one market, the same card in front of both. The first verdict is written; the
 * second is refused, says who decided and what, and leaves the reviewer on that application as it
 * now stands. Before, the last verdict silently won.
 */
const SECOND = { email: 'e2e-second-reviewer@example.com', password: 'e2esecondreviewer1' };

test('the second of two verdicts on one card is refused, naming the first', async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  ensureVerifiedUser(SECOND.email, SECOND.password);
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_open');
  seedApplicationWithStatus(marketId, 'open', 'nadia@ember.test');
  seedApplicationWithStatus(marketId, 'open', 'theo@thistle.test');
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications_closed');
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'review');
  const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: SECOND.email, role: 'editor' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();

  const first = new ApplicationMonitorPage(page);
  await page.goto(marketScreenPath(marketId, 'applications'));
  await first.waitForLoaded();
  await expect(first.email).toHaveText('nadia@ember.test');

  await withUser(browser, SECOND.email, SECOND.password, async (other) => {
    const second = new ApplicationMonitorPage(other);
    await other.goto(marketScreenPath(marketId, 'applications'));
    await second.waitForLoaded();
    await expect(second.email).toHaveText('nadia@ember.test');

    // Both opened Nadia's card. The first approves.
    await first.approveButton.click();
    await expect(first.email).toHaveText('theo@thistle.test');

    // The second, still looking at what they opened, rejects: refused, and told why.
    await second.rejectButton.click();
    await expect(other.getByTestId('app-monitor-changed')).toContainText(
      `${TEST_USER.email} approved this application since you opened it.`,
    );
    // Still on Nadia, as she now stands.
    await expect(second.email).toHaveText('nadia@ember.test');
    await expect(other.getByTestId('app-monitor-status')).toHaveText('Approved');

    // Back to the queue: Theo, untouched by any of it.
    await second.nextButton.click();
    await expect(second.email).toHaveText('theo@thistle.test');
    await expect(other.getByTestId('app-monitor-changed')).toHaveCount(0);
  });

  await first.openDecided();
  await expect(first.decidedStatusOf('nadia@ember.test')).toHaveText('Approved');
});
