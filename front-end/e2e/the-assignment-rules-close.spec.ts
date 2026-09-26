import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { marketSetupPath } from './helpers/marketScreens';

/**
 * The assignment rules close with the assignment (E22/F02, from the-assignment-tab ticket 01).
 *
 * A rule only takes effect when the assignment runs, and once the market is published it can never
 * run again - so the rules read as they were run, with one line saying why. The page learns it
 * from the market it holds, so publishing from the rail closes them without leaving the tab.
 */
test.describe('The assignment rules close with the assignment', () => {
  let marketId: string;

  test.beforeEach(async ({ request }) => {
    await ensureTestOrg(request, BACKEND_URL, TEST_USER.email, TEST_USER.password);
    const seeded = await seedAssignedMarket(
      request,
      BACKEND_URL,
      TEST_USER.email,
      TEST_USER.password,
    );
    marketId = seeded.marketId;
  });

  test('publishing from the rail settles the rules on the open tab', async ({
    authenticatedPage: page,
  }) => {
    await page.goto(marketSetupPath(marketId, 'assignment'));
    const maxPerVendor = page.getByTestId('setup-options-max-assignments-input');
    await expect(maxPerVendor).toBeEnabled({ timeout: 15000 });
    await expect(page.getByTestId('priority-add-rule')).toBeVisible();
    await expect(page.getByTestId('assignment-rules-settled')).toHaveCount(0);

    await page.getByTestId('phase-transition-market_days').click();
    await page.getByTestId('sweep-confirm-submit-button').click();
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Market Days', {
      timeout: 10000,
    });

    await expect(maxPerVendor).toBeDisabled();
    await expect(page.getByTestId('setup-options-max-proportion-input')).toBeDisabled();
    await expect(page.getByTestId('priority-add-rule')).toHaveCount(0);
    await expect(page.getByTestId('assignment-rules-settled')).toContainText('settled');
    // Said once: the run button's own refusal would only repeat it.
    await expect(page.getByTestId('market-setup-assign-phase-hint')).toHaveCount(0);
  });
});
