import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { oneByOnePath } from './helpers/marketScreens';
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
const READER = { email: 'e2e-holding-reader@example.com', password: 'e2eholdingreader1' };

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
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  const nadia = seedApplicationWithStatus(marketId, 'open', 'nadia@ember.test');
  seedApplicationWithStatus(marketId, 'open', 'theo@thistle.test');
  const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: SECOND.email, role: 'editor' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();

  const first = new ApplicationMonitorPage(page);
  await page.goto(oneByOnePath(marketId));
  await first.waitForLoaded();
  const firstCard = ((await first.email.textContent()) ?? '').trim();

  await withUser(browser, SECOND.email, SECOND.password, async (other) => {
    const second = new ApplicationMonitorPage(other);
    await other.goto(oneByOnePath(marketId));
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

/**
 * Someone who may only read walks the queue too - with Next and N, holding nothing - and is told
 * which card another reviewer has open. The verdicts are not theirs to give.
 */
test('a reader walks the queue, holding nothing, and sees who has a card open', async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  ensureVerifiedUser(READER.email, READER.password);
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  seedApplicationWithStatus(marketId, 'open', 'nadia@ember.test');
  seedApplicationWithStatus(marketId, 'open', 'theo@thistle.test');
  const granted = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
    data: { user_email: READER.email, role: 'viewer' },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();

  // The organizer opens the review, which holds the first card.
  const reviewer = new ApplicationMonitorPage(page);
  await page.goto(oneByOnePath(marketId));
  await reviewer.waitForLoaded();
  await expect(reviewer.email).toHaveText('nadia@ember.test');

  await withUser(browser, READER.email, READER.password, async (other) => {
    const reader = new ApplicationMonitorPage(other);
    await other.goto(oneByOnePath(marketId));
    await reader.waitForLoaded();
    await expect(reader.email).toHaveText('nadia@ember.test');
    await expect(other.getByTestId('app-monitor-held-by')).toHaveText(
      `${TEST_USER.email} is looking at this.`,
    );
    await expect(reader.approveButton).toHaveCount(0);
    await expect(reader.rejectButton).toHaveCount(0);

    await reader.nextButton.click();
    await expect(reader.email).toHaveText('theo@thistle.test');
    await expect(other.getByTestId('app-monitor-held-by')).toHaveCount(0);
    await other.keyboard.press('n');
    await expect(reader.email).toHaveText('nadia@ember.test');
    // A key that would be a verdict does nothing.
    await other.keyboard.press('a');
    await expect(reader.status).toHaveText('Open');
  });

  // Reading held nothing: the organizer's card is still theirs alone.
  expect(
    mongoEval(
      `db.applications.countDocuments({ market_id: ${JSON.stringify(marketId)}, ` +
        `'held_by.email': ${JSON.stringify(READER.email)} })`,
    ),
  ).toBe('0');
});

test('a verdict on a card skipped ahead to hands out the one after it', async ({
  authenticatedPage: page,
  request,
}) => {
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  const vendors = ['ada@ember.test', 'bo@ember.test', 'cy@ember.test', 'di@ember.test'];
  // Seeded one after another, so they arrive in this order.
  for (const vendor of vendors) seedApplicationWithStatus(marketId, 'open', vendor);

  const reviewer = new ApplicationMonitorPage(page);
  await page.goto(oneByOnePath(marketId));
  await reviewer.waitForLoaded();
  await expect(reviewer.email).toHaveText(vendors[0]);
  await reviewer.nextCard();
  await reviewer.nextCard();
  await expect(reviewer.email).toHaveText(vendors[2]);

  // The decided card leaves the queue but keeps its place: on to the next, not back to the first.
  await reviewer.approveButton.click();
  await expect(reviewer.email).toHaveText(vendors[3]);
  await expect(reviewer.progress).toHaveText('3 of 3 to review');
});
