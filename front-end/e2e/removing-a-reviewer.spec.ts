import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { ReviewersPanel } from './pages/ReviewersPanel';
import { VendorsPage } from './pages/VendorsPage';

/**
 * Removing a reviewer deals their share and their follow-ups again (E38/F07/S02).
 *
 * Ana holds a follow-up when she falls ill; the owner unticks her in the Reviewers panel, and the
 * follow-up is handed to the reviewer it is dealt to, whose name the All view shows as its owner,
 * and its vendor's History tab says who held it before.
 */
const PASSWORD = 'e2epassword123';
const ANA = 'e2e-reviewers-ana@example.com';
const BEN = 'e2e-reviewers-ben@example.com';
const CAT = 'e2e-reviewers-cat@example.com';
const FOLLOW_UP = 'needs-a-word@moss.test';

test('a removed reviewer’s follow-up is handed to the reviewer it is dealt to', async ({
  authenticatedPage: page,
  request,
}) => {
  for (const email of [ANA, BEN, CAT]) ensureVerifiedUser(email, PASSWORD);
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  const api = `${BACKEND_URL}/markets/${marketId}`;
  seedApplicationWithStatus(marketId, 'open', 'v1@moss.test');
  seedApplicationWithStatus(marketId, 'open', 'v2@moss.test');
  const followUp = seedApplicationWithStatus(marketId, 'open', FOLLOW_UP);
  for (const email of [ANA, BEN, CAT]) {
    const res = await request.post(`${api}/roles`, { data: { user_email: email, role: 'editor' } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  const chosen = await request.put(`${api}/reviewers`, { data: { reviewers: [ANA, BEN, CAT] } });
  expect(chosen.ok(), await chosen.text()).toBeTruthy();
  // Dealt to Cat, the third in turn, and marked for a follow-up Ana owns.
  const marked = await request.put(`${api}/applications/${followUp}/review`, {
    data: { status: 'needs_follow_up', ownerEmail: ANA },
  });
  expect(marked.ok(), await marked.text()).toBeTruthy();

  const all = new ApplicationsAllPage(page);
  const reviewers = new ReviewersPanel(page);
  await all.goto(marketId);
  await expect(all.ownerOf(FOLLOW_UP)).toHaveText(`Followed up by ${ANA}`);

  await reviewers.untick(ANA);
  await reviewers.submit();

  // The pool is v1, v2 and the follow-up, in arrival order, dealt to Ben and Cat in turn.
  await expect(reviewers.people).toHaveText([BEN, CAT]);
  await expect(all.ownerOf(FOLLOW_UP)).toHaveText(`Followed up by ${BEN}`);

  const vendors = new VendorsPage(page);
  await page.goto(
    `${marketScreenPath(marketId, 'vendors')}?vendor=${encodeURIComponent(FOLLOW_UP)}&vendorTab=history`,
  );
  await expect(vendors.detailHistorySentences.first()).toHaveText(
    `${TEST_USER.email} dealt the follow-up from ${ANA} to ${BEN}`,
  );
});
