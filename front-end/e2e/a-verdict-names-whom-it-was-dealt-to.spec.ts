import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import {
  seedApplicationWithStatus,
  seedPhaseMarket,
  transitionMarket,
} from './helpers/seedPhaseMarket';
import { marketScreenPath } from './helpers/marketScreens';
import { ensureVerifiedUser } from './helpers/verifiedUser';
import { ApplicationsAllPage } from './pages/ApplicationsAllPage';
import { VendorsPage } from './pages/VendorsPage';

/**
 * A verdict's history names whom the application was dealt to (E38/F07/S02).
 *
 * The owner, who is not a reviewer, decides an application dealt to Ana from the All view's
 * drawer; the vendor's History tab names both: who decided it, and whose share it was.
 */
const PASSWORD = 'e2epassword123';
const ANA = 'e2e-reviewers-ana@example.com';
const BEN = 'e2e-reviewers-ben@example.com';
const VENDOR = 'decided-for-ana@moss.test';

test('a verdict on another reviewer’s application names both people', async ({
  authenticatedPage: page,
  request,
}) => {
  for (const email of [ANA, BEN]) ensureVerifiedUser(email, PASSWORD);
  const { marketId } = await seedPhaseMarket(
    request,
    BACKEND_URL,
    TEST_USER.email,
    TEST_USER.password,
    { intakeMode: 'form' },
  );
  await transitionMarket(request, BACKEND_URL, TEST_USER.email, marketId, 'applications');
  const api = `${BACKEND_URL}/markets/${marketId}`;
  // Dealt first, so to Ana, the first reviewer by address.
  seedApplicationWithStatus(marketId, 'open', VENDOR);
  seedApplicationWithStatus(marketId, 'open', 'for-ben@moss.test');
  for (const email of [ANA, BEN]) {
    const res = await request.post(`${api}/roles`, { data: { user_email: email, role: 'editor' } });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  const chosen = await request.put(`${api}/reviewers`, { data: { reviewers: [ANA, BEN] } });
  expect(chosen.ok(), await chosen.text()).toBeTruthy();

  const all = new ApplicationsAllPage(page);
  await all.goto(marketId);
  await all.open(VENDOR);
  await all.drawerButton('approve').click();
  await expect(all.statusOf(VENDOR)).toHaveText('Approved');

  const vendors = new VendorsPage(page);
  await page.goto(
    `${marketScreenPath(marketId, 'vendors')}?vendor=${encodeURIComponent(VENDOR)}&vendorTab=history`,
  );
  await expect(vendors.detailHistorySentences).toHaveText([
    `${TEST_USER.email} set ${VENDOR} to Approved, dealt to ${ANA}`,
    `${TEST_USER.email} dealt the application to ${ANA}`,
  ]);
});
