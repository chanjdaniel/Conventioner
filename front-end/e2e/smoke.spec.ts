import { test, expect, TEST_USER, LoginPage } from './fixtures';

test.describe('Conventioner smoke test', () => {
  test('login and access dashboard', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await expect(loginPage.loginForm).toBeVisible();

    await loginPage.fillEmail(TEST_USER.email);
    await loginPage.fillPassword(TEST_USER.password);
    await loginPage.clickSubmit();

    await page.waitForURL('**/dashboard', { timeout: 10000 });
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.locator('.main-buttons')).toBeVisible();
  });

  test('navigate to markets and see seeded market', async ({ authenticatedPage: page }) => {
    await page.goto('/markets');
    await expect(page.locator('.markets-view')).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByTestId('market-card').filter({ hasText: 'Seed Market' }).first(),
    ).toBeVisible({ timeout: 10000 });
  });
});
