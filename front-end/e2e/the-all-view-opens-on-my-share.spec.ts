import type { APIRequestContext } from '@playwright/test';
import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { withUser } from './helpers/withUser';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';

/**
 * The All view opens on "Assigned to me", with the "Assigned to" filter (E38/F07/S04).
 *
 * Ana and Ben, both Viewers, are chosen; five applications are dealt round robin in address order
 * (Ana's sorts first): Ana, Ben, Ana, Ben, Ana. Ana opens the Applications tab on her three, then
 * switches to everyone's and to Ben's two, whose drawer carries the warning; a follow-up she keeps
 * on Ben's share is hers under "Me", with Mine too. Cal, an Admin who is not a reviewer, opens on
 * all five, and a market with no reviewers chosen shows no filter at all.
 */
const PASSWORD = 'e2epassword123';
const ANA = 'e2e-share-ana@example.com';
const BEN = 'e2e-share-ben@example.com';
const CAL = 'e2e-share-cal@example.com';
const VENDORS = [1, 2, 3, 4, 5].map((n) => `share-${n}@moss.test`);
const [ANAS_FIRST, BENS_FIRST] = VENDORS;

/** The share the address keeps, as the page reads it. */
const reviewerIn = (url: string) => new URL(url).searchParams.get('reviewer');

async function marketInReview(request: APIRequestContext, reviewers: string[]): Promise<string> {
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
  const chosen = await request.put(`${api}/reviewers`, { data: { reviewers } });
  expect(chosen.ok(), await chosen.text()).toBeTruthy();
  return marketId;
}

test('a chosen reviewer lands on their share, and anyone’s is a filter away', async ({
  browser,
  request,
}) => {
  const marketId = await marketInReview(request, [ANA, BEN]);

  await withUser(browser, ANA, PASSWORD, async (page) => {
    const all = new ApplicationsAllPage(page);
    // The tab itself, as she reaches it: All, on her own share.
    await page.goto(marketScreenPath(marketId, 'applications'));
    await expect(all.assignedTo).toHaveValue('me');
    await expect(all.assignedTo.locator('option')).toHaveText(['Me', 'Anyone', BEN]);
    await expect(all.count).toHaveText('3 of 5');
    await expect(all.rows.getByTestId('applications-all-reviewer')).toHaveText([
      'Reviewer: you',
      'Reviewer: you',
      'Reviewer: you',
    ]);

    await all.assignTo('Anyone');
    await expect.poll(() => reviewerIn(page.url())).toBe('anyone');
    await expect(all.count).toHaveText('5 of 5');

    await all.assignTo(BEN);
    await expect.poll(() => reviewerIn(page.url())).toBe(BEN);
    await expect(all.count).toHaveText('2 of 5');
    await expect(all.row(ANAS_FIRST)).toHaveCount(0);

    // Ben's, opened from his share, says whose it is before she decides it.
    await all.open(BENS_FIRST);
    await expect(all.drawerDealtWarning).toHaveText(
      `This application is dealt to ${BEN}. If you decide it, its history will say you decided it for them.`,
    );
    await page.getByTestId('vendors-detail-close').click();

    // The status filter narrows within the share; a reload keeps both.
    await all.filter('undecided');
    await page.reload();
    await expect(all.assignedTo).toHaveValue(BEN);
    await expect(all.count).toHaveText('2 of 5');

    await all.assignTo('Me');
    await expect(all.count).toHaveText('3 of 5');
  });
});

test('a follow-up I own on another’s share is mine, under Me and with Mine', async ({
  browser,
  request,
}) => {
  const marketId = await marketInReview(request, [ANA, BEN]);

  await withUser(browser, ANA, PASSWORD, async (page) => {
    const all = new ApplicationsAllPage(page);
    // Ana helps with Ben's first and keeps the follow-up herself; it stays dealt to Ben.
    await all.goto(marketId, BEN);
    await all.open(BENS_FIRST);
    await all.drawerButton('follow-up').click();
    await expect(page.getByTestId('follow-up-owner')).toHaveValue(ANA);
    await page.getByTestId('follow-up-submit-button').click();
    await expect(all.row(BENS_FIRST).getByTestId('applications-all-status')).toHaveText(
      'Needs follow-up',
    );
    await page.getByTestId('vendors-detail-close').click();

    await all.assignTo('Me');
    await expect(all.count).toHaveText('4 of 5');
    await expect(all.row(BENS_FIRST).getByTestId('applications-all-reviewer')).toHaveText(
      `Reviewer: ${BEN}`,
    );

    // Hers to follow up, so its drawer does not warn her that it is Ben's.
    await all.open(BENS_FIRST);
    await expect(all.drawerReviewer).toBeVisible();
    await expect(all.drawerDealtWarning).toHaveCount(0);
    await page.getByTestId('vendors-detail-close').click();

    await all.mine.check();
    await expect(all.count).toHaveText('1 of 5');
    await expect(all.rows).toHaveCount(1);
    await expect(all.row(BENS_FIRST)).toHaveCount(1);
  });

  // Her share reads the same to anyone: Cal, not a reviewer, counts it as she does.
  await withUser(browser, CAL, PASSWORD, async (page) => {
    const all = new ApplicationsAllPage(page);
    await all.goto(marketId, ANA);
    await expect(all.count).toHaveText('4 of 5');
    await expect(all.row(BENS_FIRST)).toHaveCount(1);
  });
});

test('an Admin who is not a reviewer opens on every application', async ({ browser, request }) => {
  const marketId = await marketInReview(request, [ANA, BEN]);

  await withUser(browser, CAL, PASSWORD, async (page) => {
    const all = new ApplicationsAllPage(page);
    await page.goto(marketScreenPath(marketId, 'applications'));
    await expect(all.assignedTo).toHaveValue('anyone');
    await expect(all.assignedTo.locator('option')).toHaveText(['Anyone', ANA, BEN]);
    await expect(all.count).toHaveText('5 of 5');

    await all.assignTo(ANA);
    await expect(all.count).toHaveText('3 of 5');
  });
});

test('a market with no reviewers chosen shows no filter, and every application', async ({
  authenticatedPage: page,
  request,
}) => {
  const marketId = await marketInReview(request, []);
  const all = new ApplicationsAllPage(page);
  await all.goto(marketId, ANA);

  await expect(all.rows).toHaveCount(5);
  await expect(all.count).toHaveText('5 of 5');
  await expect(all.assignedTo).toHaveCount(0);
});
