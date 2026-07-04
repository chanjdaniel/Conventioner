import { test, expect, TEST_USER } from './fixtures';

test.describe('Conventioner smoke test', () => {
  test('login and access dashboard', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#login-form')).toBeVisible();

    await page.fill('#email', TEST_USER.email);
    await page.fill('input[type="password"]', TEST_USER.password);
    await page.click('button.submit-button:has-text("Login")');

    await page.waitForURL('**/dashboard', { timeout: 10000 });
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.locator('.main-buttons')).toBeVisible();
  });

  test('navigate to markets and see seeded market', async ({ authenticatedPage: page }) => {
    await page.goto('/markets');
    await expect(page.locator('.markets-view')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.market-card').first()).toBeVisible({ timeout: 10000 });
  });


});
