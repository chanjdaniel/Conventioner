import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { oneByOnePath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { mongoEval } from './helpers/mongo';
import { withUser } from './helpers/withUser';

/**
 * A verdict is written only on what the reviewer saw (E34/F03/S01).
 *
 * Two reviewers on one market, the same card in front of both - which a claim prevents unless it
 * lapsed (E34/F03/S02), as it does here. The first verdict is written; the
 * second is refused, says who decided and what, and leaves the reviewer on that application as it
 * now stands. Before, the last verdict silently won.
 */
const CHANGE_REFUSED =
  'Only an Admin or the owner may change a verdict or overturn an automatic rejection on this market.';

/**
 * Both reviewers open Nadia's card, the first approves, and the second, still looking at what they
 * opened, rejects: refused, and told why. `then` goes on from the refused card, as the second.
 */
async function decideOneCardTwice(
  { page, browser, request }: { page: Page; browser: Browser; request: APIRequestContext },
  second: { email: string; password: string; role: 'editor' | 'admin' },
  then: (other: Page, card: ApplicationMonitorPage) => Promise<void>,
): Promise<void> {
  ensureVerifiedUser(second.email, second.password);
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
    data: { user_email: second.email, role: second.role },
  });
  expect(granted.ok(), await granted.text()).toBeTruthy();

  const first = new ApplicationMonitorPage(page);
  await page.goto(oneByOnePath(marketId));
  await first.waitForLoaded();
  await expect(first.email).toHaveText('nadia@ember.test');

  // A claim keeps two reviewers off one card (E34/F03/S02); this is the case it cannot: the first
  // reviewer's claim lapsed - they stepped away - and the card was handed out again.
  mongoEval(
    `db.applications.updateMany({ market_id: ${JSON.stringify(marketId)} }, ` +
      `{ $set: { held_until: '2000-01-01T00:00:00+00:00' } })`,
  );

  await withUser(browser, second.email, second.password, async (other) => {
    const card = new ApplicationMonitorPage(other);
    await other.goto(oneByOnePath(marketId));
    await card.waitForLoaded();
    await expect(card.email).toHaveText('nadia@ember.test');

    // Both opened Nadia's card. The first approves.
    await first.approveButton.click();
    await expect(first.email).toHaveText('theo@thistle.test');

    // The second, still looking at what they opened, rejects: refused, and told why.
    await card.rejectButton.click();
    await expect(other.getByTestId('app-monitor-changed')).toContainText(
      `${TEST_USER.email} approved this application since you opened it.`,
    );
    // Still on Nadia, as she now stands.
    await expect(card.email).toHaveText('nadia@ember.test');
    await expect(card.status).toHaveText('Approved');

    await then(other, card);
  });
}

test('the second of two verdicts on one card is refused, naming the first', async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  const second = { email: 'e2e-second-reviewer@example.com', password: 'e2esecondreviewer1' };
  await decideOneCardTwice(
    { page, browser, request },
    { ...second, role: 'editor' },
    async (other, card) => {
      // Back to the queue: Theo, untouched by any of it.
      await card.nextButton.click();
      await expect(card.email).toHaveText('theo@thistle.test');
      await expect(other.getByTestId('app-monitor-changed')).toHaveCount(0);
    },
  );

  const first = new ApplicationMonitorPage(page);
  await first.openDecided();
  await expect(first.decidedStatusOf('nadia@ember.test')).toHaveText('Approved');
});

/**
 * Deciding the card again is changing a verdict (E38/F06/S01): an Editor's refused card offers no
 * verdict, by button or by key, and says why; an Admin's offers each, and the server takes it.
 */
test('an Editor is offered no verdict on a card someone decided first', async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  const editor = { email: 'e2e-refused-editor@example.com', password: 'e2epassword123' };
  await decideOneCardTwice(
    { page, browser, request },
    { ...editor, role: 'editor' },
    async (other, card) => {
      await expect(other.getByTestId('app-monitor-card-change-reason')).toHaveText(CHANGE_REFUSED);
      await expect(card.approveButton).toHaveCount(0);
      await expect(card.rejectButton).toHaveCount(0);
      await expect(card.followUpButton).toHaveCount(0);
      await expect(card.nextButton).toBeVisible();

      // Nor by key: nothing goes out, and the card stands as it was.
      const verdicts: string[] = [];
      other.on('request', (req) => {
        if (req.method() === 'PUT' && /\/applications\/[^/]+\/review$/.test(req.url())) {
          verdicts.push(req.url());
        }
      });
      for (const key of ['a', 'r', 's']) await other.keyboard.press(key);
      await expect(other.getByTestId('follow-up-window')).toHaveCount(0);
      await expect(card.status).toHaveText('Approved');
      expect(verdicts).toEqual([]);
    },
  );
});

test('an Admin changes a card someone decided first', async ({
  authenticatedPage: page,
  browser,
  request,
}) => {
  const admin = { email: 'e2e-refused-admin@example.com', password: 'e2epassword123' };
  await decideOneCardTwice(
    { page, browser, request },
    { ...admin, role: 'admin' },
    async (other, card) => {
      await expect(other.getByTestId('app-monitor-card-change-reason')).toHaveCount(0);
      await expect(card.approveButton).toBeVisible();
      // Rejecting what they now see is a change, which is theirs to make.
      await card.rejectButton.click();
      // Off Nadia, refused no more; Theo is the first reviewer's, so the queue may have none left.
      await expect(other.getByTestId('app-monitor-changed')).toHaveCount(0);
      await expect(card.email.filter({ hasText: 'nadia@ember.test' })).toHaveCount(0);
      await card.openDecided();
      await expect(card.decidedStatusOf('nadia@ember.test')).toHaveText('Rejected');
    },
  );
});
