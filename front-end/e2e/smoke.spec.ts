import { test, expect, TEST_USER, LoginPage } from './fixtures';
import { MarketsPage } from './pages/MarketsPage';

test.describe('Conventioner smoke test', () => {
  test('login and land on Markets', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await expect(loginPage.loginForm).toBeVisible();

    await loginPage.fillEmail(TEST_USER.email);
    await loginPage.fillPassword(TEST_USER.password);
    await loginPage.clickSubmit();

    await loginPage.waitForMarkets();
    await expect(page.getByTestId('markets-result-count')).toBeVisible();
  });

  test('navigate to markets and see seeded market', async ({ authenticatedPage: page }) => {
    const markets = new MarketsPage(page);
    await markets.goto();
    await markets.narrowTo('Seed Market');
  });
});
// The e2e repeat's timed trial.
