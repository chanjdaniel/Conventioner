import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { mongoEval } from './helpers/mongo';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';

/**
 * A reviewer holds the application they are looking at (E34/F03/S02).
 *
 * Two reviewers starting together walked the same cards in the same order. The next card is the
 * server's to hand out now, so they walk different ones; a claim lapses five minutes after its
 * holder stops, and the card is offered again.
 */
const SECOND = { email: 'e2e-holding-reviewer@example.com', password: 'e2eholdingreviewer1' };

test('two reviewers walk different cards, and a lapsed claim is offered again', async ({
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
  const nadia = seedApplicationWithStatus(marketId, 'open', 'nadia@ember.test');
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
  const firstCard = ((await first.email.textContent()) ?? '').trim();

  await withUser(browser, SECOND.email, SECOND.password, async (other) => {
    const second = new ApplicationMonitorPage(other);
    await other.goto(marketScreenPath(marketId, 'applications'));
    await second.waitForLoaded();
    // Not the card the first reviewer has open.
    await expect(second.email).not.toHaveText(firstCard);
    const secondCard = ((await second.email.textContent()) ?? '').trim();
    expect([firstCard, secondCard].sort()).toEqual(['nadia@ember.test', 'theo@thistle.test']);

    // Next has nothing to hand the second: every other card is held.
    await second.nextButton.click();
    await expect(second.email).toHaveText(secondCard);

    // The first reviewer stops; five minutes on, their card is free again.
    mongoEval(
      `db.applications.updateMany({ market_id: ${JSON.stringify(marketId)}, ` +
        `'held_by.email': ${JSON.stringify(TEST_USER.email)} }, ` +
        `{ $set: { held_until: '2000-01-01T00:00:00+00:00' } })`,
    );
    await second.nextButton.click();
    await expect(second.email).toHaveText(firstCard);
  });

  expect(mongoEval(`db.applications.findOne({ id: ${JSON.stringify(nadia)} }).status`)).toBe(
    'open',
  );
});
