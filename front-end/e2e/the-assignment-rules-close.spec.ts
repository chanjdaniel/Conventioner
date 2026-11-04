import { test, expect, TEST_USER, BACKEND_URL } from './fixtures';
import { ensureTestOrg } from './helpers/seeds';
import { seedAssignedMarket } from './helpers/seedAssignedMarket';
import { marketSetupPath } from './helpers/marketScreens';
import { MarketSetupPage } from './pages/MarketSetupPage';

/**
 * The assignment rules close with the assignment (E22/F02, from the-assignment-tab ticket 01).
 *
 * A rule only takes effect when the assignment runs, and once results are published it can never
 * run again (E36/F04/S02) - so the rules read as they were run, with one line saying why. Results
 * go out before the market does, on either path (ADR 0022); publishing the market then lands at the
 * door (E32/F01/S01), and the rules, reached again from there, stay closed.
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

  test('publishing results settles the rules, and they stay settled at the door', async ({
    authenticatedPage: page,
  }) => {
    await page.goto(marketSetupPath(marketId, 'settings'));
    const maxPerVendor = page.getByTestId('setup-options-max-assignments-input');
    await expect(maxPerVendor).toBeEnabled({ timeout: 15000 });
    await expect(page.getByTestId('priority-add-rule')).toBeVisible();
    await expect(page.getByTestId('assignment-rules-settled')).toHaveCount(0);

    await new MarketSetupPage(page).publishResults(marketId);
    await page.goto(marketSetupPath(marketId, 'settings'));
    await expect(maxPerVendor).toBeDisabled({ timeout: 15000 });
    await expect(page.getByTestId('assignment-rules-settled')).toContainText('settled');

    await page.getByTestId('phase-transition-market_days').click();
    await page.getByTestId('sweep-confirm-submit-button').click();
    await expect(page.getByTestId('phase-rail-current')).toHaveText('Market Days', {
      timeout: 10000,
    });
    await expect(page).toHaveURL(/\/attendance$/);
    await page.getByTestId('market-bar-tab-assignment').click();
    await page.getByTestId('market-pages-settings').click();

    await expect(maxPerVendor).toBeDisabled();
    await expect(page.getByTestId('setup-options-max-proportion-input')).toBeDisabled();
    await expect(page.getByTestId('priority-add-rule')).toHaveCount(0);
    await expect(page.getByTestId('assignment-rules-settled')).toContainText('settled');
    // Said once: the run button's own refusal would only repeat it.
    await expect(page.getByTestId('market-setup-assign-phase-hint')).toHaveCount(0);
  });
});
