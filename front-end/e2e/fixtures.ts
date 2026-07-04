import { test as base, type Page } from '@playwright/test';

export const TEST_USER = {
  email: 'e2e@example.com',
  password: 'e2epassword123',
};

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('input[type="password"]', password);
  await page.click('button.submit-button:has-text("Login")');
  await page.waitForURL('**/dashboard', { timeout: 10000 });
}

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    await login(page, TEST_USER.email, TEST_USER.password);
    await use(page);
  },
});

export { expect } from '@playwright/test';
