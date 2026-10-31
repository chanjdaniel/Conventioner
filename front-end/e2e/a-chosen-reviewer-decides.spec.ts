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
 * A chosen reviewer, a Viewer included, decides (E38/F07/S03).
 *
 * Ana and Vic are Viewers; the owner chooses Ana as a reviewer. Ana approves an application from
 * One by one and marks another for a follow-up, offered no notes box, which the "Write vendor
 * notes" row keeps from her; she is offered no change to one already approved. Vic, not chosen,
 * reads the review as a Viewer always has.
 */
const PASSWORD = 'e2epassword123';
const ANA = 'e2e-chosen-viewer-ana@example.com';
const VIC = 'e2e-chosen-viewer-vic@example.com';
const CHANGE_REFUSED =
  'Only an Admin or the owner may change a verdict or overturn an automatic rejection on this market.';

let marketId = '';

test.beforeAll(async ({ request }) => {
  for (const email of [ANA, VIC]) ensureVerifiedUser(email, PASSWORD);
  ({ marketId } = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
  }));
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  seedApplicationWithStatus(marketId, 'open', 'amy@thistle.test');
  seedApplicationWithStatus(marketId, 'open', 'ben@ember.test');
  seedApplicationWithStatus(marketId, 'reviewer_approved', 'cleo@fern.test');
  const api = `${BACKEND_URL}/markets/${marketId}`;
  for (const email of [ANA, VIC]) {
    const res = await request.post(`${api}/roles`, { data: { user_email: email, role: 'viewer' } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  const chosen = await request.put(`${api}/reviewers`, { data: { reviewers: [ANA] } });
  expect(chosen.ok(), await chosen.text()).toBeTruthy();
});

test.describe.configure({ mode: 'serial' });

test('a chosen Viewer approves, marks a follow-up without notes, and changes no verdict', async ({
  browser,
}) => {
  await withUser(browser, ANA, PASSWORD, async (page) => {
    const review = new ApplicationMonitorPage(page);
    await review.goto(marketId);
    await review.waitForLoaded();
    // The frame no longer says the market is read-only to them.
    await expect(page.getByTestId('market-read-only')).toHaveCount(0);

    await review.approve('amy@thistle.test');
    await expect(review.decidedGiverOf('amy@thistle.test')).toHaveText(
      new RegExp(`^Approved by ${ANA}, `),
    );

    await expect(review.email).toHaveText('ben@ember.test');
    await page.getByTestId('app-monitor-follow-up-button').click();
    const dialog = page.getByTestId('follow-up-window');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('follow-up-owner')).toHaveValue(ANA);
    await expect(page.getByTestId('follow-up-note')).toHaveCount(0);
    await page.getByTestId('follow-up-submit-button').click();
    await expect(dialog).toBeHidden();
    await expect(review.done).toBeVisible();

    // Approved by someone else first: a change, which is the change row's.
    await expect(review.decidedReason).toHaveText(CHANGE_REFUSED);
    await expect(review.changeButton('reject', 'cleo@fern.test')).toHaveCount(0);

    const all = new ApplicationsAllPage(page);
    // Every application: the one approved before the deal is nobody's share.
    await all.goto(marketId, 'anyone');
    await expect(all.statusOf('ben@ember.test')).toHaveText('Needs follow-up');
    await all.open('cleo@fern.test');
    await expect(all.drawerChangeReason).toHaveText(CHANGE_REFUSED);
    await expect(all.drawerButton('approve')).toHaveCount(0);
    await expect(all.drawerButton('reject')).toHaveCount(0);
  });
});

test('a Viewer who is not chosen reads the review and decides nothing', async ({ browser }) => {
  await withUser(browser, VIC, PASSWORD, async (page) => {
    const review = new ApplicationMonitorPage(page);
    await review.goto(marketId);
    await review.waitForLoaded();

    await expect(page.getByTestId('market-read-only')).toBeVisible();
    await expect(review.approveButton).toHaveCount(0);
    await expect(review.rejectButton).toHaveCount(0);
    await expect(page.getByTestId('app-monitor-follow-up-button')).toHaveCount(0);
  });
});
