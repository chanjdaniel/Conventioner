import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { oneByOnePath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ApplicationMonitorPage } from './pages/ApplicationMonitorPage';

/**
 * One by one hands out my share first, then offers the rest (E38/F07/S04).
 *
 * Ana and Ben, both Viewers, are chosen; five applications are dealt round robin in address order
 * (Ana's sorts first): Ana, Ben, Ana, Ben, Ana. Ben is handed his two, decides both, reads that his
 * share is done with three left to others, and helps with them, each card saying it is Ana's. Cal,
 * an Admin who is not a reviewer, walks all five as before.
 */
const PASSWORD = 'e2epassword123';
const ANA = 'e2e-mine-first-ana@example.com';
const BEN = 'e2e-mine-first-ben@example.com';
const CAL = 'e2e-mine-first-cal@example.com';
const VENDORS = [1, 2, 3, 4, 5].map((n) => `mine-first-${n}@moss.test`);
const [ANAS_FIRST, BENS_FIRST, , BENS_SECOND] = VENDORS;

async function marketInReview(request: APIRequestContext): Promise<string> {
  for (const email of [ANA, BEN, CAL]) ensureVerifiedUser(email, PASSWORD);
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  const api = `${BACKEND_URL}/markets/${marketId}`;
  // Seeded one after another, so they arrive, and are dealt, in this order.
  for (const vendor of VENDORS) seedApplicationWithStatus(marketId, 'open', vendor);
  for (const [email, role] of [
    [ANA, 'viewer'],
    [BEN, 'viewer'],
    [CAL, 'admin'],
  ]) {
    const res = await request.post(`${api}/roles`, { data: { user_email: email, role } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  const chosen = await request.put(`${api}/reviewers`, { data: { reviewers: [ANA, BEN] } });
  expect(chosen.ok(), await chosen.text()).toBeTruthy();
  return marketId;
}

test('a chosen reviewer decides their share, then helps with the others', async ({
  browser,
  request,
}) => {
  const marketId = await marketInReview(request);

  await withUser(browser, BEN, PASSWORD, async (page) => {
    const monitor = new ApplicationMonitorPage(page);
    await page.goto(oneByOnePath(marketId));
    await monitor.waitForLoaded();

    // His own first, though Ana's arrived before it.
    await expect(monitor.email).toHaveText(BENS_FIRST);
    await expect(monitor.progress).toHaveText('1 of 2 in your share');
    await expect(monitor.dealtWarning).toHaveCount(0);
    await monitor.approve(BENS_FIRST);

    await expect(monitor.email).toHaveText(BENS_SECOND);
    await expect(monitor.progress).toHaveText('1 of 1 in your share');
    await monitor.approve(BENS_SECOND);

    await expect(monitor.card).toHaveCount(0);
    await expect(monitor.shareDone).toContainText('Your share is done.');
    await expect(monitor.shareDoneOthers).toHaveText(
      "3 open applications are dealt to other reviewers. You can help with them; each one's history will say you decided it.",
    );
    await expect(monitor.tally).toContainText('2 reviewed');

    await monitor.helpOthersButton.click();
    await expect(monitor.email).toHaveText(ANAS_FIRST);
    await expect(monitor.progress).toHaveText('1 of 3 to review');
    await expect(monitor.dealtWarning).toHaveText(
      `This application is dealt to ${ANA}. If you decide it, its history will say you decided it for them.`,
    );
  });
});

test('an Admin who is not a reviewer walks every application as before', async ({
  browser,
  request,
}) => {
  const marketId = await marketInReview(request);

  await withUser(browser, CAL, PASSWORD, async (page) => {
    const monitor = new ApplicationMonitorPage(page);
    await page.goto(oneByOnePath(marketId));
    await monitor.waitForLoaded();

    await expect(monitor.progress).toHaveText('1 of 5 to review');
    expect(await monitor.queuedEmails()).toEqual(VENDORS);

    await monitor.approve(ANAS_FIRST);
    await expect(monitor.progress).toContainText('of 4 to review');
    await expect(monitor.shareDone).toHaveCount(0);
  });
});
