import type { Page } from '@playwright/test';
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
import { ReviewersPanel } from './pages/ReviewersPanel';
import { VendorsPage } from './pages/VendorsPage';

/**
 * Choosing reviewers deals the open applications among them (E38/F07/S02).
 *
 * The owner chooses three reviewers from the Applications tab's Reviewers panel, and every open
 * application is dealt to one of them, round robin in the order the applications arrived and the
 * reviewers' addresses sort; adding a fourth deals them all again, and a decided application and a
 * follow-up stay undealt. A vendor's own History tab tells whom their application was dealt to, and
 * a Viewer reads the reviewers without being offered the choice.
 */
const PASSWORD = 'e2epassword123';
const ANA = 'e2e-reviewers-ana@example.com';
const BEN = 'e2e-reviewers-ben@example.com';
const CAT = 'e2e-reviewers-cat@example.com';
const DEE = 'e2e-reviewers-dee@example.com';
const VIEWER = 'e2e-reviewers-viewer@example.com';

/** The open applications, in the order they arrive. */
const OPEN = ['v1@moss.test', 'v2@moss.test', 'v3@moss.test', 'v4@moss.test', 'v5@moss.test'];

let marketId = '';

test.beforeAll(async ({ request }) => {
  for (const email of [ANA, BEN, CAT, DEE, VIEWER]) ensureVerifiedUser(email, PASSWORD);
  ({ marketId } = await seedPhaseMarket(request, BACKEND_URL, TEST_USER.email, TEST_USER.password, {
    intakeMode: 'form',
  }));
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  for (const email of OPEN) seedApplicationWithStatus(marketId, 'open', email);
  seedApplicationWithStatus(marketId, 'reviewer_approved', 'decided@moss.test');
  seedApplicationWithStatus(marketId, 'needs_follow_up', 'follow-up@moss.test');
  for (const [email, role] of [
    [ANA, 'viewer'],
    [BEN, 'editor'],
    [CAT, 'viewer'],
    [DEE, 'viewer'],
    [VIEWER, 'viewer'],
  ]) {
    const res = await request.post(`${BACKEND_URL}/markets/${marketId}/roles`, {
      data: { user_email: email, role },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
});

test.describe.configure({ mode: 'serial' });

/** Each application's reviewer, by vendor, from the list the All view reads after a save. */
async function dealtAfter(page: Page, save: () => Promise<void>) {
  const listed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().endsWith(`/markets/${marketId}/applications`),
  );
  await save();
  const body = (await (await listed).json()) as {
    applications: Array<{ applicantEmail: string; reviewer: { email: string } | null }>;
  };
  return Object.fromEntries(
    body.applications.map((row) => [row.applicantEmail, row.reviewer?.email ?? null]),
  );
}

test('the owner chooses reviewers, and the open applications are dealt among them round robin', async ({
  authenticatedPage: page,
}) => {
  const all = new ApplicationsAllPage(page);
  const reviewers = new ReviewersPanel(page);
  await all.goto(marketId);
  await expect(reviewers.none).toHaveText(
    'No reviewers chosen. Everyone reviews first come, first served.',
  );
  await expect(reviewers.change).toHaveText('Choose reviewers');

  await reviewers.tick(CAT, ANA, BEN);
  const first = await dealtAfter(page, () => reviewers.submit());

  expect(OPEN.map((vendor) => first[vendor])).toEqual([ANA, BEN, CAT, ANA, BEN]);
  expect([first['decided@moss.test'], first['follow-up@moss.test']]).toEqual([null, null]);
  await expect(reviewers.people).toHaveText([ANA, BEN, CAT]);
  await expect(reviewers.change).toHaveText('Change reviewers');

  // The current reviewers are ticked when the dialog opens; a fourth deals every open one again.
  await reviewers.tick();
  await expect(reviewers.choice(ANA)).toBeChecked();
  await expect(reviewers.choice(DEE)).not.toBeChecked();
  await reviewers.choice(DEE).check();
  const again = await dealtAfter(page, () => reviewers.submit());

  expect(OPEN.map((vendor) => again[vendor])).toEqual([ANA, BEN, CAT, DEE, ANA]);
  expect([again['decided@moss.test'], again['follow-up@moss.test']]).toEqual([null, null]);
  await expect(reviewers.people).toHaveText([ANA, BEN, CAT, DEE]);

  // The fourth vendor's own history tells whom their application went to, each time.
  const vendors = new VendorsPage(page);
  await page.goto(
    `${marketScreenPath(marketId, 'vendors')}?vendor=${encodeURIComponent(OPEN[3])}&vendorTab=history`,
  );
  await expect(vendors.detailHistorySentences).toHaveText([
    `${TEST_USER.email} dealt the application to ${DEE}`,
    `${TEST_USER.email} dealt the application to ${ANA}`,
  ]);
});

test('a Viewer reads the reviewers and is offered no choice of them', async ({ browser }) => {
  await withUser(browser, VIEWER, PASSWORD, async (page) => {
    const all = new ApplicationsAllPage(page);
    const reviewers = new ReviewersPanel(page);
    await all.goto(marketId);

    await expect(reviewers.people).toHaveText([ANA, BEN, CAT, DEE]);
    await expect(reviewers.change).toHaveCount(0);
  });
});
