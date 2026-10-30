import type { APIRequestContext } from '@playwright/test';
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
 * Rows name their reviewer, and deciding another's carries the warning (E38/F07/S03).
 *
 * The owner chooses themselves and Ana as the reviewers. Five applications are dealt round robin in
 * address order (Ana's address sorts first): Ana, the owner, Ana, the owner, Ana. Each row says whose
 * it is; the owner decides one of Ana's from the drawer after reading its warning, and a selection
 * reaching one of hers says so in the confirmation.
 */
const PASSWORD = 'e2epassword123';
const ANA = 'e2e-reviewers-ana@example.com';
const VENDORS = [1, 2, 3, 4, 5].map((n) => `dealt-row-${n}@moss.test`);
const [ANAS_FIRST, MY_FIRST, ANAS_SECOND, MY_SECOND] = VENDORS;

async function reviewedByTheOwnerAndAna(request: APIRequestContext): Promise<string> {
  ensureVerifiedUser(ANA, PASSWORD);
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
  const role = await request.post(`${api}/roles`, { data: { user_email: ANA, role: 'viewer' } });
  expect(role.ok(), await role.text()).toBeTruthy();
  const chosen = await request.put(`${api}/reviewers`, {
    data: { reviewers: [ANA, TEST_USER.email] },
  });
  expect(chosen.ok(), await chosen.text()).toBeTruthy();
  return marketId;
}

test.describe('rows name their reviewer', () => {
  test('a reviewer decides another’s application after the drawer’s warning', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await reviewedByTheOwnerAndAna(request);
    const all = new ApplicationsAllPage(page);
    await all.goto(marketId);

    await expect(all.reviewerOf(ANAS_FIRST)).toHaveText(`Reviewer: ${ANA}`);
    await expect(all.reviewerOf(MY_FIRST)).toHaveText('Reviewer: you');

    // Their own carries no warning.
    await all.open(MY_FIRST);
    await expect(all.drawerReviewer).toHaveText('Reviewer: you');
    await expect(all.drawerDealtWarning).toHaveCount(0);
    await page.getByTestId('vendors-detail-close').click();

    await all.open(ANAS_FIRST);
    await expect(all.drawerReviewer).toHaveText(`Reviewer: ${ANA}`);
    await expect(all.drawerDealtWarning).toHaveText(
      `This application is dealt to ${ANA}. If you decide it, its history will say you decided it for them.`,
    );
    await all.drawerButton('approve').click();
    await expect(all.statusOf(ANAS_FIRST)).toHaveText('Approved');
    // Decided, it is no longer anyone's to warn about; whose share it was stays on the row.
    await expect(all.drawerDealtWarning).toHaveCount(0);
    await expect(all.reviewerOf(ANAS_FIRST)).toHaveText(`Reviewer: ${ANA}`);

    const vendors = new VendorsPage(page);
    await page.goto(
      `${marketScreenPath(marketId, 'vendors')}?vendor=${encodeURIComponent(ANAS_FIRST)}&vendorTab=history`,
    );
    await expect(vendors.detailHistorySentences).toHaveText([
      `${TEST_USER.email} set ${ANAS_FIRST} to Approved, dealt to ${ANA}`,
      `${TEST_USER.email} dealt the application to ${ANA}`,
    ]);
  });

  test('a selection reaching another’s application says so in its confirmation', async ({
    authenticatedPage: page,
    request,
  }) => {
    const marketId = await reviewedByTheOwnerAndAna(request);
    const all = new ApplicationsAllPage(page);
    await all.goto(marketId);

    await all.tickOf(MY_FIRST).check();
    await all.tickOf(MY_SECOND).check();
    await all.decideSelection('approve');
    await expect(all.confirmWindow).toBeVisible();
    await expect(all.confirmDealt).toHaveCount(0);
    await page.getByTestId('applications-all-confirm-cancel-button').click();

    await all.tickOf(ANAS_SECOND).check();
    await all.decideSelection('approve');
    await expect(all.confirmDealt).toHaveText(
      '1 of them is dealt to another reviewer; its history will say you decided it.',
    );
    await all.confirmButton.click();
    await expect(all.result).toContainText('3 applications approved');
    for (const vendor of [MY_FIRST, MY_SECOND, ANAS_SECOND]) {
      await expect(all.statusOf(vendor)).toHaveText('Approved');
    }
  });
});
