import { test as base, type Page } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';

export const TEST_USER = {
  email: 'e2e@example.com',
  password: 'e2epassword123',
};

export const BACKEND_URL = process.env.BACKEND_URL || 'https://localhost:5000';

async function login(page: Page, email: string, password: string) {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.fillEmail(email);
  await loginPage.fillPassword(password);
  await loginPage.clickSubmit();
  await page.waitForURL('**/dashboard', { timeout: 10000 });
}

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    await login(page, TEST_USER.email, TEST_USER.password);
    await use(page);
  },
});

export { expect } from '@playwright/test';
export { LoginPage } from './pages/LoginPage';
export { MarketSetupPage } from './pages/MarketSetupPage';
export { AssignmentResultsPage } from './pages/AssignmentResultsPage';
export { NewMarketPage } from './pages/NewMarketPage';
export { CheckinPage } from './pages/CheckinPage';
export { VendorsPage } from './pages/VendorsPage';
export { TablesPage } from './pages/TablesPage';
export { AttendanceStatusPage } from './pages/AttendanceStatusPage';
export { OrganizationsPage } from './pages/OrganizationsPage';
export { ManageMarketPage } from './pages/ManageMarketPage';
